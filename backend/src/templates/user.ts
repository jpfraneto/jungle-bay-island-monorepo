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
  linked_wallets?: Array<{ wallet: string; wallet_kind: string }> | null
  x_username?: string | null
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

  const hasLinkedWallets = data.linked_wallets && data.linked_wallets.length > 1
  const walletCount = data.linked_wallets?.length ?? 0

  const aggregateToggle = hasLinkedWallets
    ? `<div class="aggregate-toggle">
        <button class="toggle-btn active" id="toggle-single">This wallet</button>
        <button class="toggle-btn" id="toggle-all">All wallets (${walletCount})</button>
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
       ${aggregateToggle}
       <div id="token-table-container">
       <table class="token-table">
         <thead><tr><th>Token</th><th>Chain</th><th style="text-align:right">Heat</th></tr></thead>
         <tbody>${tokenRows}</tbody>
       </table>
       </div>`
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
    var hasLinked = ${hasLinkedWallets ? 'true' : 'false'};

    var copyBtn = document.getElementById('copy-wallet');
    if (copyBtn) {
      copyBtn.addEventListener('click', function() {
        navigator.clipboard.writeText(wallet).then(function() {
          copyBtn.textContent = 'copied!';
          setTimeout(function() { copyBtn.textContent = 'copy'; }, 1500);
        });
      });
    }

    // ── Aggregate toggle ──
    if (hasLinked) {
      var singleBtn = document.getElementById('toggle-single');
      var allBtn = document.getElementById('toggle-all');
      var container = document.getElementById('token-table-container');
      var heatBadge = document.querySelector('.badge-heat');
      var tierBadge = document.querySelector('.badge-tier');
      var isAggregated = false;

      function shortAddr(addr) {
        if (!addr || addr.length <= 10) return addr || '';
        return addr.slice(0, 6) + '\\u2026' + addr.slice(-4);
      }

      function fmtHeat(val) {
        return Number(val).toFixed(1) + '\\u00B0';
      }

      function chainLabel(ch) {
        var map = { base: 'Base', ethereum: 'Ethereum', solana: 'Solana' };
        return map[ch] || ch || '\\u2014';
      }

      function renderAggregatedTable(data) {
        if (!data.token_breakdown || data.token_breakdown.length === 0) {
          container.innerHTML = '<p style="color:#71717a;text-align:center;padding:20px">No token holdings found.</p>';
          return;
        }
        var rows = data.token_breakdown.map(function(t) {
          var href = t.chain ? '/' + t.chain + '/' + t.token : '#';
          var sym = t.token_symbol ? '$' + t.token_symbol : t.token_name;
          var walletBadges = '';
          if (t.wallet_heats && t.wallet_heats.length > 1) {
            walletBadges = '<div style="margin-top:4px">' + t.wallet_heats.map(function(wh) {
              return '<span class="wallet-badge">' + shortAddr(wh.wallet) + ': ' + fmtHeat(wh.heat_degrees) + '</span>';
            }).join(' ') + '</div>';
          }
          return '<tr>'
            + '<td><a href="' + href + '">' + sym + '</a>' + walletBadges + '</td>'
            + '<td>' + (t.chain ? '<span class="chain-badge">' + chainLabel(t.chain) + '</span>' : '\\u2014') + '</td>'
            + '<td class="heat-val">' + fmtHeat(t.heat_degrees) + '</td>'
            + '</tr>';
        }).join('');

        container.innerHTML = '<table class="token-table">'
          + '<thead><tr><th>Token</th><th>Chain</th><th style="text-align:right">Heat</th></tr></thead>'
          + '<tbody>' + rows + '</tbody></table>';

        // Update heat + tier badges
        if (heatBadge) heatBadge.textContent = fmtHeat(data.island_heat);
        if (tierBadge) tierBadge.textContent = data.tier;
      }

      var originalHtml = container ? container.innerHTML : '';
      var originalHeat = heatBadge ? heatBadge.textContent : '';
      var originalTier = tierBadge ? tierBadge.textContent : '';

      if (singleBtn) {
        singleBtn.addEventListener('click', function() {
          if (!isAggregated) return;
          isAggregated = false;
          singleBtn.classList.add('active');
          allBtn.classList.remove('active');
          if (container) container.innerHTML = originalHtml;
          if (heatBadge) heatBadge.textContent = originalHeat;
          if (tierBadge) tierBadge.textContent = originalTier;
        });
      }

      if (allBtn) {
        allBtn.addEventListener('click', function() {
          if (isAggregated) return;
          isAggregated = true;
          allBtn.classList.add('active');
          singleBtn.classList.remove('active');
          if (container) container.innerHTML = '<p style="color:#71717a;text-align:center;padding:20px">Loading...</p>';

          fetch('/api/user/' + wallet + '?aggregate=true')
            .then(function(r) { return r.json(); })
            .then(function(data) {
              renderAggregatedTable(data);
            })
            .catch(function() {
              if (container) container.innerHTML = '<p style="color:#f87171;text-align:center;padding:20px">Failed to load aggregated data.</p>';
            });
        });
      }
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
