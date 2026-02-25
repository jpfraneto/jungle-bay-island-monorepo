# BACKEND_ARCHITECTURE

Generated from source code in `backend/` (read directly from `src/` and `scripts/`) on 2026-02-25.

This document is intentionally code-first for frontend handoff.

- Runtime routes are those mounted in `src/index.ts`.
- Some route modules exist but are not mounted (`auth.ts`, `wallet-link.ts`, `scene.ts`). They are documented separately as dormant.

## 1. Project Structure

### 1.1 Directory tree (2-3 levels)

```text
.
├── package.json
├── bun.lock
├── README.md
├── public/
│   ├── logo.svg
│   ├── icon.png
│   ├── og-image.png
│   ├── splash.png
│   ├── image.png
│   └── arkham.svg
├── scripts/
│   ├── migrate-v11.ts
│   ├── index-and-calculate.ts
│   ├── calculate-heat.ts
│   ├── resolve-farcaster.ts
│   ├── build-personas.ts
│   ├── backfill-metadata.ts
│   └── upload-bungalow.ts
└── src/
    ├── index.ts
    ├── config.ts
    ├── types.ts
    ├── contract.ts
    ├── db/
    │   ├── schema.ts
    │   └── queries.ts
    ├── middleware/
    │   ├── auth.ts
    │   ├── rateLimit.ts
    │   ├── requestId.ts
    │   └── requestLog.ts
    ├── routes/
    │   ├── health.ts
    │   ├── bungalow.ts
    │   ├── bungalows.ts
    │   ├── token.ts
    │   ├── user.ts
    │   ├── claim.ts
    │   ├── claim-price.ts
    │   ├── scan.ts
    │   ├── leaderboard.ts
    │   ├── persona.ts
    │   ├── og.ts
    │   ├── agent.ts
    │   ├── widget.ts
    │   ├── v1-bungalow.ts
    │   ├── auth.ts            (dormant: not mounted)
    │   ├── wallet-link.ts     (dormant: not mounted)
    │   └── scene.ts           (dormant: not mounted)
    ├── services/
    │   ├── scanner.ts
    │   ├── solanaScanner.ts
    │   ├── heat.ts
    │   ├── tokenMetadata.ts
    │   ├── dexscreener.ts
    │   ├── claimHeat.ts
    │   ├── payment.ts
    │   ├── identityMap.ts
    │   ├── session.ts
    │   ├── neynar.ts
    │   ├── farcaster.ts
    │   └── ...
    └── templates/
        ├── landing.ts
        ├── bungalow.ts
        ├── user.ts
        ├── client.ts
        ├── auth-ui.ts
        └── styles.ts
```

### 1.2 Framework, runtime, startup

Framework and runtime are explicit in `package.json` and `src/index.ts`:

```json
{
  "dependencies": {
    "hono": "^4.11.9",
    "postgres": "^3.4.7",
    "viem": "^2.38.3",
    "jose": "^5.9.6"
  },
  "scripts": {
    "dev": "bun --env-file=.env.local --hot src/index.ts",
    "start": "bun --watch --env-file=.env.local src/index.ts",
    "start:3000": "PORT=3000 bun --env-file=.env.local src/index.ts"
  }
}
```

Server export:

```ts
export default {
  port: CONFIG.PORT,
  fetch: app.fetch,
  idleTimeout: 120,
};
```

`CONFIG.PORT` default is `3001` (`src/config.ts`), but `.env.local` in repo sets `PORT=3000`.

### 1.3 Middleware pipeline (global)

From `src/index.ts`:

```ts
app.use("*", requestIdMiddleware);
app.use("*", requestLogMiddleware);
app.use("*", cors(...));
app.use("*", async (c, next) => { ... Cache-Control ... });
app.use("/api/*", createRateLimit({ limit: 100, windowMs: 60_000 }));
```

Meaning every API route gets:
- request ID + `X-Request-Id` response header
- request/response logging
- CORS
- default `Cache-Control: no-store` on `/api/*`
- global API rate limit (100/min, keyed by IP headers)

## 2. Database Schema

## 2.1 Database type and connection style

Database: PostgreSQL.

Connection is direct SQL via `postgres` package (not ORM):

```ts
export const db = postgres(CONFIG.DATABASE_URL, {
  max: 12,
  idle_timeout: 20,
  connect_timeout: 15,
})
```

App schema name is hardcoded in config:

```ts
SCHEMA: 'prod-v11'
```

## 2.2 Canonical tables and columns

Below are table definitions exactly as created/extended by code (`scripts/migrate-v11.ts`, `scripts/index-and-calculate.ts`, `scripts/resolve-farcaster.ts`, `scripts/build-personas.ts`, `src/db/queries.ts`, `src/services/payment.ts`, `src/routes/v1-bungalow.ts`, `src/routes/wallet-link.ts`).

### `"prod-v11".token_registry`

```sql
CREATE TABLE IF NOT EXISTS "prod-v11".token_registry (
  token_address TEXT PRIMARY KEY,
  chain TEXT NOT NULL DEFAULT 'base',
  name TEXT,
  symbol TEXT,
  decimals INTEGER,
  total_supply NUMERIC,
  deploy_block INTEGER,
  deploy_timestamp INTEGER,
  is_home_team BOOLEAN DEFAULT FALSE,
  scan_status TEXT DEFAULT 'pending',
  last_scanned_at TIMESTAMP,
  last_scan_block INTEGER,
  holder_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE "prod-v11".token_registry
  ADD COLUMN IF NOT EXISTS transfer_timeline JSONB;
```

### `"prod-v11".token_holder_heat`

```sql
CREATE TABLE IF NOT EXISTS "prod-v11".token_holder_heat (
  token_address TEXT NOT NULL,
  wallet TEXT NOT NULL,
  heat_degrees NUMERIC NOT NULL,
  balance_raw TEXT,
  first_seen_at INTEGER,
  last_transfer_at INTEGER,
  calculated_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (token_address, wallet)
);
CREATE INDEX IF NOT EXISTS idx_thh_token_heat
  ON "prod-v11".token_holder_heat (token_address, heat_degrees DESC);
CREATE INDEX IF NOT EXISTS idx_thh_wallet
  ON "prod-v11".token_holder_heat (wallet);
```

