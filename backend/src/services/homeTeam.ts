import { normalizeAddress, type SupportedChain } from "../config";

export interface HomeTeamToken {
  chain: SupportedChain;
  token_address: string;
  name: string;
  symbol: string;
  image_url?: string | null;
}

const HOME_TEAM_PHASE_1_RAW: HomeTeamToken[] = [
  {
    chain: "ethereum",
    token_address: "0xd37264c71e9af940e49795f0d3a8336afaafdda9",
    name: "Jungle Bay Collection",
    symbol: "JBAC",
    image_url: "https://opensea.io/collection/junglebay/opengraph-image",
  },
  {
    chain: "base",
    token_address: "0x3313338fe4bb2a166b81483bfcb2d4a6a1ebba8d",
    name: "Jungle Bay Memes",
    symbol: "JBM",
  },
  {
    chain: "base",
    token_address: "0x570b1533f6daa82814b25b62b5c7c4c55eb83947",
    name: "BOBO",
    symbol: "BOBO",
  },
  {
    chain: "ethereum",
    token_address: "0xb90b2a35c65dbc466b04240097ca756ad2005295",
    name: "BOBO",
    symbol: "BOBO",
  },
  {
    chain: "solana",
    token_address: "8NNXWrWVctNw1UFeaBypffimTdcLCcD8XJzHvYsmgwpF",
    name: "BRAINLET",
    symbol: "BRAINLET",
  },
  {
    chain: "base",
    token_address: "0xe3086852a4b125803c815a158249ae468a3254ca",
    name: "mfer",
    symbol: "MFER",
  },
  {
    chain: "base",
    token_address: "0x22af33fe49fd1fa80c7149773dde5890d3c76f3b",
    name: "BNKR",
    symbol: "BNKR",
  },
  {
    chain: "ethereum",
    token_address: "0x6982508145454ce325ddbe47a25d4ec3d2311933",
    name: "PEPE",
    symbol: "PEPE",
  },
  {
    chain: "base",
    token_address: "0x58d6e314755c2668f3d7358cc7a7a06c4314b238",
    name: "RIZZ",
    symbol: "RIZZ",
  },
  {
    chain: "solana",
    token_address: "5ad4puH6yDBoeCcrQfwV5s9bxvPnAeWDoYDj3uLyBS8k",
    name: "RIZZ",
    symbol: "RIZZ",
  },
  {
    chain: "base",
    token_address: "0x3ec2156d4c0a9cbdab4a016633b7bcf6a8d68ea2",
    name: "DebtReliefBot",
    symbol: "DRB",
  },
  {
    chain: "base",
    token_address: "0x3d01fe5a38ddbd307fdd635b4cb0e29681226d6f",
    name: "ALPHA",
    symbol: "ALPHA",
  },
  {
    chain: "base",
    token_address: "0x2b5050f01d64fbb3e4ac44dc07f0732bfb5ecadf",
    name: "QR",
    symbol: "QR",
  },
  {
    chain: "ethereum",
    token_address: "0x420698cfdeddea6bc78d59bc17798113ad278f9d",
    name: "TOWELI",
    symbol: "TOWELI",
  },
  {
    chain: "base",
    token_address: "0x279e7cff2dbc93ff1f5cae6cbd072f98d75987ca",
    name: "TOWELI",
    symbol: "TOWELI",
  },
];

function normalizeTokenAddress(chain: SupportedChain, tokenAddress: string): string {
  if (chain === "solana") return tokenAddress.trim();
  return normalizeAddress(tokenAddress) ?? tokenAddress.trim().toLowerCase();
}

function tokenKey(chain: SupportedChain, tokenAddress: string): string {
  return `${chain}:${normalizeTokenAddress(chain, tokenAddress)}`;
}

export function isPlaceholderMetadataLabel(value: string | null | undefined): boolean {
  if (!value) return true;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;
  return (
    normalized === "unknown" ||
    normalized === "$unknown" ||
    normalized === "?" ||
    normalized === "token" ||
    normalized === "null" ||
    normalized === "undefined" ||
    normalized === "n/a" ||
    normalized === "na"
  );
}

export function pickMetadataLabel(
  ...values: Array<string | null | undefined>
): string | null {
  for (const value of values) {
    if (!isPlaceholderMetadataLabel(value)) {
      return value!.trim();
    }
  }
  return null;
}

export const HOME_TEAM_PHASE_1: HomeTeamToken[] = HOME_TEAM_PHASE_1_RAW.map((token) => ({
  ...token,
  token_address: normalizeTokenAddress(token.chain, token.token_address),
}));

const HOME_TEAM_BY_KEY = new Map<string, HomeTeamToken>();
for (const token of HOME_TEAM_PHASE_1) {
  HOME_TEAM_BY_KEY.set(tokenKey(token.chain, token.token_address), token);
}

export function getHomeTeamToken(
  chain: SupportedChain,
  tokenAddress: string,
): HomeTeamToken | null {
  return HOME_TEAM_BY_KEY.get(tokenKey(chain, tokenAddress)) ?? null;
}
