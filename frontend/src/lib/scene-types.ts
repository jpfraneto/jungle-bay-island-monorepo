export interface SceneConfig {
  version: '1.0';
  bungalowId: string;
  slots: SlotConfig[];
}

export interface SlotConfig {
  slotId: string;
  slotType: 'wall-frame' | 'shelf' | 'portal' | 'floor' | 'link';
  position: [number, number, number];
  rotation: [number, number, number];
  filled: boolean;
  decoration?: DecorationConfig;
}

export interface DecorationConfig {
  type: 'image' | 'portal' | 'furniture' | 'social-link' | 'website-link' | 'decoration';
  name: string;
  imageUrl?: string;
  linkUrl?: string;
  modelId?: string;
  placedBy: string;
  placedAt: string;
  jbmBurned: number;
}

export interface AssetCatalogItem {
  id: string;
  name: string;
  type: DecorationConfig['type'];
  category: string;
  price_jbm: number;
  thumbnail_url: string;
  model_url?: string;
  description: string;
  community_created?: boolean;
  creator_name?: string;
}

export interface AssetPurchaseRecord {
  id: string;
  chain: string;
  ca: string;
  slotId: string;
  assetId: string;
  wallet: string;
  txHash?: string;
  purchasedAt: string;
}
