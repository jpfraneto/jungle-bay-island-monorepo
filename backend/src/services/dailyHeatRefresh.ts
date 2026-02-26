import { CONFIG } from "../config";
import {
  createScanLog,
  getDailyRefreshTokens,
  getTokenRegistry,
  markScanFailed,
  setTokenStatus,
  updateBungalowMetadata,
  updateScanProgress,
  writeScanResult,
  type DailyRefreshTokenRow,
} from "../db/queries";
import { fetchDexScreenerData } from "./dexscreener";
import { logError, logInfo, logSuccess } from "./logger";
import { scanToken } from "./scanner";
import { scanSolanaToken } from "./solanaScanner";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_REFRESH_REQUESTER = "system:daily-refresh";

let isRunning = false;
let kickoffTimer: ReturnType<typeof setTimeout> | null = null;
let intervalTimer: ReturnType<typeof setInterval> | null = null;

function getMsUntilNextNoonUtc(now = new Date()): number {
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0, 0),
  );

  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }

  return next.getTime() - now.getTime();
}

async function processToken(token: DailyRefreshTokenRow): Promise<void> {
  const registry = await getTokenRegistry(token.token_address, token.chain);
  if (!registry || registry.scan_status === "scanning") {
    logInfo(
      "DAILY REFRESH",
      `skip chain=${token.chain} token=${token.token_address} status=${registry?.scan_status ?? "missing"}`,
    );
    return;
  }

  await setTokenStatus(token.token_address, token.chain, "scanning");

  const scanId = await createScanLog({
    tokenAddress: token.token_address,
    chain: token.chain,
    requestedBy: DAILY_REFRESH_REQUESTER,
    requesterFid: null,
    requesterTier: "system",
    paymentMethod: "admin",
    paymentAmount: 0,
  });

  try {
    const onProgress = (progress: {
      phase: string;
      pct: number;
      detail?: string;
    }) => {
      void updateScanProgress(scanId, progress).catch(() => undefined);
    };

    const result = token.chain === "solana"
      ? await scanSolanaToken(token.token_address, onProgress)
      : await scanToken(token.chain, token.token_address, onProgress);

    await writeScanResult(scanId, result);

    if (token.chain !== "solana") {
      try {
        const dexData = await fetchDexScreenerData(token.token_address, token.chain);
        if (dexData) {
          await updateBungalowMetadata(token.token_address, dexData);
        }
      } catch (dexErr) {
        const dexMsg = dexErr instanceof Error ? dexErr.message : "Unknown";
        logError(
          "DAILY REFRESH DEX",
          `scan_id=${scanId} token=${token.token_address} error=\"${dexMsg}\"`,
        );
      }
    }

    logSuccess(
      "DAILY REFRESH TOKEN",
      `scan_id=${scanId} chain=${token.chain} token=${token.token_address} holders=${result.holderCount}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown scanner error";
    await markScanFailed(scanId, token.token_address, message);
    logError(
      "DAILY REFRESH TOKEN",
      `scan_id=${scanId} chain=${token.chain} token=${token.token_address} error=\"${message}\"`,
    );
  }
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const safeConcurrency = Math.max(1, Math.min(concurrency, items.length));
  let index = 0;

  await Promise.all(
    Array.from({ length: safeConcurrency }).map(async () => {
      while (true) {
        const current = index;
        index += 1;
        if (current >= items.length) return;
        await worker(items[current]);
      }
    }),
  );
}

export async function runDailyHeatRefresh(reason: "scheduled" | "manual" = "manual"): Promise<void> {
  if (isRunning) {
    logInfo("DAILY REFRESH", `skip reason=${reason} already_running=true`);
    return;
  }

  isRunning = true;
  const startedAt = Date.now();

  try {
    const tokens = await getDailyRefreshTokens(10_000);
    if (tokens.length === 0) {
      logInfo("DAILY REFRESH", `reason=${reason} tokens=0`);
      return;
    }

    logInfo(
      "DAILY REFRESH",
      `reason=${reason} tokens=${tokens.length} concurrency=${CONFIG.DAILY_HEAT_REFRESH_CONCURRENCY}`,
    );

    await runWithConcurrency(
      tokens,
      CONFIG.DAILY_HEAT_REFRESH_CONCURRENCY,
      processToken,
    );

    logSuccess(
      "DAILY REFRESH",
      `reason=${reason} tokens=${tokens.length} duration_ms=${Date.now() - startedAt}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown";
    logError("DAILY REFRESH", `reason=${reason} error=\"${message}\"`);
  } finally {
    isRunning = false;
  }
}

export function startDailyHeatRefreshScheduler(): void {
  if (!CONFIG.DAILY_HEAT_REFRESH_ENABLED) {
    logInfo("DAILY REFRESH", "scheduler disabled via DAILY_HEAT_REFRESH_ENABLED");
    return;
  }

  if (kickoffTimer || intervalTimer) {
    return;
  }

  const msUntilNoon = getMsUntilNextNoonUtc();
  const nextRunAt = new Date(Date.now() + msUntilNoon).toISOString();
  logInfo("DAILY REFRESH", `scheduler armed next_run_utc=${nextRunAt}`);

  kickoffTimer = setTimeout(() => {
    void runDailyHeatRefresh("scheduled");
    intervalTimer = setInterval(() => {
      void runDailyHeatRefresh("scheduled");
    }, ONE_DAY_MS);
  }, msUntilNoon);
}
