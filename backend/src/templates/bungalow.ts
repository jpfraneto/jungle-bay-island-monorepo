import { COLORS, BUNGALOW_CSS } from './styles'
import { renderClientScript } from './client'
import { renderTopbarAuth } from './auth-ui'
import type { BungalowRow, TokenHolderRow, BulletinPostRow } from '../db/schema'
import type { TierDistribution } from '../services/heat'
import type { SessionUser } from '../services/session'

function esc(str: string | null | undefined): string {
  if (!str) return ''
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&#39;')
}

function escJson(str: string): string {
  return str.replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
}

function fmtNumber(val: string | number | null | undefined): string {
  if (val === null || val === undefined || val === '') return '—'
  const n = Number(val)
  if (!Number.isFinite(n)) return '—'
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  if (n >= 1) return `$${n.toFixed(2)}`
  if (n >= 0.0001) return `$${n.toFixed(4)}`
  return `$${n.toExponential(2)}`
}

function fmtHeat(val: string | number): string {
  const n = Number(val)
  return n.toFixed(1) + '\u00B0'
}

function shortAddr(addr: string): string {
  if (addr.length <= 10) return addr
  return addr.slice(0, 6) + '\u2026' + addr.slice(-4)
}

function chainLabel(chain: string): string {
  const labels: Record<string, string> = { base: 'Base', ethereum: 'Ethereum', solana: 'Solana' }
  return labels[chain] ?? chain
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function dexscreenerChain(chain: string): string {
  const map: Record<string, string> = { base: 'base', ethereum: 'ethereum', solana: 'solana' }
  return map[chain] ?? chain
}

interface BungalowPageData {
  chain: string
  tokenAddress: string
  bungalow: BungalowRow | null
  customHtml: string | null
  holders: TokenHolderRow[]
  holderTotal: number
  bulletinPosts: (BulletinPostRow & { poster_username: string | null; poster_pfp: string | null })[]
  bulletinTotal: number
  heatDistribution: TierDistribution
  fallbackName?: string | null
  fallbackSymbol?: string | null
  fallbackImage?: string | null
  session?: SessionUser | null
}

function renderWalletChoice(): string {
  return `<div id="wallet-choice" class="wallet-choice" style="display:none">
    <button class="wallet-choice-btn" id="pay-base-btn">
      <span class="wallet-choice-icon">&#x26D3;</span>
      Pay with Base (MetaMask)
    </button>
    <button class="wallet-choice-btn" id="pay-solana-btn">
      <span class="wallet-choice-icon">&#x2600;</span>
      Pay with Solana (Phantom)
    </button>
  </div>`
}

export function renderBungalow(data: BungalowPageData): string {
  const b = data.bungalow
  const name = b?.name ?? data.fallbackName ?? 'Unknown Token'
  const symbol = b?.symbol ?? data.fallbackSymbol ?? ''
  const imageUrl = b?.image_url ?? data.fallbackImage ?? null
  const isClaimed = b?.is_claimed ?? false

  const displayTitle = `${esc(name)}${symbol ? ` ($${esc(symbol)})` : ''}`
  const pageTitle = symbol ? `$${esc(symbol)} ${data.tokenAddress}` : `${data.tokenAddress}`
  const dexUrl = `https://dexscreener.com/${dexscreenerChain(data.chain)}/${data.tokenAddress}?embed=1&theme=dark&info=0`

  const links: { url: string; label: string }[] = []
  if (b?.link_x) links.push({ url: b.link_x, label: 'X' })
  if (b?.link_farcaster) links.push({ url: b.link_farcaster, label: 'Farcaster' })
  if (b?.link_telegram) links.push({ url: b.link_telegram, label: 'Telegram' })
  if (b?.link_website) links.push({ url: b.link_website, label: 'Website' })
  if (b?.link_dexscreener) links.push({ url: b.link_dexscreener, label: 'DexScreener' })

  // Resolve admin X link for claimed-but-no-html state
  const ownerWallet = b?.current_owner ?? null
  const adminXLink = b?.link_x ?? null

  // Build __DATA__ for client JS
  const clientData = {
    chain: data.chain,
    tokenAddress: data.tokenAddress,
    name,
    symbol,
    imageUrl,
    isClaimed,
    ownerWallet,
    marketData: b ? {
      price_usd: b.price_usd,
      market_cap: b.market_cap,
      volume_24h: b.volume_24h,
      liquidity_usd: b.liquidity_usd,
    } : null,
    holderTotal: data.holderTotal,
    heatDistribution: data.heatDistribution,
    bulletinTotal: data.bulletinTotal,
    links,
    dexscreenerUrl: dexUrl,
    solanaRpcUrl: 'https://api.mainnet-beta.solana.com',
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${pageTitle} — Memetics</title>
  <meta property="og:title" content="${pageTitle} — Memetics" />
  <meta property="og:type" content="website" />
  ${imageUrl ? `<meta property="og:image" content="${esc(imageUrl)}" />` : ''}
  <style>${BUNGALOW_CSS}</style>
  <script>window.__DATA__ = ${escJson(JSON.stringify(clientData))};</script>
</head>
<body>
  <div class="shell">
    <!-- Top bar -->
    <header class="topbar">
      <a href="/" class="topbar-logo">MEMETICS</a>
      <div class="topbar-token">
        ${imageUrl ? `<img class="topbar-token-img" src="${esc(imageUrl)}" alt="" />` : ''}
        <span class="topbar-token-name">${esc(name)}${symbol ? ` <span class="topbar-token-sym">$${esc(symbol)}</span>` : ''}</span>
      </div>
      <span class="topbar-ca" id="copy-ca" title="Click to copy">${shortAddr(data.tokenAddress)}</span>
      <span class="topbar-chain">${chainLabel(data.chain)}</span>
      <div class="topbar-right">
        ${renderTopbarAuth(data.session ?? null, `/${data.chain}/${data.tokenAddress}`)}
      </div>
    </header>

    <!-- Tab bar -->
    <nav class="tab-bar">
      <button class="tab-btn active" data-tab="home">Home</button>
      <button class="tab-btn" data-tab="chart">Chart</button>
      <button class="tab-btn" data-tab="holders">Holders</button>
      <button class="tab-btn" data-tab="heat">Heat</button>
      <button class="tab-btn" data-tab="wall">Wall</button>
    </nav>

    <!-- Tab content -->
    <main class="tab-content">
      <!-- Home -->
      <div class="tab-panel active" id="panel-home">
        ${renderMarketStrip(b)}
        ${data.customHtml
          ? `<iframe class="home-frame" srcdoc="${esc(data.customHtml)}" sandbox="allow-scripts allow-same-origin" loading="lazy"></iframe>`
          : data.holderTotal === 0 && !isClaimed
            ? `<div class="unclaimed-cta">
                <p>This token hasn't been scanned yet.</p>
                <p>Scan to see holders &amp; heat &mdash; you'll also claim this bungalow.</p>
                <button class="cta-link claim-btn" id="scan-claim-btn">Scan &amp; Claim &mdash; 1 USDC</button>
                ${renderWalletChoice()}
                <div id="scan-claim-status" class="claim-status"></div>
              </div>`
          : !isClaimed
            ? `<div class="unclaimed-cta">
                <p>This bungalow hasn't been claimed yet.</p>
                <p>Are you the founder? Claim it for 1 USDC.</p>
                <button class="cta-link claim-btn" id="claim-btn">Claim Bungalow &mdash; 1 USDC</button>
                ${renderWalletChoice()}
                <div id="claim-status" class="claim-status"></div>
              </div>`
            : `<div class="unclaimed-cta">
                <p>This bungalow has been claimed${ownerWallet ? ` by <span style="color:${COLORS.accent}">${shortAddr(ownerWallet)}</span>` : ''}.</p>
                <p>They can customize this page with their own HTML anytime.</p>
                <p style="color:${COLORS.textMuted};font-size:12px;margin-top:16px">If you are the owner, paste a link to a raw GitHub Gist with your HTML and click Update. Payment is handled automatically.</p>
                <div class="claim-form" style="max-width:480px;width:100%;margin-top:12px">
                  <input type="text" id="update-url" class="claim-input" placeholder="https://gist.githubusercontent.com/.../raw/.../index.html" spellcheck="false" autocomplete="off" style="width:100%;background:${COLORS.surface};border:1px solid ${COLORS.border};color:${COLORS.text};padding:10px 14px;font-size:13px;font-family:inherit;border-radius:6px;outline:none;margin-bottom:8px" />
                  <button class="cta-link" id="update-btn" style="cursor:pointer;border:none;text-align:center;font-family:inherit;width:100%">Update Page &mdash; 1 USDC</button>
                  <div id="update-status" style="font-size:12px;text-align:center;min-height:20px;margin-top:8px"></div>
                </div>
                ${adminXLink ? `<a class="cta-link" href="${esc(adminXLink)}" target="_blank" rel="noopener" style="margin-top:12px">Tell them on X</a>` : ''}
              </div>`
        }
        ${links.length > 0 ? `<div class="token-links">${links.map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${l.label}</a>`).join('')}</div>` : ''}
      </div>

      <!-- Chart -->
      <div class="tab-panel" id="panel-chart">
        <div class="chart-layout">
          <iframe class="chart-frame" id="chart-frame" src="" loading="lazy" allow="clipboard-write"></iframe>
          <div class="swap-placeholder">Swap coming soon</div>
        </div>
      </div>

      <!-- Holders -->
      <div class="tab-panel" id="panel-holders">
        <div class="panel-scroll">
          <div class="panel-inner">
            ${renderHolders(data.holders, data.holderTotal, data.chain)}
          </div>
        </div>
      </div>

      <!-- Heat -->
      <div class="tab-panel" id="panel-heat">
        <div class="panel-scroll">
          <div class="panel-inner">
            ${renderHeatTab(data.heatDistribution, data.holderTotal)}
          </div>
        </div>
      </div>

      <!-- Wall -->
      <div class="tab-panel" id="panel-wall">
        <div class="panel-scroll">
          <div class="panel-inner">
            ${renderBulletin(data.bulletinPosts, data.bulletinTotal)}
          </div>
        </div>
      </div>
    </main>

    <!-- Activity bar -->
    <div class="activity-bar">
      <div class="recents" id="recents"></div>
      <div class="activity-ticker" id="activity-ticker">Loading activity...</div>
    </div>
  </div>

  ${renderClientScript()}
</body>
</html>`
}

function renderMarketStrip(b: BungalowRow | null): string {
  if (!b) return ''
  const hasData = b.price_usd || b.market_cap || b.volume_24h || b.liquidity_usd
  if (!hasData) return ''

  const items: { label: string; value: string }[] = []
  if (b.price_usd) items.push({ label: 'Price', value: fmtNumber(b.price_usd) })
  if (b.market_cap) items.push({ label: 'MCap', value: fmtNumber(b.market_cap) })
  if (b.liquidity_usd) items.push({ label: 'Liq', value: fmtNumber(b.liquidity_usd) })
  if (b.volume_24h) items.push({ label: '24h Vol', value: fmtNumber(b.volume_24h) })

  if (items.length === 0) return ''

  return `<div class="market-strip">
    ${items.map(i => `<div class="market-item"><div class="label">${i.label}</div><div class="value">${i.value}</div></div>`).join('')}
  </div>`
}

function renderHolders(holders: TokenHolderRow[], total: number, chain: string): string {
  if (holders.length === 0) {
    return `<div class="scan-cta">
      <p>No holder data yet. Scan this token to see holders &amp; heat.</p>
      <button class="cta-link scan-pay-btn" id="scan-btn">Scan &amp; Claim &mdash; 1 USDC</button>
      ${renderWalletChoice()}
      <div id="scan-status" class="claim-status" style="margin-top:8px"></div>
    </div>`
  }

  const tierFilter = `<div class="tier-filter" id="tier-filter">
    <button class="tier-filter-btn active" data-tier-filter="">All</button>
    <button class="tier-filter-btn" data-tier-filter="Elder">Elder</button>
    <button class="tier-filter-btn" data-tier-filter="Builder">Builder</button>
    <button class="tier-filter-btn" data-tier-filter="Resident">Resident</button>
    <button class="tier-filter-btn" data-tier-filter="Observer">Observer</button>
    <button class="tier-filter-btn" data-tier-filter="Drifter">Drifter</button>
  </div>`

  const rows = holders.slice(0, 20).map((h, i) => {
    const identity = h.fid && h.username
      ? `<span class="holder-identity">
          ${h.pfp_url ? `<img class="holder-pfp" src="${esc(h.pfp_url)}" alt="" />` : ''}
          <span class="holder-username">${esc(h.username)}</span>
        </span>`
      : `<span class="holder-wallet">${shortAddr(h.wallet)}</span>`

    return `<tr class="holder-row">
      <td class="rank">${i + 1}</td>
      <td><a class="holder-link" href="/user/${esc(h.wallet)}">${identity}</a></td>
      <td class="heat">${fmtHeat(h.heat_degrees)}</td>
    </tr>`
  }).join('')

  return `${tierFilter}
  <p class="holder-count" id="holder-count">${total} holder${total !== 1 ? 's' : ''}</p>
  <div id="holders-list">
    <table class="holders-table">
      <thead><tr><th>#</th><th>Holder</th><th style="text-align:right">Heat</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`
}

function renderHeatTab(dist: TierDistribution, holderTotal: number): string {
  const total = dist.elders + dist.builders + dist.residents + dist.observers + dist.drifters

  return `
  <div class="heat-section">
    <h3>Tier Distribution</h3>
    <div class="tier-bars">
      ${renderTierRow('Elder', 'elder', dist.elders, total)}
      ${renderTierRow('Builder', 'builder', dist.builders, total)}
      ${renderTierRow('Resident', 'resident', dist.residents, total)}
      ${renderTierRow('Observer', 'observer', dist.observers, total)}
      ${renderTierRow('Drifter', 'drifter', dist.drifters, total)}
    </div>
  </div>
  <div class="heat-section">
    <h3>Summary</h3>
    <div class="heat-stats">
      <div class="heat-stat"><div class="label">Total Holders</div><div class="value" id="heat-total">${total}</div></div>
      <div class="heat-stat"><div class="label">Scanned</div><div class="value">${holderTotal}</div></div>
      <div class="heat-stat"><div class="label">Elders</div><div class="value" style="color:${COLORS.orange}">${dist.elders}</div></div>
      <div class="heat-stat"><div class="label">Builders</div><div class="value" style="color:${COLORS.yellow}">${dist.builders}</div></div>
    </div>
  </div>
  <div class="heat-section">
    <h3>How Heat Works</h3>
    <div class="heat-explainer">
      <p>Heat measures how long and how much of a token you hold, using a <strong>Time-Weighted Average Balance (TWAB)</strong>.</p>
      <p style="margin-top:8px"><code>Heat = 100 \u00D7 (1 - e^(-60 \u00D7 TWAB/totalSupply))</code></p>
      <p style="margin-top:8px">Tiers: <strong>Elder</strong> (250+\u00B0), <strong>Builder</strong> (150+\u00B0), <strong>Resident</strong> (80+\u00B0), <strong>Observer</strong> (30+\u00B0), <strong>Drifter</strong> (&lt;30\u00B0)</p>
      <p style="margin-top:8px">Island Heat is the sum of your heat across all scanned tokens.</p>
    </div>
  </div>`
}

function renderTierRow(label: string, tierClass: string, count: number, total: number): string {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  const width = total > 0 ? Math.max(pct, count > 0 ? 2 : 0) : 0

  return `<div class="tier-row" data-tier="${label}">
    <span class="tier-label">${label}</span>
    <div class="tier-bar-wrap">
      <div class="tier-bar ${tierClass}" id="bar-${tierClass}" style="width:${width}%"></div>
    </div>
    <span class="tier-count" id="count-${tierClass}">${count}</span>
  </div>`
}

function renderBulletin(
  posts: (BulletinPostRow & { poster_username: string | null; poster_pfp: string | null })[],
  total: number,
): string {
  if (posts.length === 0) {
    return '<p class="bulletin-empty">No messages yet.</p>'
  }

  return posts.map(p => `<div class="bulletin-post">
    <div class="bulletin-meta">
      ${p.poster_username ? `<span class="username">${esc(p.poster_username)}</span>` : `<span>${shortAddr(p.wallet)}</span>`}
      <span>${timeAgo(p.created_at)}</span>
    </div>
    <div class="bulletin-content">${esc(p.content)}</div>
  </div>`).join('')
}
