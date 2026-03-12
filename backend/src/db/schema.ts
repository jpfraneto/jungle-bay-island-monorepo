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
  claimed_by_privy_user_id: string | null
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

export interface BungalowWallEventRow {
  id: number
  token_address: string
  chain: string
  wallet: string | null
  event_type: 'visit' | 'add_art' | 'add_build' | 'add_item'
  detail: string | null
  island_heat: string
  token_heat: string
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

export interface BungalowItemRow {
  id: number
  token_address: string
  chain: 'base' | 'ethereum' | 'solana'
  item_type: 'link' | 'image' | 'frame' | 'portal'
  content: unknown
  placed_by: string
  tx_hash: string
  jbm_amount: string
  active?: boolean
  moderated_reason?: string | null
  moderated_by?: string | null
  moderated_at?: string | null
  created_at: string
}

export interface BodegaCatalogRow {
  id: number
  creator_wallet: string
  creator_handle: string | null
  contract_artifact_id?: number | null
  contract_uri?: string | null
  origin_bungalow_token_address: string | null
  origin_bungalow_chain: 'base' | 'ethereum' | 'solana' | null
  asset_type: 'decoration' | 'miniapp' | 'game' | 'link' | 'image' | 'frame' | 'portal'
  title: string
  description: string | null
  /**
   * decoration: { preview_url, external_url, format: 'image' | 'glb' | 'usdz' }
   * miniapp: { url, name, description }
   * game: { url, name, description }
   * link: { url, title }
   * image: { image_url, caption }
   * frame: { text }
   * portal: { target_chain, target_ca, target_name }
   */
  content: unknown
  preview_url: string | null
  price_in_jbm: string
  install_count: number
  active: boolean
  submission_tx_hash: string | null
  submission_fee_jbm: string | null
  moderated_reason?: string | null
  moderated_by?: string | null
  moderated_at?: string | null
  created_at: string
}

export interface BodegaInstallRow {
  id: number
  catalog_item_id: number
  contract_artifact_id?: number | null
  contract_bungalow_id?: number | null
  installed_to_token_address: string
  installed_to_chain: 'base' | 'ethereum' | 'solana'
  installed_by_wallet: string
  tx_hash: string
  jbm_amount: string
  creator_credit_jbm: string
  credit_claimed: boolean
  created_at: string
}

export interface BonusHeatEventRow {
  id: number
  wallet: string
  token_address: string
  chain: 'base' | 'ethereum' | 'solana'
  event_type: 'item_added' | 'bodega_install' | 'bodega_submission'
  bonus_points: number
  created_at: string
}

export interface CommissionRecordRow {
  brief_id: string
  commission_id: number | null
  requester_privy_user_id: string
  requester_wallet: string
  requester_profile_id: number | null
  requester_handle: string | null
  bungalow_chain: 'base' | 'ethereum' | 'solana'
  bungalow_token_address: string
  bungalow_name: string | null
  rate_label: string
  prompt: string
  brief_uri: string
  budget_jbm: string
  claim_deadline: string
  delivery_deadline: string
  status: 'draft' | 'open' | 'claimed' | 'submitted' | 'disputed' | 'completed' | 'cancelled'
  created_tx_hash: string | null
  approved_application_id: number | null
  approved_artist_wallet: string | null
  approved_artist_profile_id: number | null
  approved_artist_handle: string | null
  artist_wallet: string | null
  artist_profile_id: number | null
  artist_handle: string | null
  claimed_tx_hash: string | null
  submitted_tx_hash: string | null
  approved_tx_hash: string | null
  cancelled_tx_hash: string | null
  payout_claim_tx_hash: string | null
  deliverable_uri: string | null
  submitted_at: string | null
  created_at: string
  updated_at: string
}

export interface CommissionApplicationRow {
  id: number
  commission_id: number
  artist_privy_user_id: string
  artist_wallet: string
  artist_profile_id: number | null
  artist_handle: string | null
  message: string | null
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn'
  created_at: string
  updated_at: string
}

export interface UserWalletLinkRow {
  id: number
  primary_wallet: string
  linked_wallet: string
  verification_signature: string
  verification_message: string
  created_at: string
}

export interface UserRow {
  id: string
  privy_user_id: string
  x_username: string | null
  email: string | null
  created_at: string
}

export interface UserWalletRow {
  id: string
  privy_user_id: string
  address: string
  source: 'privy_siwe' | 'privy_siws'
  linked_at: string
}

export interface ClaimHistoryRow {
  id: number
  wallet: string
  token_address: string
  chain: 'base' | 'ethereum' | 'solana'
  amount: string
  nonce: number
  signature: string
  claimed_at: string
}
