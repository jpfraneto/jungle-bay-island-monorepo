export type SlotType = "wall-frame" | "shelf" | "portal" | "floor" | "link";
export type DecorationType =
  | "image"
  | "portal"
  | "furniture"
  | "social-link"
  | "website-link"
  | "decoration";

export interface DecorationConfig {
  type: DecorationType;
  name: string;
  imageUrl?: string;
  linkUrl?: string;
  modelId?: string;
  placedBy: string;
  placedByHandle?: string | null;
  placedAt: string;
  jbmBurned: number;
}

export interface SlotConfig {
  slotId: string;
  slotType: SlotType;
  position: [number, number, number];
  rotation: [number, number, number];
  filled: boolean;
  decoration?: DecorationConfig;
}

export interface SceneConfig {
  version: "1.0";
  bungalowId: string;
  slots: SlotConfig[];
}
