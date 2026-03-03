import { CONFIG, db, normalizeAddress, type SupportedChain } from "../config";

export type BungalowAssetKind = "fungible_token" | "nft_collection";

export interface CanonicalDeploymentRef {
  chain: SupportedChain;
  token_address: string;
}

export interface CanonicalAssetDefinition {
  id: string;
  kind: BungalowAssetKind;
  name: string;
  symbol: string | null;
  preferred_chain: SupportedChain;
  deployments: CanonicalDeploymentRef[];
}

export interface BungalowProjectDefinition {
  id: string;
  slug: string;
  name: string;
  symbol: string | null;
  assets: CanonicalAssetDefinition[];
}

interface CanonicalAssetRawDefinition {
  id: string;
  kind: BungalowAssetKind;
  name: string;
  symbol: string | null;
  preferred_chain: SupportedChain;
  deployments: Array<{
    chain: SupportedChain;
    token_address: string;
  }>;
}

interface BungalowProjectRawDefinition {
  id: string;
  slug: string;
  name: string;
  symbol: string | null;
  assets: CanonicalAssetRawDefinition[];
}

interface ProjectResolution {
  project: BungalowProjectDefinition;
  asset: CanonicalAssetDefinition;
  deployment: CanonicalDeploymentRef;
}

interface CanonicalState {
  loadedAt: number;
  projects: BungalowProjectDefinition[];
  bySlug: Map<string, BungalowProjectDefinition>;
  byDeploymentKey: Map<string, ProjectResolution>;
  byAddress: Map<string, ProjectResolution[]>;
}

interface CanonicalProjectRow {
  project_id: string;
  project_slug: string;
  project_name: string;
  project_symbol: string | null;
  asset_id: string | null;
  asset_kind: BungalowAssetKind | null;
  asset_name: string | null;
  asset_symbol: string | null;
  preferred_chain: SupportedChain | null;
  deployment_chain: SupportedChain | null;
  deployment_token_address: string | null;
}

const CACHE_TTL_MS = 30_000;

const SEEDED_BUNGALOW_PROJECTS: BungalowProjectRawDefinition[] = [
  {
    id: "jungle-bay",
    slug: "jungle-bay",
    name: "Jungle Bay",
    symbol: null,
    assets: [
      {
        id: "jbm",
        kind: "fungible_token",
        name: "Jungle Bay Memes",
        symbol: "JBM",
        preferred_chain: "base",
        deployments: [
          {
            chain: "base",
            token_address: "0x3313338fe4bb2a166b81483bfcb2d4a6a1ebba8d",
          },
        ],
      },
      {
        id: "jbac",
        kind: "nft_collection",
        name: "Junglebay",
        symbol: "JBAC",
        preferred_chain: "ethereum",
        deployments: [
          {
            chain: "ethereum",
            token_address: "0xd37264c71e9af940e49795f0d3a8336afaafdda9",
          },
        ],
      },
    ],
  },
  {
    id: "bobo",
    slug: "bobo",
    name: "BOBO",
    symbol: "BOBO",
    assets: [
      {
        id: "bobo-token",
        kind: "fungible_token",
        name: "BOBO",
        symbol: "BOBO",
        preferred_chain: "base",
        deployments: [
          {
            chain: "base",
            token_address: "0x570b1533f6daa82814b25b62b5c7c4c55eb83947",
          },
          {
            chain: "ethereum",
            token_address: "0xb90b2a35c65dbc466b04240097ca756ad2005295",
          },
        ],
      },
    ],
  },
  {
    id: "rizz",
    slug: "rizz",
    name: "RIZZ",
    symbol: "RIZZ",
    assets: [
      {
        id: "rizz-token",
        kind: "fungible_token",
        name: "RIZZ",
        symbol: "RIZZ",
        preferred_chain: "base",
        deployments: [
          {
            chain: "base",
            token_address: "0x58d6e314755c2668f3d7358cc7a7a06c4314b238",
          },
          {
            chain: "solana",
            token_address: "5ad4puH6yDBoeCcrQfwV5s9bxvPnAeWDoYDj3uLyBS8k",
          },
        ],
      },
    ],
  },
  {
    id: "toweli",
    slug: "toweli",
    name: "TOWELI",
    symbol: "TOWELI",
    assets: [
      {
        id: "toweli-token",
        kind: "fungible_token",
        name: "TOWELI",
        symbol: "TOWELI",
        preferred_chain: "base",
        deployments: [
          {
            chain: "base",
            token_address: "0x279e7cff2dbc93ff1f5cae6cbd072f98d75987ca",
          },
          {
            chain: "ethereum",
            token_address: "0x420698cfdeddea6bc78d59bc17798113ad278f9d",
          },
        ],
      },
    ],
  },
];

