export type WallItemType = "link" | "image" | "frame" | "portal";

export const ITEM_PRICES: Record<WallItemType, number> = {
  link: 69_000,
  frame: 50_000,
  image: 250_000,
  portal: 1_000_000,
};

export const ITEM_LABELS: Record<WallItemType, string> = {
  link: "Link",
  frame: "Frame",
  image: "Image",
  portal: "Portal",
};

export const GLOW_COLORS = [
  "#f1c40f", "#2ecc71", "#e74c3c", "#1abc9c",
  "#3498db", "#9b59b6", "#e91e63", "#f39c12",
  "#27ae60", "#2980b9", "#16a085", "#e67e22",
] as const;

export const JBM_ADDRESS =
  import.meta.env.VITE_JBM_ADDRESS ?? "0x33130dc28e1e4e8e6a34b1d0e5b3a8bfba8dba8d";

export const TREASURY_ADDRESS = import.meta.env.VITE_TREASURY_ADDRESS ?? "";
export const CLAIM_CONTRACT_ADDRESS = import.meta.env.VITE_CLAIM_CONTRACT_ADDRESS ?? "";
