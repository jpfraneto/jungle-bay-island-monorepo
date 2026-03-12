export type WallItemType = "link" | "image" | "frame" | "portal";

export const ITEM_PRICES: Record<WallItemType, number> = {
  frame: 50_000,
  link: 69_000,
  image: 250_000,
  portal: 1_000_000,
};

export const ITEM_LABELS: Record<WallItemType, string> = {
  frame: "Post",
  link: "Link",
  image: "Image",
  portal: "Portal",
};

export const GLOW_COLORS = [
  "#f1c40f",
  "#2ecc71",
  "#e74c3c",
  "#1abc9c",
  "#3498db",
  "#9b59b6",
  "#e91e63",
  "#f39c12",
  "#27ae60",
  "#2980b9",
  "#16a085",
  "#e67e22",
] as const;

export const JBM_ADDRESS = import.meta.env.VITE_JBM_ADDRESS;

export const TREASURY_ADDRESS = import.meta.env.VITE_TREASURY_ADDRESS;
export const CLAIM_CONTRACT_ADDRESS = import.meta.env
  .VITE_CLAIM_CONTRACT_ADDRESS;
export const MEMETICS_CONTRACT_ADDRESS =
  import.meta.env.VITE_MEMETICS_CONTRACT_ADDRESS ??
  "0xaa027CFC273e58BD19a5df9a803598DF9Bebad1C";
