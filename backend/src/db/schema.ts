export interface TokenRegistryRow {
  token_address: string
  chain: 'base' | 'ethereum' | 'solana'
  name: string | null
  symbol: string | null
  decimals: number | null
  total_supply: string | null
  deploy_block: number | null
  deploy_timestamp: number | null
  is_home_team: boolean | null
  scan_status: 'pending' | 'scanning' | 'complete' | 'failed'
  last_scanned_at: string | null
  last_scan_block: number | null
  holder_count: number
  transfer_timeline: unknown | null
  created_at: string
}

export interface BungalowRow {
  token_address: string
  chain: 'base' | 'ethereum' | 'solana'
  name: string | null
  symbol: string | null
  ipfs_hash: string | null
  current_owner: string | null
  verified_admin: string | null
  is_verified: boolean
  is_claimed: boolean
  description: string | null
  origin_story: string | null
  holder_count: number
  total_supply: string | null
  link_x: string | null
  link_farcaster: string | null
  link_telegram: string | null
  link_website: string | null
  link_dexscreener: string | null
  image_url: string | null
  price_usd: string | null
  market_cap: string | null
  volume_24h: string | null
  liquidity_usd: string | null
  metadata_updated_at: string | null
}

export interface BulletinPostRow {
  id: number
  token_address: string
  chain: string
  wallet: string
  content: string
  image_url: string | null
  created_at: string
}

export interface TokenHolderRow {
  wallet: string
  heat_degrees: string
  island_heat: string | null
  fid: number | null
  username: string | null
  pfp_url: string | null
}

export interface FidIslandProfileRow {
  fid: number
  username: string
  display_name: string
  pfp_url: string
  follower_count: number
  following_count: number
  neynar_score: string | null
  island_heat: string
  tier: string
  wallet_count: number
  wallets: unknown
  token_breakdown: unknown
}

export interface ScanLogRow {
  id: number
  token_address: string
  chain: 'base' | 'ethereum' | 'solana'
  requested_by: string
  requester_fid: number | null
  requester_tier: string | null
  payment_method: string
  payment_amount: string
  scan_status: 'pending' | 'running' | 'complete' | 'failed'
  events_fetched: number
  holders_found: number
  rpc_calls_made: number
  progress_phase: string | null
  progress_pct: string | null
  progress_detail: string | null
  started_at: string
  completed_at: string | null
  error_message: string | null
}

export interface BungalowSceneRow {
  id: number
  chain: 'base' | 'ethereum' | 'solana'
  contract_address: string
  scene_config: unknown
  updated_at: string
  updated_by: string | null
}

export interface AssetCatalogRow {
  id: string
  name: string
  type: string
  category: string
  price_jbm: string
  thumbnail_url: string
  model_url: string | null
  description: string
}

export interface AssetPurchaseRow {
  id: string
  chain: 'base' | 'ethereum'
  contract_address: string
  slot_id: string
  asset_id: string
  wallet: string
  tx_hash: string | null
  purchased_at: string
}

export interface BungalowWidgetInstallRow {
  id: string
  chain: string
  token_address: string
  widget_id: string
  package_name: string
  version: string
  repo_url: string | null
  installed_by: string
  installed_at: string
}