### `"prod-v11".scan_log`

```sql
CREATE TABLE IF NOT EXISTS "prod-v11".scan_log (
  id SERIAL PRIMARY KEY,
  token_address TEXT NOT NULL,
  chain TEXT NOT NULL DEFAULT 'base',
  requested_by TEXT NOT NULL,
  requester_fid INTEGER,
  requester_tier TEXT,
  payment_method TEXT NOT NULL DEFAULT 'free_resident',
  payment_amount NUMERIC DEFAULT 0,
  scan_status TEXT DEFAULT 'pending',
  events_fetched INTEGER DEFAULT 0,
  holders_found INTEGER DEFAULT 0,
  rpc_calls_made INTEGER DEFAULT 0,
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_scanlog_token ON "prod-v11".scan_log (token_address);
CREATE INDEX IF NOT EXISTS idx_scanlog_requester ON "prod-v11".scan_log (requested_by);

ALTER TABLE "prod-v11".scan_log ADD COLUMN IF NOT EXISTS progress_phase TEXT;
ALTER TABLE "prod-v11".scan_log ADD COLUMN IF NOT EXISTS progress_pct NUMERIC;
ALTER TABLE "prod-v11".scan_log ADD COLUMN IF NOT EXISTS progress_detail TEXT;
```

### `"prod-v11".bungalows`

```sql
CREATE TABLE IF NOT EXISTS "prod-v11".bungalows (
  id SERIAL PRIMARY KEY,
  token_address TEXT UNIQUE NOT NULL,
  chain TEXT NOT NULL DEFAULT 'base',
  onchain_id INTEGER,
  name TEXT,
  symbol TEXT,
  ipfs_hash TEXT,
  current_owner TEXT,
  verified_admin TEXT,
  is_verified BOOLEAN DEFAULT FALSE,
  is_claimed BOOLEAN DEFAULT FALSE,
  description TEXT,
  origin_story TEXT,
  holder_count INTEGER DEFAULT 0,
  total_supply NUMERIC,
  link_x TEXT,
  link_farcaster TEXT,
  link_telegram TEXT,
  link_website TEXT,
  link_dexscreener TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bungalows_token ON "prod-v11".bungalows (token_address);

ALTER TABLE "prod-v11".bungalows ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE "prod-v11".bungalows ADD COLUMN IF NOT EXISTS price_usd NUMERIC;
ALTER TABLE "prod-v11".bungalows ADD COLUMN IF NOT EXISTS market_cap NUMERIC;
ALTER TABLE "prod-v11".bungalows ADD COLUMN IF NOT EXISTS volume_24h NUMERIC;
ALTER TABLE "prod-v11".bungalows ADD COLUMN IF NOT EXISTS liquidity_usd NUMERIC;
ALTER TABLE "prod-v11".bungalows ADD COLUMN IF NOT EXISTS metadata_updated_at TIMESTAMP;
```

### `"prod-v11".bulletin_posts`

```sql
CREATE TABLE IF NOT EXISTS "prod-v11".bulletin_posts (
  id SERIAL PRIMARY KEY,
  token_address TEXT NOT NULL,
  chain TEXT NOT NULL DEFAULT 'base',
  wallet TEXT NOT NULL,
  content TEXT NOT NULL,
  image_url TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bulletin_token_created
  ON "prod-v11".bulletin_posts (token_address, created_at DESC);
```

### `"prod-v11".scan_allowance`

```sql
CREATE TABLE IF NOT EXISTS "prod-v11".scan_allowance (
  wallet TEXT NOT NULL,
  date DATE NOT NULL,
  scans_used INTEGER DEFAULT 0,
  PRIMARY KEY (wallet, date)
);
```

### `"prod-v11".custom_bungalows`

`custom_bungalows` is defined in two places (migration and v1 route). Runtime can be schema-drifted.

Migration definition:

```sql
CREATE TABLE IF NOT EXISTS "prod-v11".custom_bungalows (
  id SERIAL PRIMARY KEY,
  token_address TEXT NOT NULL,
  chain TEXT NOT NULL DEFAULT 'base',
  html TEXT NOT NULL,
  claimed_by TEXT,
  contact_note TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(token_address, chain)
);
```

`src/routes/v1-bungalow.ts` also ensures/extends with:

```sql
CREATE TABLE IF NOT EXISTS "prod-v11".custom_bungalows (
  token_address TEXT NOT NULL,
  chain TEXT NOT NULL,
  html TEXT NOT NULL,
  title TEXT,
  description TEXT,
  html_url TEXT,
  deployer_address TEXT,
  deployer_tx_hash TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  deployed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (token_address, chain)
);

ALTER TABLE "prod-v11".custom_bungalows ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE "prod-v11".custom_bungalows ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE "prod-v11".custom_bungalows ADD COLUMN IF NOT EXISTS html_url TEXT;
ALTER TABLE "prod-v11".custom_bungalows ADD COLUMN IF NOT EXISTS deployer_address TEXT;
ALTER TABLE "prod-v11".custom_bungalows ADD COLUMN IF NOT EXISTS deployer_tx_hash TEXT;
ALTER TABLE "prod-v11".custom_bungalows ADD COLUMN IF NOT EXISTS deployed_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE "prod-v11".custom_bungalows ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
```

### `"prod-v11".heat_precalculated`

Created by heat scripts:

```sql
CREATE TABLE IF NOT EXISTS "prod-v11".heat_precalculated (
  wallet TEXT NOT NULL,
  token TEXT NOT NULL,
  token_name TEXT NOT NULL,
  heat_degrees NUMERIC NOT NULL,
  island_heat NUMERIC NOT NULL,
  calculated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (wallet, token)
);
```

### `"prod-v11".wallet_farcaster_profiles`

