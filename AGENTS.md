# AGENT.md — Jungle Bay Island

This is the single source of truth for any AI agent or developer working on this codebase.
Read this entire file before touching anything.

---

## 1. What This App Is

**Jungle Bay Island** (also called **Memetics**) is a community platform for token holders and their communities on Base, Ethereum, and Solana.

The core concept: every token gets a **Bungalow** — a project page that its holders can claim, customize, and post on. The longer and more consistently you hold a token, the more **Heat** you accumulate, which determines your social standing on the island and gates what you can do.

Key nouns you will encounter everywhere:

| Term               | Meaning                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| **Bungalow**       | The project page for a token. One bungalow per token address.                                                    |
| **Heat**           | A time-weighted score based on how long you've held a token. The core social currency.                           |
| **Tier**           | Your rank from heat: Elder (≥250) → Builder (≥150) → Resident (≥80) → Observer (≥30) → Drifter (<30)             |
| **Island Heat**    | Your aggregate heat across all tokens you hold. Your global standing.                                            |
| **Bodega**         | The marketplace where creators submit items (decorations, miniapps, links) that can be installed into bungalows. |
| **Bulletin Board** | The social wall inside each bungalow. Requires ≥10 heat on that token to post.                                   |
| **Scan**           | The process of indexing all transfer events for a token to calculate heat scores.                                |
| **Home Team**      | A curated set of 8 founding tokens (BNKR, RIZZ, TOWELI, QR, JBM, DRB, ALPHA, JBC) seeded in `token_registry`.    |
| **JBM**            | Jungle Bay Memes — the native token used for bodega submissions (69,000 JBM fee) and item placements.            |
| **Claim**          | The process of bringing a bungalow into existence.                                                               |

---

## 2. Repository Layout

```
FINAL/
├── AGENT.md               ← you are here
├── backend/               ← Hono + Bun API server
│   ├── src/
│   │   ├── index.ts       ← entry point, all routes mounted here
│   │   ├── config.ts      ← all env vars and their defaults
│   │   ├── db/
│   │   │   ├── schema.ts  ← TypeScript row types for every table
│   │   │   └── queries.ts ← reusable SQL query functions
│   │   ├── routes/        ← one file per route group
│   │   ├── services/      ← business logic (heat, scanner, identity, payment...)
│   │   ├── middleware/    ← auth, rate limit, logging
│   │   └── templates/     ← server-rendered HTML (landing, bungalow page, etc.)
│   ├── scripts/           ← one-off migration and backfill scripts, run manually
│   ├── public/            ← static assets + built frontend
│   │   └── island/        ← Vite build output (DO NOT EDIT DIRECTLY)
│   └── .env.local         ← secrets (never commit)
├── island/                ← Vite + React frontend
│   ├── src/
│   │   ├── App.tsx        ← router root
│   │   ├── pages/         ← one component per route
│   │   ├── components/    ← shared UI components
│   │   ├── hooks/         ← React hooks (data fetching, wallet, etc.)
│   │   ├── utils/         ← helpers, constants, ABIs
│   │   └── styles/        ← CSS modules, one per component
│   ├── vite.config.ts
│   └── .env               ← frontend env vars (VITE_ prefix only)
└── scripts/
    ├── build.sh           ← builds frontend + copies to backend/public/island
    ├── start.sh           ← starts the backend process
    └── backup-db.sh       ← pg_dump to Railway backup DB
```

---

## 3. Tech Stack

| Layer             | Technology                                                  |
| ----------------- | ----------------------------------------------------------- |
| Runtime           | Bun                                                         |
| Backend framework | Hono v4                                                     |
| Database          | PostgreSQL — direct SQL via `postgres` npm package (no ORM) |
| DB schema         | `"prod-v11"` (hardcoded in `backend/src/config.ts`)         |
| Frontend          | React + Vite, TypeScript                                    |
| Styling           | CSS Modules                                                 |
| Auth              | Privy (JWT + linked accounts) + Agent API keys (X-API-Key)  |
| Web3              | Viem, Wagmi, Privy embedded wallets                         |
| Identity          | Neynar (Farcaster), Privy (wallets + X/Twitter)             |
| Chains            | Base (primary), Ethereum, Solana                            |
| RPC               | Alchemy (EVM), Helius (Solana)                              |
| Market data       | DexScreener REST API                                        |
| Process manager   | PM2                                                         |
| Tunnel            | Cloudflare tunnel → localhost:3000                          |

---

## 4. The Change Loop (How to Ship)

