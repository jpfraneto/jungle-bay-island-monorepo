import { Hono } from "hono";
import { toSupportedChain } from "../config";
import { getCanonicalProjectContextByIdentifier, getCanonicalProjectContext } from "../services/canonicalProjects";
import type { AppEnv } from "../types";

const bungalowResolveRoute = new Hono<AppEnv>();

function buildCanonicalPath(input: {
  slug: string | null;
  chain: string;
  tokenAddress: string;
}) {
  return input.slug
    ? `/bungalow/${input.slug}?chain=${encodeURIComponent(input.chain)}`
    : `/bungalow/${input.tokenAddress}?chain=${encodeURIComponent(input.chain)}`;
}

bungalowResolveRoute.get("/bungalow/resolve/:identifier", async (c) => {
  const identifier = c.req.param("identifier")?.trim() ?? "";
  const context = await getCanonicalProjectContextByIdentifier(identifier);

  return c.json({
    canonical_slug: context.project?.slug ?? null,
    chain: context.primaryDeployment.chain,
    token_address: context.primaryDeployment.token_address,
    canonical_path: buildCanonicalPath({
      slug: context.project?.slug ?? null,
      chain: context.primaryDeployment.chain,
      tokenAddress: context.primaryDeployment.token_address,
    }),
  });
});

bungalowResolveRoute.get("/bungalow/resolve/:chain/:ca", async (c) => {
  const chain = toSupportedChain(c.req.param("chain"));
  const tokenAddress = c.req.param("ca");
  if (!chain) {
    return c.json({ error: "unsupported chain" }, 400);
  }
  const context = await getCanonicalProjectContext(chain, tokenAddress);

  return c.json({
    canonical_slug: context.project?.slug ?? null,
    chain: context.primaryDeployment.chain,
    token_address: context.primaryDeployment.token_address,
    canonical_path: buildCanonicalPath({
      slug: context.project?.slug ?? null,
      chain: context.primaryDeployment.chain,
      tokenAddress: context.primaryDeployment.token_address,
    }),
  });
});

export default bungalowResolveRoute;