Created by `scripts/resolve-farcaster.ts`:

```sql
CREATE TABLE IF NOT EXISTS "prod-v11".wallet_farcaster_profiles (
  wallet TEXT PRIMARY KEY,
  fid INTEGER NOT NULL,
  username TEXT,
  display_name TEXT,
  pfp_url TEXT,
  follower_count INTEGER DEFAULT 0,
  following_count INTEGER DEFAULT 0,
  neynar_score NUMERIC,
  island_heat NUMERIC,
  token_breakdown JSONB,
  resolved_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### `"prod-v11".fid_island_profiles`

Created by `scripts/build-personas.ts`:

```sql
CREATE TABLE IF NOT EXISTS "prod-v11".fid_island_profiles (
  fid INTEGER PRIMARY KEY,
  username TEXT,
  display_name TEXT,
  pfp_url TEXT,
  follower_count INTEGER DEFAULT 0,
  following_count INTEGER DEFAULT 0,
  neynar_score NUMERIC,
  island_heat NUMERIC NOT NULL,
  token_breakdown JSONB NOT NULL,
  wallets JSONB NOT NULL,
  wallet_count INTEGER NOT NULL,
  tier TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### `"prod-v11".user_wallet_links`

Created by `src/db/queries.ts`, extended by wallet-link route:

```sql
CREATE TABLE IF NOT EXISTS "prod-v11".user_wallet_links (
  wallet TEXT NOT NULL,
  wallet_kind TEXT NOT NULL,
  privy_user_id TEXT,
  fid BIGINT,
  x_username TEXT,
  seen_via_privy BOOLEAN NOT NULL DEFAULT FALSE,
  seen_via_farcaster BOOLEAN NOT NULL DEFAULT FALSE,
  farcaster_verified BOOLEAN NOT NULL DEFAULT FALSE,
  last_seen_requester_wallet BOOLEAN NOT NULL DEFAULT FALSE,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (wallet, wallet_kind),
  CHECK (wallet_kind IN ('evm', 'solana'))
);
CREATE INDEX IF NOT EXISTS idx_user_wallet_links_privy
  ON "prod-v11".user_wallet_links (privy_user_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_wallet_links_fid
  ON "prod-v11".user_wallet_links (fid, last_seen_at DESC);

ALTER TABLE "prod-v11".user_wallet_links ADD COLUMN IF NOT EXISTS x_id TEXT;
CREATE INDEX IF NOT EXISTS idx_user_wallet_links_x_id ON "prod-v11".user_wallet_links (x_id);
```

### `"prod-v11".holder_balance_snapshots`

```sql
CREATE TABLE IF NOT EXISTS "prod-v11".holder_balance_snapshots (
  token_address TEXT NOT NULL,
  wallet TEXT NOT NULL,
  ts INTEGER NOT NULL,
  balance TEXT NOT NULL,
  PRIMARY KEY (token_address, wallet, ts)
);
CREATE INDEX IF NOT EXISTS idx_hbs_token_wallet
  ON "prod-v11".holder_balance_snapshots (token_address, wallet);
```

### `"prod-v11".bungalow_scenes` (dormant unless scene route mounted)

```sql
CREATE TABLE IF NOT EXISTS "prod-v11".bungalow_scenes (
  id BIGSERIAL PRIMARY KEY,
  chain TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  scene_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT,
  UNIQUE(chain, contract_address)
);
```

### `"prod-v11".asset_catalog` (dormant unless scene route mounted)

```sql
CREATE TABLE IF NOT EXISTS "prod-v11".asset_catalog (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  category TEXT NOT NULL,
  price_jbm NUMERIC NOT NULL DEFAULT 0,
  thumbnail_url TEXT NOT NULL,
  model_url TEXT,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `"prod-v11".asset_purchases` (dormant unless scene route mounted)

```sql
CREATE TABLE IF NOT EXISTS "prod-v11".asset_purchases (
  id BIGSERIAL PRIMARY KEY,
  chain TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  wallet TEXT NOT NULL,
  tx_hash TEXT,
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `"prod-v11".bungalow_widget_installs`

```sql
CREATE TABLE IF NOT EXISTS "prod-v11".bungalow_widget_installs (
  id BIGSERIAL PRIMARY KEY,
  chain TEXT NOT NULL,
  token_address TEXT NOT NULL,
  widget_id TEXT NOT NULL,
  package_name TEXT NOT NULL,
  version TEXT NOT NULL,
  repo_url TEXT,
  installed_by TEXT NOT NULL,
  installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(chain, token_address, widget_id)
);
CREATE INDEX IF NOT EXISTS idx_widget_installs_bungalow
  ON "prod-v11".bungalow_widget_installs (chain, token_address, installed_at DESC);
```

### `"prod-v11".agent_keys`

```sql
CREATE TABLE IF NOT EXISTS "prod-v11".agent_keys (
  id BIGSERIAL PRIMARY KEY,
  agent_name TEXT NOT NULL UNIQUE,
  api_key_hash TEXT NOT NULL,
  description TEXT,
  wallet TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);
```

### `"prod-v11".used_tx_hashes`

```sql
CREATE TABLE IF NOT EXISTS "prod-v11".used_tx_hashes (
  tx_hash TEXT PRIMARY KEY,
  used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  mint_address TEXT NOT NULL
);
```

## 2.3 Key TypeScript row types (from `src/db/schema.ts`)

```ts
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

export interface TokenHolderRow {
  wallet: string
  heat_degrees: string
  island_heat: string | null
  fid: number | null
  username: string | null
  pfp_url: string | null
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

export interface BulletinPostRow {
  id: number
  token_address: string
  chain: string
  wallet: string
  content: string
  image_url: string | null
  created_at: string
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
```

## 2.4 Relationships between tables

There are almost no SQL foreign-key constraints; relationships are logical via shared fields.

Primary relationship map:

- `token_registry.token_address` <-> `bungalows.token_address` (1:1-ish, bungalow row may be absent)
- `token_registry.token_address` <-> `token_holder_heat.token_address` (1:many)
- `token_registry.token_address` <-> `scan_log.token_address` (1:many)
- `token_registry.token_address` <-> `holder_balance_snapshots.token_address` (1:many)
- `token_registry.token_address` <-> `custom_bungalows.token_address` (1:0/1 per chain)
- `token_holder_heat.wallet` <-> `wallet_farcaster_profiles.wallet` (many:1)
- `wallet_farcaster_profiles.fid` <-> `fid_island_profiles.fid` (many:1)
- `user_wallet_links.wallet` overlaps with `token_holder_heat.wallet` and `wallet_farcaster_profiles.wallet`
- `bungalow_widget_installs.(chain, token_address)` -> bungalow identity

## 3. API Routes

Base prefix for mounted API modules: `/api`.

Global API behavior:
- rate limit: 100 requests/min (IP key)
- response cache headers: `Cache-Control: no-store`
- JSON API errors use shape:

```json
{
  "error": "message",
  "code": "error_code",
  "status": 400,
  "request_id": "uuid",
  "details": null
}
```

### 3.1 Mounted route groups (active)

#### Health (`src/routes/health.ts`)

```ts
healthRoute.get('/health', ...)
healthRoute.get('/health/deep', ...)
```

- `GET /api/health` (public)
  - Response:
    ```json
    { "status":"ok|degraded", "db":"connected|disconnected", "ts":"ISO" }
    ```
- `GET /api/health/deep` (public)
  - Response includes snapshot counts:
    ```json
    {
      "status":"ok|degraded",
      "db":"connected|disconnected",
      "schema":"prod-v11",
      "data":{
        "personas_count":0,
        "bungalows_count":0,
        "scanned_tokens_count":0,
        "holder_rows_count":0,
        "latest_scan_at":null
      },
      "diagnostics":{"response_time_ms":0,"ts":"ISO"}
    }
    ```

#### Bungalow core (`src/routes/bungalow.ts`)

```ts
bungalowRoute.use("/bungalow/*", optionalWalletContext)
bungalowRoute.get("/bungalow/:chain/:ca", ...)
bungalowRoute.put("/bungalow/:chain/:ca/curate", requireWalletAuth, ...)
bungalowRoute.get("/bungalow/:chain/:ca/bulletin", ...)
bungalowRoute.post("/bungalow/:chain/:ca/bulletin", requireWalletAuth, ...)
```

- `GET /api/bungalow/:chain/:ca` (public + optional wallet context)
  - Params: `chain in {base, ethereum, solana}`, `ca` normalized per chain.
  - Returns fallback object if bungalow row missing.
  - Response shape (real fields):
    ```json
    {
      "token_address":"...",
      "chain":"base",
      "name":"...",
      "symbol":"...",
      "exists":true,
      "is_claimed":false,
      "is_verified":false,
      "current_owner":null,
      "description":null,
      "origin_story":null,
      "image_url":null,
      "holder_count":0,
      "total_supply":null,
      "market_data":{
        "price_usd":null,
        "market_cap":null,
        "volume_24h":null,
        "liquidity_usd":null,
        "updated_at":null
      },
      "links":{
        "x":null,
        "farcaster":null,
        "telegram":null,
        "website":null,
        "dexscreener":null
      },
      "holders":[
        {"rank":1,"wallet":"...","heat_degrees":0,"farcaster":null}
      ],
      "heat_distribution":{
        "elders":0,"builders":0,"residents":0,"observers":0,"drifters":0
      },
      "viewer_context":{
        "wallet":"0x...",
        "is_owner":false,
        "holds_token":false,
        "token_heat_degrees":0,
        "island_heat":0,
        "tier":"drifter"
      }
    }
    ```

- `PUT /api/bungalow/:chain/:ca/curate` (wallet auth required)
  - Auth: `Authorization: Bearer <privy_jwt>` OR `X-API-Key` (agent).
  - Body keys accepted: `description`, `origin_story`, `link_x`, `link_farcaster`, `link_telegram`, `link_website`.
  - Validation: description <= 500 chars, origin_story <= 2000 chars, links must be valid URL.
  - Returns `{ "ok": true }`.

- `GET /api/bungalow/:chain/:ca/bulletin` (public)
  - Query: `limit<=50`, `offset>=0`
  - Response:
    ```json
    {
      "posts":[
        {
          "id":1,
          "wallet":"0x...",
          "content":"...",
          "image_url":null,
          "created_at":"ISO",
          "poster_username":"name",
          "poster_pfp":"https://..."
        }
      ],
      "total":1
    }
    ```

- `POST /api/bungalow/:chain/:ca/bulletin` (wallet auth required)
  - Requires caller token heat >= 10 on this token.
  - Body:
    ```json
    { "content": "max 280 chars", "image_url": "optional valid URL" }
    ```
  - Returns 201:
    ```json
    { "id":1, "wallet":"...", "content":"...", "image_url":null, "created_at":"ISO" }
    ```

#### Token routes (`src/routes/token.ts`)

```ts
tokenRoute.get('/token/:chain/:ca/holders', ...)
tokenRoute.get('/token/:ca/timeline', ...)
tokenRoute.get('/token/:chain/:ca/holder/:wallet/history', ...)
```

- `GET /api/token/:chain/:ca/holders` (public)
  - Query: `limit<=200`, `offset`, `tier in Elder|Builder|Resident|Observer|Drifter`
  - Response:
    ```json
    {
      "token": {
        "address":"...","name":"...","symbol":"...","total_supply":0,"holder_count":0
      },
      "holders": [
        {
          "wallet":"...",
          "heat_degrees":0,
          "farcaster":{"fid":1,"username":"...","pfp_url":"..."},
          "island_heat":0,
          "tier":"Observer"
        }
      ],
      "total": 123
    }
    ```

- `GET /api/token/:ca/timeline` (public)
  - Address auto-normalized as EVM or Solana.
  - Returns:
    ```json
    { "timeline": [{"t":1700000000,"c":42}] }
    ```

- `GET /api/token/:chain/:ca/holder/:wallet/history` (public)
  - Returns wallet balance time series.
  - Response:
    ```json
    {
      "points": [{"t":1700000000,"b":123.45}],
      "decimals": 18
    }
    ```
  - Data source order:
    1. `holder_balance_snapshots` table
    2. EVM fallback: Alchemy transfer history
    3. Solana fallback: Helius holder history

#### Directory/feed/activity (`src/routes/bungalows.ts`)

```ts
bungalowsRoute.get('/bungalows', ...)
bungalowsRoute.get('/feed', ...)
bungalowsRoute.get('/activity', ...)
```

- `GET /api/bungalows` (public)
  - Query: `limit<=200`, `offset`
  - Returns scanned token list with aliases:
    ```json
    {
      "items":[
        {
          "chain":"base",
          "ca":"0x...",
          "token_address":"0x...",
          "token_name":"...",
          "name":"...",
          "token_symbol":"...",
          "symbol":"...",
          "holder_count":0,
          "claimed":false,
          "is_claimed":false,
          "scanned":true,
          "scan_status":"complete"
        }
      ],
      "total": 0
    }
    ```

- `GET /api/feed` (public)
  - Returns global bulletin feed: `{ posts: GlobalFeedPost[], total }`

- `GET /api/activity` (public)
  - Returns merged event stream of bulletin posts + scans:
    `{ events: ActivityEvent[] }`

#### User/profile (`src/routes/user.ts`)

```ts
userRoute.get('/wallet/:wallet', ...)
userRoute.get('/me', requireWalletAuth, ...)
userRoute.post('/me/setup', requireWalletAuth, ...)
```

- `GET /api/wallet/:wallet` (public)
  - Query `aggregate=true` enables linked-wallet aggregation.
  - Single-wallet shape:
    ```json
    {
      "wallet":"0x...",
      "island_heat":0,
      "tier":"Drifter",
      "farcaster": {"fid":null,"username":null,"display_name":null,"pfp_url":null},
      "token_breakdown":[{"token":"...","token_name":"...","token_symbol":"...","chain":"base","heat_degrees":0}],
      "scans":[{"chain":"base","token_address":"0x...","scanned_at":"ISO"}]
    }
    ```
  - Aggregated shape (when linked wallets found): adds `linked_wallets`, `x_username`, `aggregated:true`, and aggregated token rows with `wallet_heats`.

- `GET /api/me` (wallet auth required)
  - Uses auth wallet + optional Privy claims.
  - Returns:
    ```json
    {
      "wallet":"...",
      "island_heat":0,
      "tier":"drifter",
      "farcaster": {...}|null,
      "token_breakdown":[],
      "scans":[],
      "connected_wallets":["..."],
      "wallet_map":[...],
      "wallet_map_summary":{...},
      "x_username":"...",
      "farcaster_found":true|false
    }
    ```

- `POST /api/me/setup` (wallet auth required)
  - Idempotent identity resolution + persistence.
  - Same response shape as `/api/me`.

#### Claim price + eligibility (`src/routes/claim-price.ts`)

```ts
claimPriceRoute.get('/claim-price/:chain/:ca', ...)
claimPriceRoute.get('/claim-eligibility/:chain/:ca', requireWalletAuth, ...)
```

- `GET /api/claim-price/:chain/:ca` (public)
  - Claim price formula in handler:
    ```ts
    const marketCap = dexData.marketCap ?? 0
    const rawPrice = marketCap * 0.001
    const priceUsdc = Math.min(Math.max(rawPrice, 1), 1000)
    ```
  - Response:
    ```json
    {
      "price_usdc": 1.23,
      "market_cap": 1234,
      "token_name":"...",
      "token_symbol":"...",
      "image_url":"...",
      "price_usd":0.0,
      "liquidity_usd":0.0,
      "volume_24h":0.0,
      "minimum_heat":10
    }
    ```

- `GET /api/claim-eligibility/:chain/:ca` (wallet auth required)
  - Builds wallet map from Privy + Neynar.
  - Triggers scan if token not scanned yet (Base/Ethereum only).
  - Returns either:
    - `202` scanning response with `scan_pending:true`, `scan_id`, `scan_progress`
    - or final eligibility response with `eligible`, `heat`, `holdings[]`

#### Claim finalize (`src/routes/claim.ts`)

```ts
claimRoute.post('/bungalow/claim', requireWalletAuth, ...)
```

- `POST /api/bungalow/claim` (wallet auth required)
  - Body:
    ```json
    { "chain":"base", "ca":"0x...", "tx_hash":"0x..." }
    ```
  - Flow:
    1. validate wallet has enough token heat (>=10) across linked EVM wallets
    2. compute dynamic claim price from DexScreener market cap
    3. verify on-chain USDC transfer in provided tx receipt
    4. upsert claimed bungalow + async DexScreener metadata write
    5. optional Bayla signature (`BAYLA_PRIVATE_KEY`)
  - Response:
    ```json
    {
      "bungalow":{"chain":"base","ca":"0x...","claimed_by":"0x..."},
      "bayla": {"signature":"0x...","deadline":"...","mode":"live"} | null
    }
    ```

#### Scan (`src/routes/scan.ts`)

```ts
scanRoute.post('/scan/:chain/:ca', optionalWalletContext, scanBurstLimit, ...)
scanRoute.get('/scan/:scanId/status', ...)
```

- `POST /api/scan/:chain/:ca` (optional auth + payment headers)
  - Extra middleware: per-wallet burst limiter `20/min`.
  - Headers used:
    - `Authorization` (optional Privy)
    - `X-Wallet-Address` (required if no auth)
    - `X-Payment-Proof` (required for non-residents)
  - Free path: residents (`islandHeat >= 80`) get `CONFIG.RESIDENT_DAILY_SCANS` free/day.
  - Paid path: verifies USDC tx/signature via `verifyPayment`.
  - Async starts scanner and returns:
    ```json
    { "status":"scanning", "scan_id":123, "estimated_seconds":120, "claimed":true|false }
    ```

- `GET /api/scan/:scanId/status` (public)
  - Response:
    ```json
    {
      "id":123,
      "scan_id":123,
      "token_address":"...",
      "chain":"base",
      "status":"running|complete|failed",
      "progress_phase":"metadata|transfers|balances|heat|saving|complete|failed",
      "progress_pct":42,
      "progress_detail":"...",
      "events_fetched":0,
      "holders_found":0,
      "rpc_calls_made":0,
      "started_at":"ISO",
      "completed_at":"ISO|null",
      "error_message":null,
      "logs":["..."]
    }
    ```

#### Leaderboard/persona (`src/routes/leaderboard.ts`, `src/routes/persona.ts`)

- `GET /api/leaderboard` (public)
  - Query: `tier`, `token`, `limit<=200`, `offset`
  - Response:
    ```json
    {
      "personas":[{"fid":1,"username":"...","pfp_url":"...","island_heat":0,"tier":"Drifter","wallet_count":1,"top_tokens":[...]}],
      "total":0,
      "tiers":{"elders":0,"builders":0,"residents":0,"observers":0,"drifters":0}
    }
    ```

- `GET /api/persona/:fid` (public)
  - Response:
    ```json
    {
      "fid":1,
      "username":"...",
      "display_name":"...",
      "pfp_url":"...",
      "follower_count":0,
      "island_heat":0,
      "tier":"Drifter",
      "wallet_count":1,
      "wallets":["0x..."],
      "token_breakdown":[{"token":"...","token_name":"...","heat_degrees":0}],
      "scans":[{"token_address":"...","name":"...","scanned_at":"ISO"}]
    }
    ```

#### OG utilities (`src/routes/og.ts`)

- `GET /api/og?url=https://...` (public)
  - Fetches remote HTML, extracts `og:*`/twitter meta.
- `GET /api/og-page/:chain/:ca` (public)
  - Returns HTML page with OG tags + redirect.
- `GET /api/og-image/:chain/:ca` (public)
  - Returns dynamic SVG OG image (`image/svg+xml`).

#### Agents (`src/routes/agent.ts`)

```ts
agentRoute.post('/agents/register', ...)
agentRoute.get('/agents/me', requireAgentAuth, ...)
agentRoute.patch('/agents/me', requireAgentAuth, ...)
```

- `POST /api/agents/register` (public)
  - Body:
    ```json
    { "agent_name":"name", "description":"optional", "wallet":"optional" }
    ```
  - Returns 201 with newly generated API key (only shown once):
    ```json
    {
      "agent_name":"...",
      "api_key":"jbi_...",
      "description":"...",
      "wallet":"0x...",
      "created_at":"ISO",
      "message":"Store this API key securely ..."
    }
    ```

- `GET /api/agents/me` (`X-API-Key` required)
  - Returns agent profile.

- `PATCH /api/agents/me` (`X-API-Key` required)
  - Body supports `{ description, wallet }`, returns `{ "ok": true }`.

#### Widgets (`src/routes/widget.ts`)

- `GET /api/bungalow/:chain/:ca/widgets/catalog` (public)
  - Returns hardcoded catalog with `install_command`.
- `GET /api/bungalow/:chain/:ca/widgets` (public)
  - Returns installed widget rows from DB.
- `POST /api/bungalow/:chain/:ca/widgets/install` (wallet auth required)
  - Owner/admin only.
  - Body: `{ "widget_id": "...", "repo_url": "optional" }`
  - Returns 201 with install row + widget metadata.

#### V1 bungalow endpoints (`src/routes/v1-bungalow.ts`)

- `GET /api/treasury` (public)
  - Returns configured payment destinations + bungalow cost.
- `POST /api/v1/bungalow` (public but payment-signature required)
  - Headers: `payment-signature` / `Payment-Signature`
  - Body:
    - claim only: `{ "mint_address": "..." }`
    - custom html deploy: `{ "mint_address":"...", "html_url":"...", "title":"...", "description":"..." }`
  - Verifies payment and may fetch/store external HTML.
  - Returns 201:
    ```json
    {
      "ok": true,
      "mint_address": "...",
      "url": "https://memetics.lat/{chain}/{mint}",
      "has_custom_html": true,
      "deployed_at": "ISO"
    }
    ```

- `GET /api/v1/bungalow/:mint_address` (public)
  - Returns custom bungalow metadata if active.

### 3.2 Direct API endpoints in `src/index.ts`

- `POST /api/solana-rpc` (public)
  - Allowed methods only:
    - `getLatestBlockhash`
    - `getTokenAccountBalance`
    - `getAccountInfo`
  - Proxies to Helius RPC if `HELIUS_API_KEY`, else public Solana RPC.

- `POST /api/webhook` (public)
  - Stub: `{ "ok": true }`

- `GET /api/skill` and `GET /skill`, `GET /skill.md`
  - serves local `skill.md`.

### 3.3 Non-API web routes in `src/index.ts`

- `GET /.well-known/farcaster.json` (manifest)
- `GET /` (landing HTML)
- `GET /info` (info/login HTML)
- `GET /wallet/:wallet` (user profile HTML)
- `GET /user/:wallet` -> redirects to `/wallet/:wallet`
- `GET /:chain/:ca` (two handlers)
  - bot requests: OG HTML
  - normal requests: rendered bungalow page HTML

### 3.4 Dormant route modules (defined but not mounted)

These are in code but currently unreachable because `src/index.ts` does not `app.route('/api', ...)` them.

- `src/routes/auth.ts`
  - `GET /auth/twitter`
  - `GET /auth/callback`
  - `GET /auth/logout`
  - `GET /auth/me`
- `src/routes/wallet-link.ts`
  - `GET /wallets/nonce`
  - `POST /wallets/link`
  - `GET /wallets`
  - `DELETE /wallets/:wallet`
- `src/routes/scene.ts`
  - `GET /bungalow/:chain/:ca/scene`
  - `PUT /bungalow/:chain/:ca/scene`
  - `GET /assets/catalog`
  - `POST /assets/purchase`

## 4. Authentication Flow

## 4.1 Wallet/API auth actually used by mounted APIs

From `src/middleware/auth.ts`.

### Privy bearer JWT flow

```ts
const token = extractBearerToken(c.req.header('Authorization'))
const { payload } = await jwtVerify(token, verificationKey, {
  algorithms: ['ES256'],
  audience: CONFIG.PRIVY_APP_ID,
  issuer: 'privy.io',
})
```

Wallet is extracted from either direct claims (`wallet_address`/`address`) or `linked_accounts` payload.

### Agent API key flow

```ts
const apiKey = c.req.header('X-API-Key')
const keyHash = await hashApiKey(apiKey)
const agent = await getAgentByKeyHash(keyHash)
```

If valid, middleware sets:
- `agentName`, `agentId`
- `walletAddress` (if agent has wallet)

### Middleware variants

- `optionalWalletContext`
  - tries agent key first, then optional Privy token
  - never throws on bad/missing bearer
- `requireWalletAuth`
  - agent key OR valid Privy bearer required
- `requireAgentAuth`
  - strict `X-API-Key` required

## 4.2 Identity linking (wallet -> person)

The active identity map path for `/api/me`, `/api/me/setup`, claim eligibility, and claim:

1. Start from authenticated requester wallet.
2. Parse Privy `linked_accounts` for additional wallets.
3. Extract X username from Privy claims (`twitter_oauth` account).
4. Lookup Farcaster by X username via Neynar.
5. Merge all wallets and persist into `user_wallet_links`.
6. Upsert Farcaster profile rows into `wallet_farcaster_profiles`.

Core function: `resolveUserWalletMap()` (`src/services/identityMap.ts`).

## 4.3 Session/cookie auth (currently dormant)

`src/services/session.ts` defines cookie session JWT (`HS256`) used by dormant auth routes:

- cookie name: `meme_session`
- TTL: 30 days
- `HttpOnly; SameSite=Lax; Secure` only in production

## 5. Bungalow System (frontend-critical)

## 5.1 Where bungalow data is stored

Primary tables:
- `bungalows` (token-level bungalow metadata + claim/owner + social links + market fields)
- `token_registry` (scan/index status + holder_count + home-team flag)
- `custom_bungalows` (optional stored custom HTML)
- `bulletin_posts` (social wall)
- `bungalow_widget_installs` (widget config)

Canonical bungalow query used by API:

```ts
SELECT token_address, chain, name, symbol, ipfs_hash, current_owner, verified_admin,
       is_verified, is_claimed, description, origin_story, holder_count, total_supply,
       link_x, link_farcaster, link_telegram, link_website, link_dexscreener,
       image_url, price_usd::text AS price_usd, market_cap::text AS market_cap,
       volume_24h::text AS volume_24h, liquidity_usd::text AS liquidity_usd,
       metadata_updated_at::text AS metadata_updated_at
FROM "prod-v11".bungalows
WHERE token_address = $1 AND chain = $2
```

## 5.2 Bungalow data fields available to frontend

From `/api/bungalow/:chain/:ca` response + DB fields:

- identity: `token_address`, `chain`, `name`, `symbol`
- claim state: `is_claimed`, `is_verified`, `current_owner`
- content: `description`, `origin_story`
- market: `price_usd`, `market_cap`, `volume_24h`, `liquidity_usd`, `metadata_updated_at`
- links: `link_x`, `link_farcaster`, `link_telegram`, `link_website`, `link_dexscreener`
- media: `image_url`
- distribution: `holders[]`, `heat_distribution`
- optional viewer context: `viewer_context` (if auth/agent provided)

## 5.3 Home Team bungalow definition

Home-team is DB-flagged in `token_registry.is_home_team` and seeded in `scripts/migrate-v11.ts`:

```ts
const homeTeam = [
  { token_address: "0x22af...f3b", chain: "base", name: "BNKR", ... },
  { token_address: "0x58d6...b238", chain: "base", name: "RIZZ", ... },
  { token_address: "0x279e...87ca", chain: "base", name: "TOWELI", ... },
  { token_address: "0x2b50...cadf", chain: "base", name: "QR", ... },
  { token_address: "0x3313...ba8d", chain: "base", name: "JBM", ... },
  { token_address: "0x3ec2...8ea2", chain: "base", name: "DRB", ... },
  { token_address: "0x3d01...6d6f", chain: "base", name: "ALPHA", ... },
  { token_address: "0xd372...dda9", chain: "ethereum", name: "JBC", ... }
]
```

There is currently no dedicated `/api/home-team` endpoint and `/api/bungalows` does not expose `is_home_team`.

## 5.4 Bungalow endpoints you should integrate

Primary:
- `GET /api/bungalow/:chain/:ca` (single bungalow full payload)
- `GET /api/bungalows` (directory/list)
- `GET /api/bungalow/:chain/:ca/bulletin`
- `POST /api/bungalow/:chain/:ca/bulletin`
- `PUT /api/bungalow/:chain/:ca/curate`

Legacy/v1 custom-html flow:
- `GET /api/v1/bungalow/:mint_address`
- `POST /api/v1/bungalow`

## 5.5 Token image source of truth

Image resolution order (`resolveTokenMetadata`):
1. `bungalows.image_url`
2. DexScreener (`fetchDexScreenerData`) `info.imageUrl`
3. Solana on-chain metadata URI (for Solana fallback)

DB enrichment write path:

```ts
UPDATE bungalows
SET image_url = COALESCE(image_url, $imageUrl),
    price_usd = $priceUsd,
    market_cap = $marketCap,
    volume_24h = $volume24h,
    liquidity_usd = $liquidityUsd,
    ...
```

So frontend should treat `image_url` in API as canonical, with Dex metadata already merged in many cases.

## 6. Heat Score System

## 6.1 Heat formula implementation

From `src/services/heat.ts`:

```ts
const K = 60
const rawHeat = twab / totalSupply
heat = 100 * (1 - Math.exp(-K * rawHeat))
```

TWAB is computed from balance snapshots over time:

```ts
weightedSum += balance * duration
twab = weightedSum / totalDuration
```

Tier thresholds (`getTierFromHeat`):
- Elder: `>= 250`
- Builder: `>= 150`
- Resident: `>= 80`
- Observer: `>= 30`
- Drifter: `< 30`

## 6.2 Where heat data is stored

- per token per wallet: `token_holder_heat.heat_degrees`
- precomputed wallet-token + island heat: `heat_precalculated`
- per fid/persona: `fid_island_profiles.island_heat`
- scan transfer timeline: `token_registry.transfer_timeline`

## 6.3 Heat-related endpoints

- `GET /api/bungalow/:chain/:ca`
  - includes `holders[].heat_degrees`
  - includes `heat_distribution`
- `GET /api/token/:chain/:ca/holders`
  - holder heat list with optional tier filter
- `GET /api/claim-eligibility/:chain/:ca`
  - aggregated heat across linked wallets for claim gating
- `GET /api/wallet/:wallet` and `/api/wallet/:wallet?aggregate=true`
  - user island heat and token breakdown
- `GET /api/leaderboard`, `/api/persona/:fid`
  - island heat ranking data

## 6.4 Can frontend get aggregated heat per bungalow?

Available now:
- tier distribution per bungalow: yes (`/api/bungalow/:chain/:ca` -> `heat_distribution`)
- full holder heat rows: yes (`/api/token/:chain/:ca/holders`)

Not explicitly provided as single values:
- average heat
- median heat
- percentile buckets beyond the 5 tiers

Those aggregates can be computed client-side from `/api/token/:chain/:ca/holders` (or added server-side).

## 7. Static Assets and Serving

## 7.1 Static serving behavior

From `src/index.ts` static middleware:

```ts
const STATIC_DIR = path.resolve(import.meta.dir, "../public")
const MIME_TYPES = {
  ".png":"image/png",
  ".jpg":"image/jpeg",
  ".jpeg":"image/jpeg",
  ".webp":"image/webp",
  ".svg":"image/svg+xml",
  ".ico":"image/x-icon"
}
```

Important constraints:
- only requests with those extensions are handled
- only top-level filenames in `public/` are served (`reqPath.split('/').pop()`)
- no nested static folders
- no `.js`, `.css`, `.map` currently served by this middleware

## 7.2 Existing HTML rendering style

No template engine (e.g. EJS/Handlebars). HTML is built as raw strings in TS template functions:

- landing: `renderLanding()`
- bungalow page: `renderBungalow()`
- user profile: `renderUserPage()`
- info/404 pages: `renderLoginPage()`, `render404()`

These are returned by handlers via `c.html(...)`.

## 7.3 Where a React bundle would go

Current state:
- You can place files in `public/`, but JS/CSS bundles will not be served unless server middleware is extended.

To support a built React app, backend must be updated to:
1. add MIME mappings for `.js`, `.css`, `.map`, `.woff2`, etc.
2. allow nested paths under `public/` (or add `hono` static middleware)
3. optionally add SPA fallback route to `index.html`

Without that server change, only inline scripts and image assets work.

## 8. Environment, External Dependencies, Deployment

## 8.1 Required env vars at app boot

From `src/config.ts` (`required(...)`):

- `DATABASE_URL`
- `PONDER_RPC_URL_8453`
- `PONDER_RPC_URL_1`
- `PRIVY_APP_ID`
- `PRIVY_APP_SECRET`
- `PRIVY_VERIFICATION_KEY`

## 8.2 Optional env vars used by features

- `PORT` (default 3001)
- `CORS_ORIGIN` (default `*`)
- `NEYNAR_API_KEY` (identity enrichment)
- `HELIUS_API_KEY` (Solana scans, Solana RPC proxy)
- `SESSION_SECRET` (dormant cookie auth)
- `X_CLIENT_SECRET_ID`, `X_CLIENT_SECRET` (dormant Twitter OAuth routes)
- `BAYLA_PRIVATE_KEY` (optional claim signature)
- `NODE_ENV` (cookie secure flag for dormant session flow)
- `SERVER_URL` (used in landing template links)

## 8.3 External API and infra dependencies

- DexScreener REST API
  - `https://api.dexscreener.com/tokens/v1/{chain}/{token}`
- EVM scan RPC calls through Alchemy-compatible JSON-RPC methods
  - `alchemy_getAssetTransfers`
- Helius
  - Solana RPC proxy and `getTokenAccounts`
  - Enhanced transactions endpoint: `https://api.helius.xyz/v0/addresses/{ata}/transactions`
- Neynar API
  - Farcaster by username/search/bulk-by-address
- Privy JWT issuer verification (`issuer=privy.io`)
- Twitter OAuth endpoints (dormant)
- Farcaster miniapp SDK loaded from esm.sh in HTML templates

## 8.4 Deployment setup detected from repo

No checked-in deployment config (`railway.json`, `vercel.json`, Dockerfile, Procfile not present).

However:
- `.env.local` uses Railway-hosted Postgres URL pattern
- CORS includes a Railway app domain

So deployment is likely environment-driven (Railway or similar), not infra-as-code in this repo.

## 9. Quick Frontend Integration Checklist

For a React landing page that integrates with this backend today:

1. Use `GET /api/bungalows` for token directory list.
2. Use `GET /api/bungalow/:chain/:ca` for detail pages (holders + heat distribution + market + links).
3. Use `GET /api/token/:chain/:ca/holders` for paginated holder table.
4. Use `POST /api/scan/:chain/:ca` and poll `GET /api/scan/:scanId/status`.
5. Use `GET /api/claim-price/:chain/:ca` and `GET /api/claim-eligibility/:chain/:ca` before claim UX.
6. For authenticated flows send `Authorization: Bearer <privy_jwt>`.
7. If you need static React bundle serving from this backend, update static middleware first (currently image-only).