Production and development are the same environment. Every change goes live immediately. There is no staging. **But resilience is non-negotiable** — users mid-transaction must never be dropped.

### The three deploy paths

| What you changed              | Command                                    | Downtime                                            |
| ----------------------------- | ------------------------------------------ | --------------------------------------------------- |
| `island/src/` (frontend only) | `./scripts/build.sh`                       | **Zero** — files are swapped, backend keeps running |
| `backend/src/` (backend code) | `./scripts/deploy-backend.sh`              | **Zero** — graceful drain, then reload              |
| Both                          | `build.sh` first, then `deploy-backend.sh` | Zero                                                |
| `.env.local` (env var change) | `pm2 restart ecosystem.config.js`          | ~2s — hard restart is unavoidable here              |

**Never use `pm2 restart jbi` for routine deploys.** Use `deploy-backend.sh`. The difference:

- `pm2 restart` = hard kill, in-flight requests dropped immediately
- `pm2 reload` (what `deploy-backend.sh` uses) = starts new process → waits for ready signal → then gracefully shuts down the old one

### How graceful shutdown works

The backend's `src/index.ts` has a SIGTERM handler that:

1. Sets a `isShuttingDown` flag — new requests immediately get a `503 Retry-After: 5`
2. Waits for all active requests to finish (tracked with a counter)
3. Only calls `process.exit(0)` when the counter hits zero
4. PM2's `kill_timeout: 15000` is the hard backstop — if a request hangs for 15s, it gets killed anyway

The claim flow specifically: if a user sends USDC on-chain and submits the tx_hash mid-restart, the worst case is they get a 503. They retry. The endpoint checks `used_tx_hashes` to prevent double-processing, so retry is safe.

### Backend change

```bash
# Edit any file in backend/src/
# Then:
./scripts/deploy-backend.sh
# Checks health → graceful reload → verifies health again
# Takes ~5 seconds total
```

### Frontend change

```bash
# Edit any file in island/src/
# Then:
./scripts/build.sh
# Builds Vite → swaps static files → done
# Backend never touches. Hard-refresh the browser.
# Takes ~10 seconds total
```

### Database change

```bash
# ALWAYS back up first:
./scripts/backup-db.sh

# Then run your migration:
cd backend && bun run scripts/migrate-vXX.ts

# No backend restart needed for schema changes — the next query picks up the new schema automatically
```

**Rule on schema changes:** Use `ADD COLUMN IF NOT EXISTS` always. Never `DROP` anything without explicit owner confirmation and a backup in hand.

---

## 5. Environment Variables

All backend env vars live in `backend/.env.local`. Never commit this file.

### Required (app will not start without these)

| Variable                 | What it's for                         |
| ------------------------ | ------------------------------------- |
| `DATABASE_URL`           | PostgreSQL connection string          |
| `PONDER_RPC_URL_8453`    | Alchemy RPC for Base (chain ID 8453)  |
| `PONDER_RPC_URL_1`       | Alchemy RPC for Ethereum mainnet      |
| `PRIVY_APP_ID`           | Privy application ID                  |
| `PRIVY_APP_SECRET`       | Privy secret for server-side calls    |
| `PRIVY_VERIFICATION_KEY` | Privy public key for JWT verification |

### Important optional (features break without them)

| Variable                   | What breaks without it                                     |
| -------------------------- | ---------------------------------------------------------- |
| `NEYNAR_API_KEY`           | Farcaster identity enrichment (usernames, avatars, scores) |
| `HELIUS_API_KEY`           | Solana token scanning and RPC proxy                        |
| `TREASURY_WALLET_ADDRESS`  | Claim payment destination                                  |
| `JBM_CLAIM_ESCROW_ADDRESS` | On-chain escrow contract for bodega payments               |
| `BAYLA_PRIVATE_KEY`        | Optional signature on successful claims                    |
| `PORT`                     | Default is 3001; set to 3000 in .env.local                 |
| `SERVER_URL`               | Base URL used in OG tags and links                         |
| `CORS_ORIGIN`              | Default is `*`; set to your domain in production           |

### Frontend env vars (`island/.env`)

All must be prefixed `VITE_` to be accessible in the browser.

| Variable            | Purpose                                       |
| ------------------- | --------------------------------------------- |
| `VITE_API_URL`      | Backend URL (e.g. `https://memetics.lat`)     |
| `VITE_PRIVY_APP_ID` | Same Privy app ID as backend                  |
| (others)            | Check `island/.env.example` for the full list |

---

## 6. Database

### Connection

