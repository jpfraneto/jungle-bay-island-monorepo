import { Hono } from "hono";
import { normalizeAddress, toSupportedChain, type SupportedChain } from "../config";
import { requireWalletAuth } from "../middleware/auth";
import {
  deleteCanonicalProject,
  getCanonicalProjectAdminWallet,
  getCanonicalProjectById,
  listCanonicalProjects,
  upsertCanonicalProject,
  type BungalowAssetKind,
  type CanonicalDeploymentRef,
} from "../services/canonicalProjects";
import { ApiError } from "../services/errors";
import { clearCache } from "../services/cache";
import type { AppEnv } from "../types";

const bungalowAdminRoute = new Hono<AppEnv>();

bungalowAdminRoute.use("/bungalow-admin/*", requireWalletAuth);

function normalizeProjectId(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_params", `${label} must be a string`);
  }

  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9-]{2,64}$/.test(normalized)) {
    throw new ApiError(
      400,
      "invalid_params",
      `${label} must be 2-64 chars of lowercase letters, numbers, or hyphens`,
    );
  }

  return normalized;
}

function normalizeDisplayName(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_params", `${label} must be a string`);
  }

  const normalized = value.trim();
  if (!normalized || normalized.length > 120) {
    throw new ApiError(
      400,
      "invalid_params",
      `${label} must be between 1 and 120 characters`,
    );
  }

  return normalized;
}

function normalizeNullableSymbol(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_params", "symbol must be a string");
  }

  const normalized = value.trim();
  if (normalized.length > 24) {
    throw new ApiError(400, "invalid_params", "symbol must be 24 characters or fewer");
  }

  return normalized || null;
}

function normalizeAdminWallet(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_params", "admin_wallet must be a string");
  }

  const normalized =
    normalizeAddress(value) ?? normalizeAddress(value, "solana");
  if (!normalized) {
    throw new ApiError(400, "invalid_params", "admin_wallet is invalid");
  }

  return normalized;
}

function normalizeAssetKind(value: unknown): BungalowAssetKind {
  if (value === "fungible_token" || value === "nft_collection") {
    return value;
  }

  throw new ApiError(
    400,
    "invalid_params",
    "asset.kind must be 'fungible_token' or 'nft_collection'",
  );
}

function normalizeChain(value: unknown, label: string): SupportedChain {
  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_params", `${label} must be a string`);
  }

  const chain = toSupportedChain(value);
  if (!chain) {
    throw new ApiError(400, "invalid_params", `${label} is invalid`);
  }

  return chain;
}

function normalizeDeployment(
  value: unknown,
): CanonicalDeploymentRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "invalid_params", "deployment must be an object");
  }

  const candidate = value as Record<string, unknown>;
  const chain = normalizeChain(candidate.chain, "deployment.chain");
  const tokenAddress = candidate.token_address;

  if (typeof tokenAddress !== "string") {
    throw new ApiError(
      400,
      "invalid_params",
      "deployment.token_address must be a string",
    );
  }

  const normalizedTokenAddress = normalizeAddress(tokenAddress, chain);
  if (!normalizedTokenAddress) {
    throw new ApiError(
      400,
      "invalid_params",
      "deployment.token_address is invalid",
    );
  }

  return {
    chain,
    token_address: normalizedTokenAddress,
  };
}

function clearCanonicalProjectCaches(project: Awaited<ReturnType<typeof getCanonicalProjectById>>) {
  if (!project) return;

  for (const asset of project.assets) {
    for (const deployment of asset.deployments) {
      clearCache(`bungalow:${deployment.chain}:${deployment.token_address}`);
    }
  }
}

bungalowAdminRoute.get("/bungalow-admin/projects", async (c) => {
  const projects = await listCanonicalProjects();
  return c.json({ projects });
});

