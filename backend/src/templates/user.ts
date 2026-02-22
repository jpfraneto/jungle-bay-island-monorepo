import { COLORS, USER_PAGE_CSS } from './styles'
import { getTierFromHeat } from '../services/heat'
import { renderTopbarAuth } from './auth-ui'
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

function shortAddr(addr: string): string {
  if (addr.length <= 10) return addr
  return addr.slice(0, 6) + '\u2026' + addr.slice(-4)
}

function fmtHeat(val: number): string {
  return val.toFixed(1) + '\u00B0'
}

function chainLabel(chain: string): string {
  const labels: Record<string, string> = { base: 'Base', ethereum: 'Ethereum', solana: 'Solana' }
  return labels[chain] ?? chain
}

const TIER_COLORS: Record<string, string> = {
  Elder: COLORS.orange,
  Builder: COLORS.yellow,
  Resident: COLORS.green,
  Observer: COLORS.accent,
  Drifter: COLORS.textMuted,
}

interface UserPageData {
  wallet: string
  island_heat: number
  tier: string
  farcaster: {
    fid: number | null
    username: string | null
    display_name: string | null
    pfp_url: string | null
  } | null
  token_breakdown: Array<{
    token: string
    token_name: string
    token_symbol: string | null
    chain: string | null
    heat_degrees: number
  }>
  scans: Array<{ chain: string; token_address: string; scanned_at: string }>
  session?: SessionUser | null
}

export function renderUserPage(data: UserPageData): string {
  const tier = data.tier || getTierFromHeat(data.island_heat)
  const tierColor = TIER_COLORS[tier] ?? COLORS.textMuted
  const pfp = data.farcaster?.pfp_url ?? null
  const displayName = data.farcaster?.display_name ?? null
  const username = data.farcaster?.username ?? null

  const fcCard = data.farcaster
    ? `<div class="fc-card">
        ${data.farcaster.pfp_url ? `<img class="fc-pfp" src="${esc(data.farcaster.pfp_url)}" alt="" />` : ''}
        <div>
          ${data.farcaster.display_name ? `<div class="fc-display">${esc(data.farcaster.display_name)}</div>` : ''}
          ${data.farcaster.username ? `<div class="fc-username">@${esc(data.farcaster.username)}</div>` : ''}
        </div>
      </div>`
    : ''

  const tokenRows = data.token_breakdown.map((t) => {
    const href = t.chain ? `/${t.chain}/${t.token}` : '#'
    const sym = t.token_symbol ? `$${esc(t.token_symbol)}` : esc(t.token_name)
    return `<tr>
      <td><a href="${esc(href)}">${sym}</a></td>
      <td>${t.chain ? `<span class="chain-badge">${chainLabel(t.chain)}</span>` : '—'}</td>
      <td class="heat-val">${fmtHeat(t.heat_degrees)}</td>
    </tr>`
  }).join('')

  const tokenTable = data.token_breakdown.length > 0
    ? `<h3 class="section-title">Token Exposure</h3>
       <table class="token-table">
         <thead><tr><th>Token</th><th>Chain</th><th style="text-align:right">Heat</th></tr></thead>
         <tbody>${tokenRows}</tbody>
       </table>`
    : '<p class="empty-state">No token holdings found.</p>'

  const scansList = data.scans.length > 0
    ? `<h3 class="section-title">Recent Scans</h3>
       <table class="token-table">
         <thead><tr><th>Token</th><th>Chain</th><th style="text-align:right">When</th></tr></thead>
         <tbody>${data.scans.slice(0, 20).map((s) => {
           const when = new Date(s.scanned_at)
           const ago = timeAgo(when)
           return `<tr>
             <td><a href="/${s.chain}/${s.token_address}">${shortAddr(s.token_address)}</a></td>
             <td><span class="chain-badge">${chainLabel(s.chain)}</span></td>
             <td style="text-align:right;color:${COLORS.textMuted};font-size:12px">${ago}</td>
           </tr>`
         }).join('')}</tbody>
       </table>`
    : ''

  const pageTitle = username ? `@${esc(username)} — Memetics` : `${shortAddr(data.wallet)} — Memetics`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${pageTitle}</title>
  <style>${USER_PAGE_CSS}</style>
</head>
<body>
  <header class="topbar">
    <a href="/" class="topbar-logo">MEMETICS</a>
    <div style="margin-left:auto;display:flex;align-items:center">
      ${renderTopbarAuth(data.session ?? null, '/user/' + data.wallet)}
    </div>
  </header>

  <div class="wrap">
    <div class="user-header">
      ${pfp ? `<img class="user-pfp" src="${esc(pfp)}" alt="" />` : ''}
      <div class="user-info">
        <div class="user-name">${displayName ? esc(displayName) : shortAddr(data.wallet)}</div>
        <div class="user-wallet-line">
          <span id="wallet-addr">${shortAddr(data.wallet)}</span>
          <button class="copy-btn" id="copy-wallet">copy</button>
        </div>
      </div>
      <span class="badge badge-heat">${fmtHeat(data.island_heat)}</span>
      <span class="badge badge-tier" style="color:${tierColor}">${tier}</span>
    </div>

    ${fcCard}
    ${tokenTable}
    ${scansList}
  </div>

  <script>
    var wallet = ${JSON.stringify(data.wallet)};
    var copyBtn = document.getElementById('copy-wallet');
    if (copyBtn) {
      copyBtn.addEventListener('click', function() {
        navigator.clipboard.writeText(wallet).then(function() {
          copyBtn.textContent = 'copied!';
          setTimeout(function() { copyBtn.textContent = 'copy'; }, 1500);
        });
      });
    }
  </script>
</body>
</html>`
}

function timeAgo(date: Date): string {
  const diff = Date.now() - date.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
