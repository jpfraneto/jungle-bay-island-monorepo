import { formatAddress } from "./formatters";

export type BodegaAssetType =
  | "decoration"
  | "game"
  | "miniapp"
  | "link"
  | "image";

export interface BodegaCatalogItem {
  id: number;
  creator_wallet: string;
  creator_handle: string | null;
  origin_bungalow_token_address: string | null;
  origin_bungalow_chain: string | null;
  asset_type: BodegaAssetType;
  title: string;
  description: string | null;
  content: Record<string, unknown>;
  preview_url: string | null;
  price_in_jbm: string;
  install_count: number;
  active: boolean;
  created_at: string;
}

export interface BodegaInstallRecord {
  id: number;
  catalog_item_id: number;
  installed_to_token_address: string;
  installed_to_chain: string;
  installed_by_wallet: string;
  tx_hash: string;
  jbm_amount: string;
  creator_credit_jbm: string;
  credit_claimed: boolean;
  created_at: string;
  catalog_item: BodegaCatalogItem | null;
}

export interface DirectoryBungalow {
  chain: string;
  token_address: string;
  name: string | null;
  symbol: string | null;
  image_url: string | null;
}

function asObject(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }

  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }

  return {};
}

function asString(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

function asNumber(input: unknown): number {
  const numeric = Number(input ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

export const BODEGA_ASSET_LABELS: Record<BodegaAssetType, string> = {
  decoration: "Decorations",
  game: "Games",
  miniapp: "Miniapps",
  link: "Links",
  image: "Images",
};

export const BODEGA_ASSET_SINGULAR_LABELS: Record<BodegaAssetType, string> = {
  decoration: "Decoration",
  game: "Game",
  miniapp: "Miniapp",
  link: "Link",
  image: "Image",
};

export const BODEGA_ASSET_DESCRIPTIONS: Record<BodegaAssetType, string> = {
  decoration: "Portable decor that gives a bungalow visual character.",
  game: "Playful destinations and micro-games communities can host.",
  miniapp: "Useful tools and lightweight apps that live inside a bungalow.",
  link: "Fast utility links, resources, and off-island exits.",
  image: "Visual artifacts, posters, and gallery-style drops.",
};

export function normalizeDirectoryBungalows(input: unknown): DirectoryBungalow[] {
  if (!Array.isArray(input)) return [];

  return input
    .map((raw) => {
      const item = raw as Record<string, unknown>;
      const chain = asString(item.chain);
      const tokenAddress = asString(item.token_address ?? item.ca);
      if (!chain || !tokenAddress) return null;

      return {
        chain,
        token_address: tokenAddress,
        name: asString(item.name || item.token_name) || null,
        symbol: asString(item.symbol || item.token_symbol) || null,
        image_url: asString(item.image_url) || null,
      };
    })
    .filter((item): item is DirectoryBungalow => item !== null);
}

export function normalizeBodegaCatalogItem(input: unknown): BodegaCatalogItem | null {
  const item = asObject(input);
  const id = asNumber(item.id);
  const assetType = asString(item.asset_type) as BodegaAssetType;

  if (!id || !assetType || !asString(item.title)) {
    return null;
  }

  return {
    id,
    creator_wallet: asString(item.creator_wallet),
    creator_handle: asString(item.creator_handle) || null,
    origin_bungalow_token_address:
      asString(item.origin_bungalow_token_address) || null,
    origin_bungalow_chain: asString(item.origin_bungalow_chain) || null,
    asset_type: assetType,
    title: asString(item.title),
    description: asString(item.description) || null,
    content: asObject(item.content),
    preview_url: asString(item.preview_url) || null,
    price_in_jbm: asString(item.price_in_jbm) || "0",
    install_count: asNumber(item.install_count),
    active: Boolean(item.active),
    created_at: asString(item.created_at),
  };
}

export function normalizeBodegaCatalogItems(input: unknown): BodegaCatalogItem[] {
  if (!Array.isArray(input)) return [];

  return input
    .map((item) => normalizeBodegaCatalogItem(item))
    .filter((item): item is BodegaCatalogItem => item !== null);
}

export function normalizeBodegaInstallRecords(input: unknown): BodegaInstallRecord[] {
  if (!Array.isArray(input)) return [];

  return input
    .map((raw) => {
      const item = asObject(raw);
      const id = asNumber(item.id);
      if (!id) return null;

      const catalogItem = normalizeBodegaCatalogItem(item.catalog_item);

      return {
        id,
        catalog_item_id: asNumber(item.catalog_item_id),
        installed_to_token_address: asString(item.installed_to_token_address),
        installed_to_chain: asString(item.installed_to_chain),
        installed_by_wallet: asString(item.installed_by_wallet),
        tx_hash: asString(item.tx_hash),
        jbm_amount: asString(item.jbm_amount) || "0",
        creator_credit_jbm: asString(item.creator_credit_jbm) || "0",
        credit_claimed: Boolean(item.credit_claimed),
        created_at: asString(item.created_at),
        catalog_item: catalogItem,
      };
    })
    .filter((item): item is BodegaInstallRecord => item !== null);
}

export function getBodegaAssetIcon(assetType: BodegaAssetType): string {
  if (assetType === "decoration") return "🪴";
  if (assetType === "game") return "🎮";
  if (assetType === "miniapp") return "🛠️";
  if (assetType === "link") return "🔗";
  return "🖼️";
}

export function getBodegaPreviewUrl(item: BodegaCatalogItem): string | null {
  if (item.preview_url) return item.preview_url;

  const content = item.content;
  if (item.asset_type === "decoration") {
    return asString(content.preview_url) || null;
  }
  if (item.asset_type === "image") {
    return asString(content.image_url) || null;
  }

  return null;
}

export function getBodegaSummaryText(item: BodegaCatalogItem): string {
  if (item.asset_type === "decoration") {
    return asString(item.content.external_url) || item.description || "Decor for the room.";
  }
  if (item.asset_type === "game" || item.asset_type === "miniapp") {
    return asString(item.content.url) || item.description || "Portable utility for a bungalow.";
  }
  if (item.asset_type === "link") {
    return asString(item.content.url) || item.description || "Shared off-island link.";
  }
  return asString(item.content.caption) || item.description || "An image ready for the wall.";
}

export function formatCreatorLabel(item: Pick<BodegaCatalogItem, "creator_handle" | "creator_wallet">): string {
  if (item.creator_handle) {
    return `@${item.creator_handle.replace(/^@+/, "")}`;
  }

  return formatAddress(item.creator_wallet);
}

export function getBungalowLookupKey(
  chain: string | null | undefined,
  tokenAddress: string | null | undefined,
): string | null {
  if (!chain || !tokenAddress) return null;
  return `${chain}:${tokenAddress.toLowerCase()}`;
}
