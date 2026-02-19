export type Tier = 'drifter' | 'observer' | 'resident' | 'builder' | 'elder';

export interface FarcasterProfile {
  fid: number;
  username: string;
  display_name?: string;
  pfp_url?: string;
}

export interface Holder {
  rank: number;
  wallet: string;
  heat_degrees: number;
  tier: Tier;
  balance?: string;
  farcaster?: FarcasterProfile;
  island_heat?: number;
}

export interface TierCount {
  tier: Tier;
  count: number;
}

export interface TokenVitals {
  total_supply?: string;
  holder_count: number;
  dex_url?: string;
}

export interface ExternalLinks {
  x?: string;
  farcaster?: string;
  telegram?: string;
  website?: string;
  dexscreener?: string;
}

export interface MarketData {
  price_usd: number | null;
  market_cap: number | null;
  volume_24h: number | null;
  liquidity_usd: number | null;
  updated_at: string | null;
}

export interface BulletinPost {
  id: number;
  wallet: string;
  content: string;
  image_url?: string;
  created_at: string;
  poster_username?: string | null;
  poster_pfp?: string | null;
  // Global feed fields
  token_address?: string;
  chain?: string;
  token_name?: string | null;
  token_symbol?: string | null;
  bungalow_image_url?: string | null;
}

export interface BulletinResponse {
  posts: BulletinPost[];
  total: number;
}

export interface Bungalow {
  chain: string;
  ca: string;
  owner_wallet?: string;
  token_name: string;
  token_symbol: string;
  description?: string;
  origin_story?: string;
  claimed: boolean;
  verified: boolean;
  owner_farcaster?: FarcasterProfile;
  scanned: boolean;
  scan_active?: boolean;
  vitals?: TokenVitals;
  links?: ExternalLinks;
  holders?: Holder[];
  heat_distribution?: TierCount[];
  image_url?: string;
  market_data?: MarketData;
}

export interface ViewerContext {
  wallet: string;
  is_owner?: boolean;
  holds_token: boolean;
  token_heat_degrees?: number;
  island_heat?: number;
  tier?: Tier;
  scans_remaining?: number;
}

export interface BungalowResponse {
  bungalow: Bungalow;
  viewer_context?: ViewerContext;
}

export interface PersonaToken {
  chain: string;
  ca: string;
  token_name: string;
  token_symbol: string;
  heat_degrees: number;
}

export interface PersonaWallet {
  wallet: string;
  heat_degrees?: number;
}

export interface PersonaScanActivity {
  id: string;
  chain: string;
  ca: string;
  created_at: string;
}

export interface PersonaResponse {
  profile: FarcasterProfile;
  island_heat: number;
  tier: Tier;
  wallet_count: number;
  wallets: PersonaWallet[];
  token_breakdown: PersonaToken[];
  scan_log: PersonaScanActivity[];
  bungalows_claimed: { chain: string; ca: string; token_symbol: string }[];
}

export interface LeaderboardEntry {
  rank: number;
  island_heat: number;
  tier: Tier;
  wallet_count: number;
  profile: FarcasterProfile;
  top_tokens: PersonaToken[];
}

export interface LeaderboardResponse {
  page: number;
  page_size: number;
  total: number;
  total_wallets?: number;
  tokens_scanned?: number;
  tier_distribution: TierCount[];
  rows: LeaderboardEntry[];
}

export interface ScanCreateResponse {
  scan_id: number;
}

export interface ScanStatusResponse {
  id: number;
  scan_id?: number;
  token_address: string;
  chain: 'base' | 'ethereum';
  status: 'running' | 'complete' | 'failed' | 'pending';
  progress_phase?: string | null;
  progress_pct?: number | null;
  events_fetched: number;
  holders_found: number;
  rpc_calls_made: number;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
}

export interface WidgetCatalogItem {
  id: string;
  name: string;
  description: string;
  package_name: string;
  version: string;
  repo_url: string;
  category: 'analytics' | 'social' | 'governance' | 'commerce';
  install_command: string;
}

export interface WidgetInstallRecord {
  id: string;
  chain: string;
  token_address: string;
  widget_id: string;
  package_name: string;
  version: string;
  repo_url: string | null;
  installed_by: string;
  installed_at: string;
}

export interface WidgetCatalogResponse {
  chain: string;
  token_address: string;
  items: WidgetCatalogItem[];
}

export interface InstalledWidgetsResponse {
  chain: string;
  token_address: string;
  items: WidgetInstallRecord[];
  total: number;
}