```ts
// backend/src/config.ts
SCHEMA: "prod-v11";

// backend/src/db/queries.ts — every query uses this pattern:
await db`SELECT * FROM "prod-v11".bungalows WHERE ...`;
```

The schema name is hardcoded. If you ever need to rename it, change `SCHEMA` in `config.ts` and update every query that references it — there are many.

### Core Tables and What They're For

| Table                       | Purpose                                                                      |
| --------------------------- | ---------------------------------------------------------------------------- |
| `token_registry`            | Master record for every token. Scan status, holder count, home team flag.    |
| `bungalows`                 | Project page metadata: owner, description, links, market data, claim status. |
| `token_holder_heat`         | Per-wallet heat score for each token. The heart of the system.               |
| `heat_precalculated`        | Precomputed island heat per wallet+token combo. Updated by scripts.          |
| `fid_island_profiles`       | Farcaster user profiles enriched with island heat and token breakdown.       |
| `wallet_farcaster_profiles` | Wallet → Farcaster identity map.                                             |
| `user_wallet_links`         | Cross-wallet identity (Privy linked accounts).                               |
| `bulletin_posts`            | Social wall posts per bungalow. Requires heat ≥10.                           |
| `scan_log`                  | Audit trail for every scan operation. Progress tracking.                     |
| `holder_balance_snapshots`  | Raw balance time series used to compute heat.                                |
| `bodega_catalog`            | Items creators have submitted to the marketplace.                            |
| `bodega_installs`           | Which bungalows have installed which bodega items.                           |
| `bungalow_widget_installs`  | Installed widgets per bungalow.                                              |
| `agent_keys`                | API keys for registered agents (hashed).                                     |
| `custom_bungalows`          | Custom HTML for v1 bungalow pages (legacy flow).                             |

### Important: No Foreign Keys

There are almost no SQL-level foreign key constraints. Relationships are logical via shared fields:

- `token_registry.token_address` ↔ `bungalows.token_address`
- `token_holder_heat.wallet` ↔ `wallet_farcaster_profiles.wallet`
- `wallet_farcaster_profiles.fid` ↔ `fid_island_profiles.fid`

Be careful when writing queries that join across tables — the data can exist in one table and not the other.

### Heat Formula

```ts
// From backend/src/services/heat.ts
const K = 60;
const rawHeat = twab / totalSupply; // Time-Weighted Average Balance
heat = 100 * (1 - Math.exp(-K * rawHeat));
```

TWAB is computed from `holder_balance_snapshots`. Heat is nonlinear — it asymptotes toward 100 per token but can exceed it when aggregated across many tokens (island heat).

---

## 7. API Reference (Quick)

Base path: `/api`. All routes return JSON errors in the shape:

```json
{
  "error": "message",
  "code": "error_code",
  "status": 400,
  "request_id": "uuid"
}
```

### Most-used endpoints

| Method | Path                                | Auth     | Purpose                                           |
| ------ | ----------------------------------- | -------- | ------------------------------------------------- |
| GET    | `/api/health`                       | none     | Is the server alive?                              |
| GET    | `/api/bungalows`                    | none     | Directory of all indexed tokens                   |
| GET    | `/api/bungalow/:chain/:ca`          | optional | Full bungalow data (holders, heat, market, links) |
| PUT    | `/api/bungalow/:chain/:ca/curate`   | wallet   | Update description, origin story, links           |
| GET    | `/api/bungalow/:chain/:ca/bulletin` | none     | Bulletin board posts                              |
| POST   | `/api/bungalow/:chain/:ca/bulletin` | wallet   | Post to bulletin (requires heat ≥10)              |
| GET    | `/api/token/:chain/:ca/holders`     | none     | Paginated holder list with heat                   |
| POST   | `/api/scan/:chain/:ca`              | optional | Trigger a token scan                              |
| GET    | `/api/scan/:scanId/status`          | none     | Poll scan progress                                |
| GET    | `/api/claim-price/:chain/:ca`       | none     | Get claim cost in USDC                            |
| GET    | `/api/claim-eligibility/:chain/:ca` | wallet   | Check if caller can claim                         |
| POST   | `/api/bungalow/claim`               | wallet   | Finalize a claim with tx proof                    |
| GET    | `/api/wallet/:wallet`               | none     | Wallet heat + token breakdown                     |
| GET    | `/api/me`                           | wallet   | Authenticated user profile                        |
| GET    | `/api/leaderboard`                  | none     | Top holders by island heat                        |
| POST   | `/api/agents/register`              | none     | Register an agent, get API key                    |

### Auth patterns