let ensurePromise: Promise<void> | null = null;
let cachedState: CanonicalState | null = null;
let loadPromise: Promise<CanonicalState> | null = null;

function normalizeTokenAddress(chain: SupportedChain, tokenAddress: string): string {
  if (chain === "solana") return tokenAddress.trim();
  return normalizeAddress(tokenAddress, chain) ?? tokenAddress.trim().toLowerCase();
}

function deploymentKey(chain: SupportedChain, tokenAddress: string): string {
  return `${chain}:${normalizeTokenAddress(chain, tokenAddress)}`;
}

function createImplicitAsset(
  chain: SupportedChain,
  tokenAddress: string,
): CanonicalAssetDefinition {
  const normalized = normalizeTokenAddress(chain, tokenAddress);
  return {
    id: `${chain}-${normalized}`,
    kind: "fungible_token",
    name: normalized,
    symbol: null,
    preferred_chain: chain,
    deployments: [
      {
        chain,
        token_address: normalized,
      },
    ],
  };
}

function createState(projects: BungalowProjectDefinition[]): CanonicalState {
  const bySlug = new Map<string, BungalowProjectDefinition>();
  const byDeploymentKey = new Map<string, ProjectResolution>();
  const byAddress = new Map<string, ProjectResolution[]>();

  for (const project of projects) {
    bySlug.set(project.slug.trim().toLowerCase(), project);

    for (const asset of project.assets) {
      for (const deployment of asset.deployments) {
        const normalizedDeployment = {
          chain: deployment.chain,
          token_address: normalizeTokenAddress(
            deployment.chain,
            deployment.token_address,
          ),
        };
        const resolution = {
          project,
          asset,
          deployment: normalizedDeployment,
        };

        byDeploymentKey.set(
          deploymentKey(
            normalizedDeployment.chain,
            normalizedDeployment.token_address,
          ),
          resolution,
        );

        const existing = byAddress.get(normalizedDeployment.token_address) ?? [];
        existing.push(resolution);
        byAddress.set(normalizedDeployment.token_address, existing);
      }
    }
  }

  return {
    loadedAt: Date.now(),
    projects,
    bySlug,
    byDeploymentKey,
    byAddress,
  };
}

function buildSeedProjects(): BungalowProjectDefinition[] {
  return SEEDED_BUNGALOW_PROJECTS.map((project) => ({
    ...project,
    assets: project.assets.map((asset) => ({
      ...asset,
      deployments: asset.deployments.map((deployment) => ({
        chain: deployment.chain,
        token_address: normalizeTokenAddress(
          deployment.chain,
          deployment.token_address,
        ),
      })),
    })),
  }));
}

