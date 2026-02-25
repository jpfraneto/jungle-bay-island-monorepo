import { COLORS, USER_PAGE_CSS } from "./styles";
import { getTierFromHeat } from "../services/heat";
import {
  renderTopbarAuth,
  renderMiniappSdk,
  renderMiniappEmbed,
} from "./auth-ui";

function esc(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "&#39;");
}

function shortAddr(addr: string): string {
  if (addr.length <= 10) return addr;
  return addr.slice(0, 6) + "\u2026" + addr.slice(-4);
}

function fmtHeat(val: number): string {
  return val.toFixed(1) + "\u00B0";
}

function arkhamSvg(size = 14): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 761 703" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M114.48 515.486L380.133 703L471.864 638.119L149.705 410.677L114.48 515.486ZM272.991 465.577L380.133 541.153L471.864 476.272L308.216 360.769L272.991 465.577ZM403.616 557.552L495.347 622.433L761 434.919L725.775 330.111L403.616 557.552ZM402.882 395.705L494.613 460.586L601.755 384.297L566.53 279.489C567.264 279.489 402.882 395.705 402.882 395.705ZM199.607 262.377L158.511 385.01L250.242 449.178L312.619 262.377H199.607ZM101.271 131.189L0 434.919L91.731 499.8L214.284 131.902L101.271 131.189ZM242.904 131.189L207.679 235.997H410.221L374.996 131.189H242.904ZM403.616 131.189L466.727 317.99L558.458 253.108L517.363 130.476C517.363 131.189 403.616 131.189 403.616 131.189ZM145.302 0.712982L110.077 105.521H508.556L473.332 0L145.302 0.712982ZM614.964 0H501.952L625.238 367.899L716.969 303.017L614.964 0Z" fill="currentColor"/></svg>`;
}

function isEvmAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

function chainSvg(chain: string | null, size = 14): string {
  if (chain === "base") {
    return `<svg class="chain-icon" width="${size}" height="${size}" viewBox="0 0 249 249" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M0 19.671C0 12.9332 0 9.56425 1.26956 6.97276C2.48511 4.49151 4.49151 2.48511 6.97276 1.26956C9.56425 0 12.9332 0 19.671 0H229.329C236.067 0 239.436 0 242.027 1.26956C244.508 2.48511 246.515 4.49151 247.73 6.97276C249 9.56425 249 12.9332 249 19.671V229.329C249 236.067 249 239.436 247.73 242.027C246.515 244.508 244.508 246.515 242.027 247.73C239.436 249 236.067 249 229.329 249H19.671C12.9332 249 9.56425 249 6.97276 247.73C4.49151 246.515 2.48511 244.508 1.26956 242.027C0 239.436 0 236.067 0 229.329V19.671Z" fill="#0000FF"/></svg>`;
  }
  if (chain === "solana") {
    return `<svg class="chain-icon" width="${size}" height="${size}" viewBox="0 0 397 312" xmlns="http://www.w3.org/2000/svg"><linearGradient id="sg2" x1="360" y1="350" x2="40" y2="-30" gradientUnits="userSpaceOnUse"><stop stop-color="#00FFA3"/><stop offset="1" stop-color="#DC1FFF"/></linearGradient><path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z" fill="url(#sg2)"/><path d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z" fill="url(#sg2)"/><path d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z" fill="url(#sg2)"/></svg>`;
  }
  return `<svg class="chain-icon" width="${size}" height="${size}" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="16" fill="#627EEA"/><path d="M16.5 4v8.87l7.5 3.35L16.5 4z" fill="#fff" opacity=".6"/><path d="M16.5 4L9 16.22l7.5-3.35V4z" fill="#fff"/></svg>`;
}

