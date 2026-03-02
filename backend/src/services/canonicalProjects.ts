import { normalizeAddress, type SupportedChain } from "../config";

export interface CanonicalDeploymentRef {
  chain: SupportedChain;
  token_address: string;
}

export interface CanonicalProjectDefinition {
  id: string;
  slug: string;
  name: string;
  symbol: string;
  preferred_chain: SupportedChain;
  deployments: CanonicalDeploymentRef[];
}

interface CanonicalProjectRawDefinition {
  id: string;
  slug: string;
  name: string;
  symbol: string;
  preferred_chain: SupportedChain;
  deployments: Array<{
    chain: SupportedChain;
    token_address: string;
  }>;
}

function normalizeTokenAddress(chain: SupportedChain, tokenAddress: string): string {
  if (chain === "solana") return tokenAddress.trim();
  return normalizeAddress(tokenAddress, chain) ?? tokenAddress.trim().toLowerCase();
}

function deploymentKey(chain: SupportedChain, tokenAddress: string): string {
  return `${chain}:${normalizeTokenAddress(chain, tokenAddress)}`;
}

const CANONICAL_PROJECTS_RAW: CanonicalProjectRawDefinition[] = [
  {
    id: "bobo",
    slug: "bobo",
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
  {
    id: "rizz",
    slug: "rizz",
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
  {
    id: "toweli",
    slug: "toweli",
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
];

const CANONICAL_PROJECTS: CanonicalProjectDefinition[] = CANONICAL_PROJECTS_RAW.map(
  (project) => ({
    ...project,
    deployments: project.deployments.map((deployment) => ({
      ...deployment,
      token_address: normalizeTokenAddress(
        deployment.chain,
        deployment.token_address,
      ),
    })),
  }),
);

const PROJECT_BY_DEPLOYMENT_KEY = new Map<string, CanonicalProjectDefinition>();

for (const project of CANONICAL_PROJECTS) {
  for (const deployment of project.deployments) {
    PROJECT_BY_DEPLOYMENT_KEY.set(
      deploymentKey(deployment.chain, deployment.token_address),
      project,
    );
  }
}

export interface CanonicalProjectContext {
  project: CanonicalProjectDefinition | null;
  primaryDeployment: CanonicalDeploymentRef;
  deployments: CanonicalDeploymentRef[];
}

export function getCanonicalProjectForDeployment(
  chain: SupportedChain,
  tokenAddress: string,
): CanonicalProjectDefinition | null {
  return PROJECT_BY_DEPLOYMENT_KEY.get(deploymentKey(chain, tokenAddress)) ?? null;
}

export function getCanonicalPrimaryDeployment(
  project: CanonicalProjectDefinition,
): CanonicalDeploymentRef {
  return (
    project.deployments.find(
      (deployment) => deployment.chain === project.preferred_chain,
    ) ?? project.deployments[0]
  );
}

export function getCanonicalProjectContext(
  chain: SupportedChain,
  tokenAddress: string,
): CanonicalProjectContext {
  const project = getCanonicalProjectForDeployment(chain, tokenAddress);
  if (!project) {
    const normalized = normalizeTokenAddress(chain, tokenAddress);
    return {
      project: null,
      primaryDeployment: {
        chain,
        token_address: normalized,
      },
      deployments: [
        {
          chain,
          token_address: normalized,
        },
      ],
    };
  }

  return {
    project,
    primaryDeployment: getCanonicalPrimaryDeployment(project),
    deployments: project.deployments,
  };
}