async function ensureCanonicalTables(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await db`
        CREATE TABLE IF NOT EXISTS ${db(CONFIG.SCHEMA)}.bungalow_projects (
          id TEXT PRIMARY KEY,
          slug TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          symbol TEXT,
          admin_wallet TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_by TEXT
        )
      `;

      await db`
        CREATE TABLE IF NOT EXISTS ${db(CONFIG.SCHEMA)}.bungalow_project_assets (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES ${db(CONFIG.SCHEMA)}.bungalow_projects(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN ('fungible_token', 'nft_collection')),
          name TEXT NOT NULL,
          symbol TEXT,
          preferred_chain TEXT NOT NULL CHECK (preferred_chain IN ('base', 'ethereum', 'solana')),
          position INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await db`
        CREATE INDEX IF NOT EXISTS idx_bungalow_project_assets_project
        ON ${db(CONFIG.SCHEMA)}.bungalow_project_assets(project_id, position, id)
      `;

      await db`
        CREATE TABLE IF NOT EXISTS ${db(CONFIG.SCHEMA)}.bungalow_asset_deployments (
          asset_id TEXT NOT NULL REFERENCES ${db(CONFIG.SCHEMA)}.bungalow_project_assets(id) ON DELETE CASCADE,
          chain TEXT NOT NULL CHECK (chain IN ('base', 'ethereum', 'solana')),
          token_address TEXT NOT NULL,
          position INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (asset_id, chain, token_address),
          UNIQUE (chain, token_address)
        )
      `;

      await db`
        CREATE INDEX IF NOT EXISTS idx_bungalow_asset_deployments_asset
        ON ${db(CONFIG.SCHEMA)}.bungalow_asset_deployments(asset_id, position, chain)
      `;

      await seedCanonicalProjects();
    })();
  }

  await ensurePromise;
}

async function seedCanonicalProjects(): Promise<void> {
  const seededProjects = buildSeedProjects();

  await db.begin(async (tx) => {
    const trx = tx as unknown as typeof db;

    for (const [projectIndex, project] of seededProjects.entries()) {
      await trx`
        INSERT INTO ${db(CONFIG.SCHEMA)}.bungalow_projects (
          id,
          slug,
          name,
          symbol
        )
        VALUES (
          ${project.id},
          ${project.slug},
          ${project.name},
          ${project.symbol}
        )
        ON CONFLICT (id) DO NOTHING
      `;

      for (const [assetIndex, asset] of project.assets.entries()) {
        await trx`
          INSERT INTO ${db(CONFIG.SCHEMA)}.bungalow_project_assets (
            id,
            project_id,
            kind,
            name,
            symbol,
            preferred_chain,
            position
          )
          VALUES (
            ${asset.id},
            ${project.id},
            ${asset.kind},
            ${asset.name},
            ${asset.symbol},
            ${asset.preferred_chain},
            ${assetIndex}
          )
          ON CONFLICT (id) DO NOTHING
        `;

        for (const [deploymentIndex, deployment] of asset.deployments.entries()) {
          await trx`
            INSERT INTO ${db(CONFIG.SCHEMA)}.bungalow_asset_deployments (
              asset_id,
              chain,
              token_address,
              position
            )
            VALUES (
              ${asset.id},
              ${deployment.chain},
              ${deployment.token_address},
              ${deploymentIndex}
            )
            ON CONFLICT (chain, token_address) DO NOTHING
          `;
        }
      }

      void projectIndex;
    }
  });
}

async function loadCanonicalState(force = false): Promise<CanonicalState> {
  await ensureCanonicalTables();

  if (
    !force &&
    cachedState &&
    Date.now() - cachedState.loadedAt < CACHE_TTL_MS
  ) {
    return cachedState;
  }

  if (!force && loadPromise) {
    return loadPromise;
  }

  loadPromise = (async () => {
    try {
      const rows = await db<CanonicalProjectRow[]>`
        SELECT
          p.id AS project_id,
          p.slug AS project_slug,
          p.name AS project_name,
          p.symbol AS project_symbol,
          a.id AS asset_id,
          a.kind AS asset_kind,
          a.name AS asset_name,
          a.symbol AS asset_symbol,
          a.preferred_chain,
          d.chain AS deployment_chain,
          d.token_address AS deployment_token_address
        FROM ${db(CONFIG.SCHEMA)}.bungalow_projects p
        LEFT JOIN ${db(CONFIG.SCHEMA)}.bungalow_project_assets a
          ON a.project_id = p.id
        LEFT JOIN ${db(CONFIG.SCHEMA)}.bungalow_asset_deployments d
          ON d.asset_id = a.id
        ORDER BY p.slug ASC, a.position ASC, a.id ASC, d.position ASC, d.chain ASC
      `;

      const projectMap = new Map<string, BungalowProjectDefinition>();
      const assetMap = new Map<string, CanonicalAssetDefinition>();

      for (const row of rows) {
        let project = projectMap.get(row.project_id);
        if (!project) {
          project = {
            id: row.project_id,
            slug: row.project_slug,
            name: row.project_name,
            symbol: row.project_symbol ?? null,
            assets: [],
          };
          projectMap.set(project.id, project);
        }

        if (!row.asset_id || !row.asset_kind || !row.asset_name || !row.preferred_chain) {
          continue;
        }

        let asset = assetMap.get(row.asset_id);
        if (!asset) {
          asset = {
            id: row.asset_id,
            kind: row.asset_kind,
            name: row.asset_name,
            symbol: row.asset_symbol ?? null,
            preferred_chain: row.preferred_chain,
            deployments: [],
          };
          assetMap.set(asset.id, asset);
          project.assets.push(asset);
        }

        if (row.deployment_chain && row.deployment_token_address) {
          asset.deployments.push({
            chain: row.deployment_chain,
            token_address: normalizeTokenAddress(
              row.deployment_chain,
              row.deployment_token_address,
            ),
          });
        }
      }

      const projects = [...projectMap.values()];
      const state = createState(projects);
      cachedState = state;
      return state;
    } finally {
      loadPromise = null;
    }
  })();

  return loadPromise;
}

function createProjectContextFromResolution(
  resolution: ProjectResolution,
): CanonicalProjectContext {
  const primaryAsset = getCanonicalPrimaryAsset(resolution.project);

  return {
    project: resolution.project,
    activeAsset: resolution.asset,
    primaryAsset,
    activeDeployment: resolution.deployment,
    primaryDeployment: getCanonicalPrimaryDeployment(primaryAsset),
    assets: resolution.project.assets,
    deployments: resolution.project.assets.flatMap((asset) => asset.deployments),
  };
}

export interface CanonicalProjectContext {
  project: BungalowProjectDefinition | null;
  activeAsset: CanonicalAssetDefinition;
  primaryAsset: CanonicalAssetDefinition;
  activeDeployment: CanonicalDeploymentRef;
  primaryDeployment: CanonicalDeploymentRef;
  assets: CanonicalAssetDefinition[];
  deployments: CanonicalDeploymentRef[];
}

export interface UpsertBungalowProjectInput {
  id: string;
  slug: string;
  name: string;
  symbol: string | null;
  admin_wallet: string | null;
  updated_by: string;
  assets: Array<{
    id: string;
    kind: BungalowAssetKind;
    name: string;
    symbol: string | null;
    preferred_chain: SupportedChain;
    deployments: CanonicalDeploymentRef[];
  }>;
}

export function getCanonicalPrimaryAsset(
  project: BungalowProjectDefinition,
): CanonicalAssetDefinition {
  return project.assets[0];
}

export function getCanonicalPrimaryDeployment(
  asset: CanonicalAssetDefinition,
): CanonicalDeploymentRef {
  return (
    asset.deployments.find(
      (deployment) => deployment.chain === asset.preferred_chain,
    ) ?? asset.deployments[0]
  );
}

export function invalidateCanonicalProjectCache(): void {
  cachedState = null;
  loadPromise = null;
}

export async function listCanonicalProjects(): Promise<BungalowProjectDefinition[]> {
  const state = await loadCanonicalState();
  return state.projects;
}

export async function getCanonicalProjectById(
  projectId: string,
): Promise<BungalowProjectDefinition | null> {
  const state = await loadCanonicalState();
  return state.projects.find((project) => project.id === projectId) ?? null;
}

export async function getCanonicalProjectAdminWallet(
  projectId: string,
): Promise<string | null> {
  await ensureCanonicalTables();
  const rows = await db<Array<{ admin_wallet: string | null }>>`
    SELECT admin_wallet
    FROM ${db(CONFIG.SCHEMA)}.bungalow_projects
    WHERE id = ${projectId}
    LIMIT 1
  `;
  return rows[0]?.admin_wallet ?? null;
}

export async function getCanonicalProjectBySlug(
  slug: string,
): Promise<BungalowProjectDefinition | null> {
  const state = await loadCanonicalState();
  return state.bySlug.get(slug.trim().toLowerCase()) ?? null;
}

export async function getCanonicalProjectForDeployment(
  chain: SupportedChain,
  tokenAddress: string,
): Promise<BungalowProjectDefinition | null> {
  const state = await loadCanonicalState();
  return (
    state.byDeploymentKey.get(deploymentKey(chain, tokenAddress))?.project ?? null
  );
}

export async function getCanonicalProjectContext(
  chain: SupportedChain,
  tokenAddress: string,
): Promise<CanonicalProjectContext> {
  const state = await loadCanonicalState();
  const resolution = state.byDeploymentKey.get(deploymentKey(chain, tokenAddress));

  if (!resolution) {
    const activeAsset = createImplicitAsset(chain, tokenAddress);
    const primaryDeployment = getCanonicalPrimaryDeployment(activeAsset);

    return {
      project: null,
      activeAsset,
      primaryAsset: activeAsset,
      activeDeployment: {
        chain,
        token_address: normalizeTokenAddress(chain, tokenAddress),
      },
      primaryDeployment,
      assets: [activeAsset],
      deployments: [...activeAsset.deployments],
    };
  }

  return createProjectContextFromResolution(resolution);
}

export async function getCanonicalProjectContextBySlug(
  slug: string,
): Promise<CanonicalProjectContext | null> {
  const project = await getCanonicalProjectBySlug(slug);
  if (!project) return null;

  const primaryAsset = getCanonicalPrimaryAsset(project);
  const primaryDeployment = getCanonicalPrimaryDeployment(primaryAsset);

  return {
    project,
    activeAsset: primaryAsset,
    primaryAsset,
    activeDeployment: primaryDeployment,
    primaryDeployment,
    assets: project.assets,
    deployments: project.assets.flatMap((asset) => asset.deployments),
  };
}

export async function getCanonicalProjectContextByIdentifier(
  identifier: string,
): Promise<CanonicalProjectContext | null> {
  const slugMatch = await getCanonicalProjectContextBySlug(identifier);
  if (slugMatch) return slugMatch;

  const state = await loadCanonicalState();
  const normalized = identifier.trim();
  if (!normalized) return null;

  const candidates = [
    normalizeAddress(normalized, "base"),
    normalizeAddress(normalized, "ethereum"),
    normalizeAddress(normalized, "solana"),
    normalized,
  ].filter((value): value is string => Boolean(value));

  const exactMatches = candidates.flatMap(
    (candidate) => state.byAddress.get(candidate) ?? [],
  );

  if (exactMatches.length === 0) return null;
  if (exactMatches.length === 1) {
    return createProjectContextFromResolution(exactMatches[0]);
  }

  const projectIds = new Set(exactMatches.map((match) => match.project.id));
  if (projectIds.size !== 1) {
    return null;
  }

  const preferred =
    exactMatches.find(
      (match) => match.deployment.chain === match.asset.preferred_chain,
    ) ?? exactMatches[0];

  return createProjectContextFromResolution(preferred);
}

export async function upsertCanonicalProject(
  input: UpsertBungalowProjectInput,
): Promise<BungalowProjectDefinition> {
  await ensureCanonicalTables();

  await db.begin(async (tx) => {
    const trx = tx as unknown as typeof db;

    await trx`
      INSERT INTO ${db(CONFIG.SCHEMA)}.bungalow_projects (
        id,
        slug,
        name,
        symbol,
        admin_wallet,
        updated_at,
        updated_by
      )
      VALUES (
        ${input.id},
        ${input.slug},
        ${input.name},
        ${input.symbol},
        ${input.admin_wallet},
        NOW(),
        ${input.updated_by}
      )
      ON CONFLICT (id) DO UPDATE SET
        slug = EXCLUDED.slug,
        name = EXCLUDED.name,
        symbol = EXCLUDED.symbol,
        admin_wallet = EXCLUDED.admin_wallet,
        updated_at = NOW(),
        updated_by = EXCLUDED.updated_by
    `;

    const assetIds = input.assets.map((asset) => asset.id);
    if (assetIds.length > 0) {
      await trx`
        DELETE FROM ${db(CONFIG.SCHEMA)}.bungalow_project_assets
        WHERE project_id = ${input.id}
          AND id NOT IN ${db(assetIds)}
      `;
    } else {
      await trx`
        DELETE FROM ${db(CONFIG.SCHEMA)}.bungalow_project_assets
        WHERE project_id = ${input.id}
      `;
    }

    for (const [assetIndex, asset] of input.assets.entries()) {
      await trx`
        INSERT INTO ${db(CONFIG.SCHEMA)}.bungalow_project_assets (
          id,
          project_id,
          kind,
          name,
          symbol,
          preferred_chain,
          position,
          updated_at
        )
        VALUES (
          ${asset.id},
          ${input.id},
          ${asset.kind},
          ${asset.name},
          ${asset.symbol},
          ${asset.preferred_chain},
          ${assetIndex},
          NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          project_id = EXCLUDED.project_id,
          kind = EXCLUDED.kind,
          name = EXCLUDED.name,
          symbol = EXCLUDED.symbol,
          preferred_chain = EXCLUDED.preferred_chain,
          position = EXCLUDED.position,
          updated_at = NOW()
      `;

      const deploymentKeys = asset.deployments.map(
        (deployment) =>
          `${deployment.chain}:${normalizeTokenAddress(
            deployment.chain,
            deployment.token_address,
          )}`,
      );

      const existingDeployments = await trx<
        Array<{ chain: SupportedChain; token_address: string }>
      >`
        SELECT chain, token_address
        FROM ${db(CONFIG.SCHEMA)}.bungalow_asset_deployments
        WHERE asset_id = ${asset.id}
      `;

      for (const existingDeployment of existingDeployments) {
        const key = `${existingDeployment.chain}:${existingDeployment.token_address}`;
        if (deploymentKeys.includes(key)) continue;

        await trx`
          DELETE FROM ${db(CONFIG.SCHEMA)}.bungalow_asset_deployments
          WHERE asset_id = ${asset.id}
            AND chain = ${existingDeployment.chain}
            AND token_address = ${existingDeployment.token_address}
        `;
      }

      for (const [deploymentIndex, deployment] of asset.deployments.entries()) {
        const normalizedTokenAddress = normalizeTokenAddress(
          deployment.chain,
          deployment.token_address,
        );

        const conflicting = await trx<
          Array<{ asset_id: string }>
        >`
          SELECT asset_id
          FROM ${db(CONFIG.SCHEMA)}.bungalow_asset_deployments
          WHERE chain = ${deployment.chain}
            AND token_address = ${normalizedTokenAddress}
            AND asset_id <> ${asset.id}
          LIMIT 1
        `;

        if (conflicting.length > 0) {
          throw new Error(
            `Deployment ${deployment.chain}:${normalizedTokenAddress} is already assigned to another asset`,
          );
        }

        await trx`
          INSERT INTO ${db(CONFIG.SCHEMA)}.bungalow_asset_deployments (
            asset_id,
            chain,
            token_address,
            position,
            updated_at
          )
          VALUES (
            ${asset.id},
            ${deployment.chain},
            ${normalizedTokenAddress},
            ${deploymentIndex},
            NOW()
          )
          ON CONFLICT (asset_id, chain, token_address) DO UPDATE SET
            position = EXCLUDED.position,
            updated_at = NOW()
        `;
      }
    }
  });

  invalidateCanonicalProjectCache();
  const project = await getCanonicalProjectById(input.id);
  if (!project) {
    throw new Error("Failed to load canonical project after update");
  }
  return project;
}

export async function deleteCanonicalProject(projectId: string): Promise<void> {
  await ensureCanonicalTables();
  await db`
    DELETE FROM ${db(CONFIG.SCHEMA)}.bungalow_projects
    WHERE id = ${projectId}
  `;
  invalidateCanonicalProjectCache();
}