```
# Privy wallet auth
Authorization: Bearer <privy_jwt>

# Agent auth
X-API-Key: jbi_<key>

# Many endpoints also accept X-Wallet-Address header for unauthenticated context
```

### Chain values

Always use: `base`, `ethereum`, or `solana` (lowercase).

---

## 8. Authentication System

Privy handles wallet auth. The flow:

1. User connects wallet or logs in via Privy on the frontend
2. Frontend gets a JWT from Privy
3. Frontend sends `Authorization: Bearer <jwt>` on API calls
4. Backend verifies the JWT against Privy's public key (`PRIVY_VERIFICATION_KEY`)
5. Wallet address is extracted from JWT claims or `linked_accounts`

Agents (automated callers) use `X-API-Key`. Register via `POST /api/agents/register`.

Three middleware variants:

- `optionalWalletContext` — tries auth, never fails, sets wallet if found
- `requireWalletAuth` — fails 401 if no valid auth
- `requireAgentAuth` — requires `X-API-Key` specifically

---

## 9. Frontend Architecture

The React app is served as a static build from the Hono backend (`backend/public/island/`).

- **Router**: React Router, SPA mode. The backend has a catch-all that serves `index.html`.
- **State**: No global state manager. Custom hooks per data concern.
- **Styling**: CSS Modules. Each component has its own `.module.css` file.
- **Web3**: Privy for wallet connection and embedded wallets. Viem for contract reads/writes.

Key pages:

- `IslandPage.tsx` — the 3D island map (React Three Fiber / canvas)
- `BungalowPage.tsx` — the main project page for a token
- `BodegaPage.tsx` — the item marketplace
- `ProfilePage.tsx` — user heat and token holdings
- `LeaderboardPage.tsx` equivalent — via the leaderboard route
- `ChangelogPage.tsx` — **always update this when shipping a major change**
- `AboutPage.tsx` — **always update this when the product model changes**

---

## 10. Dormant Code (Do Not Enable Without Understanding)

These exist in the codebase but are not mounted or active:

| File                        | What it is                   | Risk if enabled                                                  |
| --------------------------- | ---------------------------- | ---------------------------------------------------------------- |
| `src/routes/auth.ts`        | Twitter/X OAuth login        | Needs `X_CLIENT_SECRET_ID` + `X_CLIENT_SECRET`, session infra    |
| `src/routes/wallet-link.ts` | SIWE wallet linking flow     | Needs `user_wallet_links` schema + nonce management              |
| `src/routes/scene.ts`       | 3D bungalow scene editor     | Needs `bungalow_scenes` + `asset_catalog` tables to be populated |
| `src/services/session.ts`   | Cookie-based session (HS256) | Only used by dormant auth routes                                 |

Do not mount these routes unless you fully understand what they do and have set up the dependencies.

---

## 11. Scripts (Manual Operations)

These live in `backend/scripts/`. Run them with `bun run scripts/<name>.ts` from the `backend/` directory.

| Script                                    | What it does                                | When to run                            |
| ----------------------------------------- | ------------------------------------------- | -------------------------------------- |
| `migrate-v11.ts` through `migrate-v17.ts` | Schema migrations                           | Already applied to prod. Don't re-run. |
| `calculate-heat.ts`                       | Recalculates heat scores for all holders    | After bulk transfer ingestion          |
| `index-and-calculate.ts`                  | Full scan + heat calc for a token           | Manual backfill                        |
| `backfill-metadata.ts`                    | Fetches DexScreener data for all bungalows  | When market data is stale              |
| `resolve-farcaster.ts`                    | Maps wallets → Farcaster identities         | After new users arrive                 |
| `build-personas.ts`                       | Builds `fid_island_profiles` from heat data | After heat recalculation               |
| `upload-bungalow.ts`                      | Uploads a bungalow image to storage         | Manual                                 |

---

## 12. Backup and Recovery

### Pre-session backup (run this before risky work)

```bash
./scripts/backup-db.sh
# This dumps the prod-v11 schema to the Railway backup database
# Takes ~5 seconds. Always do this before schema changes or agent sessions that touch the DB.
```

### Restore from backup

```bash
# Connect to Railway backup DB and pg_dump, then pg_restore to local
# See scripts/backup-db.sh for the exact connection strings
```

### Check what's in the DB right now

```bash
psql $DATABASE_URL -c "SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'prod-v11';"
psql $DATABASE_URL -c "SELECT COUNT(*) FROM \"prod-v11\".bungalows;"
psql $DATABASE_URL -c "SELECT COUNT(*) FROM \"prod-v11\".token_holder_heat;"
```

---

## 13. PM2 Process Management

