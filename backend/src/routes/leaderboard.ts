import { Hono } from "hono";
import { CONFIG, normalizeAddress } from "../config";
import { getLeaderboard } from "../db/queries";
import { getCached, setCached } from "../services/cache";
import { logDebug, logInfo } from "../services/logger";

const leaderboardRoute = new Hono();

leaderboardRoute.get("/leaderboard", async (c) => {
  const tier = c.req.query("tier");
  const token = c.req.query("token");
  const limitRaw = Number.parseInt(c.req.query("limit") ?? "50", 10);
  const offsetRaw = Number.parseInt(c.req.query("offset") ?? "0", 10);

  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), 200)
    : 50;
  const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;
  const normalizedToken = token ? normalizeAddress(token) : undefined;

  const cacheKey = `leaderboard:${tier ?? "all"}:${normalizedToken ?? "none"}:${limit}:${offset}`;
  const cached = getCached<unknown>(cacheKey);
  if (cached) {
    logDebug("CACHE HIT", `leaderboard key=${cacheKey}`);
    return c.json(cached);
  }
  logDebug("CACHE MISS", `leaderboard key=${cacheKey}`);

  const data = await getLeaderboard({
    tier,
    token: normalizedToken ?? undefined,
    limit,
    offset,
  });
  console.log("THE DATA IN HERE ON THE LEADERBOARD ROUTE", data);

  setCached(cacheKey, data, CONFIG.LEADERBOARD_CACHE_MS);
  logInfo(
    "LEADERBOARD",
    `total=${data.total} returned=${data.personas.length} limit=${limit} offset=${offset}`,
  );
  return c.json(data);
});

export default leaderboardRoute;