interface UserPageData {
  wallet: string;
  island_heat: number;
  tier: string;
  farcaster: {
    fid: number | null;
    username: string | null;
    display_name: string | null;
    pfp_url: string | null;
  } | null;
  token_breakdown: Array<{
    token: string;
    token_name: string;
    token_symbol: string | null;
    chain: string | null;
    heat_degrees: number;
  }>;
  scans: Array<{ chain: string; token_address: string; scanned_at: string }>;
  linked_wallets?: Array<{ wallet: string; wallet_kind: string }> | null;
  x_username?: string | null;
}

export function renderUserPage(data: UserPageData): string {
  const tier = data.tier || getTierFromHeat(data.island_heat);
  const pfp = data.farcaster?.pfp_url ?? null;
  const displayName = data.farcaster?.display_name ?? null;
  const username = data.farcaster?.username ?? null;

  const arkhamLink = isEvmAddress(data.wallet)
    ? `<a href="https://intel.arkm.com/explorer/address/${esc(data.wallet)}" target="_blank" rel="noopener" class="arkham-link" title="View on Arkham">${arkhamSvg(14)}</a>`
    : "";

  const fcProfileUrl = data.farcaster?.username
    ? `https://warpcast.com/${esc(data.farcaster.username)}`
    : null;

  const fcCard = data.farcaster
    ? `<a href="${fcProfileUrl}" target="_blank" rel="noopener" class="fc-card" style="text-decoration:none">
        ${data.farcaster.pfp_url ? `<img class="fc-pfp" src="${esc(data.farcaster.pfp_url)}" alt="" />` : ""}
        <div style="flex:1">
          ${data.farcaster.display_name ? `<div class="fc-display">${esc(data.farcaster.display_name)}</div>` : ""}
          ${data.farcaster.username ? `<div class="fc-username">@${esc(data.farcaster.username)}</div>` : ""}
        </div>
        <span style="color:${COLORS.textMuted};font-size:11px">Farcaster \u2197</span>
      </a>`
    : "";

  const hasLinkedWallets =
    data.linked_wallets && data.linked_wallets.length > 1;
  const walletCount = data.linked_wallets?.length ?? 0;

  const aggregateToggle = hasLinkedWallets
    ? `<div class="aggregate-toggle">
        <button class="toggle-btn active" id="toggle-single">This wallet</button>
        <button class="toggle-btn" id="toggle-all">All wallets (${walletCount})</button>
      </div>`
    : "";

  const tokenRows = data.token_breakdown
    .map((t) => {
      const href = t.chain ? `/${t.chain}/${t.token}` : "#";
      const sym = t.token_symbol
        ? `$${esc(t.token_symbol)}`
        : esc(t.token_name);
      return `<tr>
      <td><a href="${esc(href)}">${sym}</a></td>
      <td class="ca-col"><a href="${esc(href)}">${shortAddr(t.token)}</a></td>
      <td class="chain-col">${t.chain ? chainSvg(t.chain) : "\u2014"}</td>
      <td class="heat-val">${fmtHeat(t.heat_degrees)}</td>
    </tr>`;
    })
    .join("");

  const tokenTable =
    data.token_breakdown.length > 0
      ? `<h3 class="section-title">Token Exposure</h3>
       ${aggregateToggle}
       <div id="token-table-container">
       <table class="token-table">
         <thead><tr><th>Token</th><th>CA</th><th>Chain</th><th style="text-align:right">Heat</th></tr></thead>
         <tbody>${tokenRows}</tbody>
       </table>
       </div>`
      : '<p class="empty-state">No scanned token holdings found.</p>';

  const pageTitle = username
    ? `@${esc(username)} — Memetics`
    : `${shortAddr(data.wallet)} — Memetics`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <link rel="icon" type="image/svg+xml" href="/logo.svg" />
  <title>${pageTitle}</title>
  ${renderMiniappEmbed({ launchUrl: "https://memetics.lat/wallet/" + esc(data.wallet) })}
  <style>${USER_PAGE_CSS}</style>
</head>
<body>
  <header class="topbar">
    <a href="/" class="topbar-logo"><img src="/logo.svg" alt="Memetics" style="width:20px;height:20px" /></a>
    <div style="margin-left:auto;display:flex;align-items:center">
      ${renderTopbarAuth()}
    </div>
  </header>

  <div class="wrap">
    <div class="user-header">
      ${pfp ? `<img class="user-pfp" src="${esc(pfp)}" alt="" />` : ""}
      <div class="user-info">
        ${
          displayName
            ? `<div class="user-name">${esc(displayName)}</div>
             <div class="user-wallet-line">
               <span class="wallet-full" id="wallet-addr">${esc(data.wallet)}</span>
               <span class="wallet-short" id="wallet-addr-short">${shortAddr(data.wallet)}</span>
               <button class="copy-btn" id="copy-wallet">copy</button>
               ${arkhamLink}
             </div>`
            : `<div class="user-wallet-line user-wallet-primary">
               <span class="wallet-full" id="wallet-addr">${esc(data.wallet)}</span>
               <span class="wallet-short" id="wallet-addr-short">${shortAddr(data.wallet)}</span>
               <button class="copy-btn" id="copy-wallet">copy</button>
               ${arkhamLink}
             </div>`
        }
      </div>
    </div>

    ${fcCard}
    ${tokenTable}

    <div class="scan-another" style="margin-top:32px">
      <h3 class="section-title">Scan Another Token</h3>
      <div class="scan-form-group">
        <input type="text" id="ca-input" placeholder="base or solana CA" autocomplete="off" spellcheck="false" readonly />
        <button type="button" class="scan-paste-btn" id="paste-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M9 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2h-2"/></svg> PASTE</button>
      </div>
      <div class="scan-status-msg" id="status-msg"></div>
    </div>
  </div>

  <a href="https://x.com/jpfraneto" target="_blank" rel="noopener" class="beta-banner">this app is in BETA. contact @jpfraneto for support</a>

  <script>
    var wallet = ${JSON.stringify(data.wallet)};
    var hasLinked = ${hasLinkedWallets ? "true" : "false"};

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
      var isAggregated = false;

      function shortAddr(addr) {
        if (!addr || addr.length <= 10) return addr || '';
        return addr.slice(0, 6) + '\\u2026' + addr.slice(-4);
      }

      function fmtHeat(val) {
        return Number(val).toFixed(1) + '\\u00B0';
      }

      function chainSvgClient(chain) {
        if (chain === 'base') return '<svg class="chain-icon" width="14" height="14" viewBox="0 0 111 111" fill="none"><circle cx="55.5" cy="55.5" r="55.5" fill="#0052FF"/><path d="M55.4 93.5c20.9 0 37.9-17 37.9-37.9 0-20.9-17-37.9-37.9-37.9-19.7 0-35.9 15.1-37.7 34.3h50v7.2h-50C19.5 78.4 35.7 93.5 55.4 93.5z" fill="#fff"/></svg>';
        if (chain === 'solana') return '<svg class="chain-icon" width="14" height="14" viewBox="0 0 397 312"><linearGradient id="sg3" x1="360" y1="350" x2="40" y2="-30" gradientUnits="userSpaceOnUse"><stop stop-color="#00FFA3"/><stop offset="1" stop-color="#DC1FFF"/></linearGradient><path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z" fill="url(#sg3)"/><path d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z" fill="url(#sg3)"/><path d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z" fill="url(#sg3)"/></svg>';
        return '\\u2014';
      }

      function renderAggregatedTable(data) {
        if (!data.token_breakdown || data.token_breakdown.length === 0) {
          container.innerHTML = '<p style="color:#71717a;text-align:center;padding:20px">No scanned token holdings found.</p>';
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
            + '<td class="ca-col"><a href="' + href + '">' + shortAddr(t.token) + '</a></td>'
            + '<td class="chain-col">' + (t.chain ? chainSvgClient(t.chain) : '\\u2014') + '</td>'
            + '<td class="heat-val">' + fmtHeat(t.heat_degrees) + '</td>'
            + '</tr>';
        }).join('');

        container.innerHTML = '<table class="token-table">'
          + '<thead><tr><th>Token</th><th>CA</th><th>Chain</th><th style="text-align:right">Heat</th></tr></thead>'
          + '<tbody>' + rows + '</tbody></table>';

        // Update heat badge
        if (heatBadge) heatBadge.textContent = fmtHeat(data.island_heat);
      }

      var originalHtml = container ? container.innerHTML : '';
      var originalHeat = heatBadge ? heatBadge.textContent : '';

      if (singleBtn) {
        singleBtn.addEventListener('click', function() {
          if (!isAggregated) return;
          isAggregated = false;
          singleBtn.classList.add('active');
          allBtn.classList.remove('active');
          if (container) container.innerHTML = originalHtml;
          if (heatBadge) heatBadge.textContent = originalHeat;
        });
      }

      if (allBtn) {
        allBtn.addEventListener('click', function() {
          if (isAggregated) return;
          isAggregated = true;
          allBtn.classList.add('active');
          singleBtn.classList.remove('active');
          if (container) container.innerHTML = '<p style="color:#71717a;text-align:center;padding:20px">Loading...</p>';

          fetch('/api/wallet/' + wallet + '?aggregate=true')
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

    // ── Scan another token (paste CA) ──
    var EVM_RE = /^0x[0-9a-fA-F]{40}$/;
    var SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    var caInput = document.getElementById('ca-input');
    var pasteBtn = document.getElementById('paste-btn');
    var statusEl2 = document.getElementById('status-msg');

    function setStatus2(msg, type) {
      if (!statusEl2) return;
      statusEl2.textContent = msg;
      statusEl2.className = 'scan-status-msg' + (type ? ' ' + type : '');
    }

    function detectChain(addr) {
      if (EVM_RE.test(addr)) return 'base';
      if (SOL_RE.test(addr)) return 'solana';
      return null;
    }

    async function validateAndGo(addr) {
      var chain = detectChain(addr);
      if (!chain) { setStatus2('Not a valid contract address', 'error'); return; }
      if (caInput) caInput.value = addr;
      setStatus2('Checking token...', 'checking');
      if (pasteBtn) pasteBtn.disabled = true;

      var chainsToTry = chain === 'solana' ? ['solana'] : ['base', 'ethereum'];
      var found = false;
      for (var i = 0; i < chainsToTry.length; i++) {
        try {
          var resp = await fetch('https://api.dexscreener.com/tokens/v1/' + chainsToTry[i] + '/' + addr);
          if (resp.ok) {
            var pairs = await resp.json();
            if (Array.isArray(pairs) && pairs.length > 0) {
              chain = chainsToTry[i];
              found = true;
              break;
            }
          }
        } catch(e) {}
      }

      if (found) {
        setStatus2('Token found! Redirecting...', 'success');
        setTimeout(function() { window.location.href = '/' + chain + '/' + addr; }, 300);
      } else {
        setStatus2('Token not on DexScreener. Loading anyway...', 'checking');
        setTimeout(function() { window.location.href = '/' + chain + '/' + addr; }, 800);
      }
    }

    if (pasteBtn) {
      pasteBtn.addEventListener('click', async function() {
        setStatus2('', '');
        try {
          var text = await navigator.clipboard.readText();
          var addr = (text || '').trim();
          if (!addr) { setStatus2('Clipboard is empty', 'error'); return; }
          await validateAndGo(addr);
        } catch(e) {
          setStatus2('Clipboard access denied. Paste manually below.', 'error');
          if (caInput) caInput.focus();
        }
      });
    }
    if (caInput) {
      caInput.addEventListener('paste', function() {
        setTimeout(function() {
          var addr = caInput.value.trim();
          if (addr) validateAndGo(addr);
        }, 50);
      });
    }
  </script>
  ${renderMiniappSdk()}
</body>
</html>`;
}

function timeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