The backend runs under PM2 so it survives SSH disconnects and auto-restarts on crashes.
All PM2 configuration lives in `ecosystem.config.js` at the root of FINAL/.

```bash
# ─── Status ───────────────────────────────────────────────────────────
pm2 list                          # see all processes and their status
pm2 logs jbi                      # tail live logs
pm2 logs jbi --lines 100          # last 100 lines
pm2 monit                         # live dashboard (CPU, memory, logs)

# ─── The right command for the right situation ────────────────────────
./scripts/deploy-backend.sh       # ← USE THIS for backend code changes (graceful, zero downtime)
./scripts/build.sh                # ← USE THIS for frontend changes (no restart at all)

pm2 reload ecosystem.config.js    # manual graceful reload (same as deploy-backend.sh does internally)
pm2 restart ecosystem.config.js   # hard restart — only for env var changes
pm2 stop jbi                      # stop the process
pm2 start ecosystem.config.js     # start from scratch (or use ./scripts/start.sh)

# ─── First-time setup ─────────────────────────────────────────────────
./scripts/start.sh                # sets up PM2 with ecosystem.config.js
pm2 startup                       # prints the command to enable auto-start on reboot
pm2 save                          # saves current process list so it survives reboots
```

Key settings in `ecosystem.config.js`:

- `kill_timeout: 15000` — gives 15 seconds to drain in-flight requests before hard kill
- `wait_ready: true` — new process must signal ready before old one is shut down
- `autorestart: true` — recovers automatically from crashes
- Logs go to `backend/logs/` (created automatically)

---

## 14. Cloudflare Tunnel

The app is exposed to the internet via a Cloudflare tunnel pointing to `localhost:3000`.

```bash
# Check tunnel is running
cloudflared tunnel list

# If tunnel is down
cloudflared tunnel run <tunnel-name>

# Tunnel should run as a systemd service so it survives reboots
# sudo systemctl status cloudflared
```

If the app is unreachable but `pm2 logs jbi` shows it running on port 3000, the tunnel is the problem.

---

## 15. What NOT to Do

Read this before every session.

- **Never** `DROP TABLE` or `DROP COLUMN` anything. Use `ADD COLUMN IF NOT EXISTS` for all schema changes.
- **Never** edit files inside `backend/public/island/` directly. They are generated by the Vite build and will be overwritten.
- **Never** commit `backend/.env.local` or `island/.env`.
- **Never** change the schema name `prod-v11` in queries without changing it in `config.ts` first and understanding all affected queries.
- **Never** restart the database without the owner's explicit confirmation.
- **Never** change the Heat formula (`K = 60`, the TWAB/totalSupply ratio) without understanding that it will invalidate all existing scores and require a full recalculation.
- **Never** run more than one simultaneous scan on the same token — the scan system has no lock and will produce duplicate entries.

---

## 16. Workflow for Common Tasks

### Add a new API endpoint

1. Create or edit a route file in `backend/src/routes/`
2. Mount it in `backend/src/index.ts` with `app.route('/api', yourRoute)`
3. Bun's `--watch` restarts automatically
4. Test: `curl https://memtics.lat/api/your-new-endpoint`

### Add a new frontend page

1. Create `island/src/pages/YourPage.tsx`
2. Add a route in `island/src/App.tsx`
3. Add a link wherever navigation lives
4. Run `./scripts/build.sh`
5. Hard-refresh browser

### Add a new database column

```bash
./scripts/backup-db.sh
# Then either:
# (a) add it inline in backend/src/db/queries.ts with ALTER TABLE IF NOT EXISTS
# (b) create a new migration script scripts/migrate-vXX.ts
# Run the migration, then update schema.ts TypeScript types to match
```

### Debug a broken scan

```bash
# Find the scan log
psql $DATABASE_URL -c "SELECT * FROM \"prod-v11\".scan_log ORDER BY started_at DESC LIMIT 5;"

# Or via API
curl https://memetics.lat/api/scan/<scanId>/status
```

### Check who holds a token

```bash
curl "https://memetics.lat/api/token/base/0xYOUR_TOKEN/holders?limit=20"
```

---

## 17. Changelog Discipline

**This is a product rule, not just a code rule.**

Any agent or developer who ships a meaningful change must:

1. Add an entry to `island/src/pages/ChangelogPage.tsx`
2. If the product model changed (what a bungalow is, how heat works, what tiers mean), update `island/src/pages/AboutPage.tsx`

Format: `YYYY-MM-DD — Short description of what changed and why.`

If you skip this, the product history is lost and the next person (human or AI) has no context.