bungalowAdminRoute.put("/bungalow-admin/projects/:projectId", async (c) => {
  const wallet = c.get("walletAddress");
  if (!wallet) {
    throw new ApiError(401, "unauthorized", "Wallet authentication required");
  }

  const projectId = normalizeProjectId(c.req.param("projectId"), "projectId");
  const existingAdminWallet = await getCanonicalProjectAdminWallet(projectId);
  const caller = wallet.toLowerCase();

  if (existingAdminWallet && existingAdminWallet.toLowerCase() !== caller) {
    throw new ApiError(
      403,
      "not_project_admin",
      "Only the project admin can update this bungalow graph",
    );
  }

  const existingProject = await getCanonicalProjectById(projectId);
  const body = await c.req.json<Record<string, unknown>>();
  const bodyId =
    body.id === undefined ? projectId : normalizeProjectId(body.id, "body.id");

  if (bodyId !== projectId) {
    throw new ApiError(400, "invalid_params", "Path projectId does not match body.id");
  }

  const slug = normalizeProjectId(body.slug ?? projectId, "slug");
  const name = normalizeDisplayName(body.name, "name");
  const symbol = normalizeNullableSymbol(body.symbol);
  const requestedAdminWallet =
    normalizeAdminWallet(body.admin_wallet) ??
    existingAdminWallet ??
    caller;

  if (!Array.isArray(body.assets) || body.assets.length === 0) {
    throw new ApiError(
      400,
      "invalid_params",
      "At least one asset is required",
    );
  }

  const assets = body.assets.map((assetRaw, index) => {
    if (!assetRaw || typeof assetRaw !== "object" || Array.isArray(assetRaw)) {
      throw new ApiError(400, "invalid_params", `asset ${index + 1} is invalid`);
    }

    const asset = assetRaw as Record<string, unknown>;
    const assetId = normalizeProjectId(
      asset.id ?? `${projectId}-asset-${index + 1}`,
      `asset ${index + 1} id`,
    );
    const assetName = normalizeDisplayName(asset.name, `asset ${index + 1} name`);
    const assetSymbol = normalizeNullableSymbol(asset.symbol);
    const kind = normalizeAssetKind(asset.kind);
    const preferredChain = normalizeChain(
      asset.preferred_chain,
      `asset ${index + 1} preferred_chain`,
    );

    if (!Array.isArray(asset.deployments) || asset.deployments.length === 0) {
      throw new ApiError(
        400,
        "invalid_params",
        `asset ${index + 1} must include at least one deployment`,
      );
    }

    const deployments = asset.deployments.map(normalizeDeployment);

    return {
      id: assetId,
      kind,
      name: assetName,
      symbol: assetSymbol,
      preferred_chain: preferredChain,
      deployments,
    };
  });

  const deploymentKeys = new Set<string>();
  for (const asset of assets) {
    for (const deployment of asset.deployments) {
      const key = `${deployment.chain}:${deployment.token_address}`;
      if (deploymentKeys.has(key)) {
        throw new ApiError(
          400,
          "invalid_params",
          `Duplicate deployment in payload: ${key}`,
        );
      }
      deploymentKeys.add(key);
    }
  }

  try {
    const project = await upsertCanonicalProject({
      id: projectId,
      slug,
      name,
      symbol,
      admin_wallet: requestedAdminWallet,
      updated_by: caller,
      assets,
    });

    clearCanonicalProjectCaches(existingProject);
    clearCanonicalProjectCaches(project);

    return c.json({
      ok: true,
      created: !existingProject,
      project,
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;

    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("already assigned") ? 409 : 500;
    const code = status === 409 ? "deployment_conflict" : "canonical_project_update_failed";
    throw new ApiError(status, code, message);
  }
});

bungalowAdminRoute.delete("/bungalow-admin/projects/:projectId", async (c) => {
  const wallet = c.get("walletAddress");
  if (!wallet) {
    throw new ApiError(401, "unauthorized", "Wallet authentication required");
  }

  const projectId = normalizeProjectId(c.req.param("projectId"), "projectId");
  const existingAdminWallet = await getCanonicalProjectAdminWallet(projectId);
  const existingProject = await getCanonicalProjectById(projectId);

  if (!existingProject) {
    throw new ApiError(404, "not_found", "Canonical project not found");
  }

  if (
    existingAdminWallet &&
    existingAdminWallet.toLowerCase() !== wallet.toLowerCase()
  ) {
    throw new ApiError(
      403,
      "not_project_admin",
      "Only the project admin can delete this bungalow graph",
    );
  }

  await deleteCanonicalProject(projectId);
  clearCanonicalProjectCaches(existingProject);

  return c.json({ ok: true });
});

export default bungalowAdminRoute;
