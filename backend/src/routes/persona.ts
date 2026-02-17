import { Hono } from "hono";
import { CONFIG } from "../config";
import {
  getPersona,
  getPersonaScans,
  parseTokenBreakdown,
  parseWallets,
} from "../db/queries";
import { getCached, setCached } from "../services/cache";
import { ApiError } from "../services/errors";
import { logDebug, logInfo } from "../services/logger";

const personaRoute = new Hono();

personaRoute.get("/persona/:fid", async (c) => {
  const fid = Number.parseInt(c.req.param("fid"), 10);
  if (!Number.isFinite(fid)) {
    throw new ApiError(400, "invalid_fid", "Invalid fid");
  }

  const cacheKey = `persona:${fid}`;
  const cached = getCached<unknown>(cacheKey);
  if (cached) {
    logDebug("CACHE HIT", `persona key=${cacheKey}`);
    return c.json(cached);
  }
  logDebug("CACHE MISS", `persona key=${cacheKey}`);

  const persona = await getPersona(fid);
  if (!persona) {
    throw new ApiError(404, "persona_not_found", "Persona not found");
  }

  const scans = await getPersonaScans(fid);

  const response = {
    fid: persona.fid,
    username: persona.username,
    display_name: persona.display_name,
    pfp_url: persona.pfp_url,
    follower_count: Number(persona.follower_count),
    island_heat: Number(persona.island_heat),
    tier: persona.tier,
    wallet_count: Number(persona.wallet_count),
    wallets: parseWallets(persona.wallets),
    token_breakdown: parseTokenBreakdown(persona.token_breakdown),
    scans,
  };

  setCached(cacheKey, response, CONFIG.PERSONA_CACHE_MS);
  logInfo(
    "PERSONA",
    `fid=${fid} wallets=${response.wallet_count} scans=${response.scans.length}`,
  );
  return c.json(response);
});

export default personaRoute;
