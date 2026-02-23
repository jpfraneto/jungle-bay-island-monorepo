import { COLORS, BUNGALOW_CSS } from "./styles";
import { renderClientScript } from "./client";
import { renderTopbarAuth, renderMiniappSdk, renderMiniappEmbed } from "./auth-ui";
import type {
  BungalowRow,
  TokenHolderRow,
  BulletinPostRow,
} from "../db/schema";
import type { TierDistribution } from "../services/heat"; // kept for interface

function esc(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "&#39;");
}

function escJson(str: string): string {
  return str.replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

function fmtNumber(val: string | number | null | undefined): string {
  if (val === null || val === undefined || val === "") return "—";
  const n = Number(val);
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n >= 1) return `${n.toFixed(2)}`;
  if (n >= 0.0001) return `${n.toFixed(4)}`;
  return `${n.toExponential(2)}`;
}

function fmtHeat(val: string | number): string {
  const n = Number(val);
  return n.toFixed(1) + "\u00B0";
}

function shortAddr(addr: string): string {
  if (addr.length <= 10) return addr;
  return addr.slice(0, 6) + "\u2026" + addr.slice(-4);
}

function chainLabel(chain: string): string {
  const labels: Record<string, string> = {
    base: "Base",
    ethereum: "Ethereum",
    solana: "Solana",
  };
  return labels[chain] ?? chain;
}

function chainSvg(chain: string, size = 16): string {
  if (chain === "base") {
    return `<svg class="chain-icon" width="${size}" height="${size}" viewBox="0 0 111 111" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="55.5" cy="55.5" r="55.5" fill="#0052FF"/><path d="M55.4 93.5c20.9 0 37.9-17 37.9-37.9 0-20.9-17-37.9-37.9-37.9-19.7 0-35.9 15.1-37.7 34.3h50v7.2h-50C19.5 78.4 35.7 93.5 55.4 93.5z" fill="#fff"/></svg>`;
  }
  if (chain === "solana") {
    return `<svg class="chain-icon" width="${size}" height="${size}" viewBox="0 0 397 312" xmlns="http://www.w3.org/2000/svg"><linearGradient id="sg" x1="360" y1="350" x2="40" y2="-30" gradientUnits="userSpaceOnUse"><stop stop-color="#00FFA3"/><stop offset="1" stop-color="#DC1FFF"/></linearGradient><path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z" fill="url(#sg)"/><path d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z" fill="url(#sg)"/><path d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z" fill="url(#sg)"/></svg>`;
  }
  return `<svg class="chain-icon" width="${size}" height="${size}" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="16" fill="#627EEA"/><path d="M16.5 4v8.87l7.5 3.35L16.5 4z" fill="#fff" opacity=".6"/><path d="M16.5 4L9 16.22l7.5-3.35V4z" fill="#fff"/><path d="M16.5 21.97v6.03L24 17.62l-7.5 4.35z" fill="#fff" opacity=".6"/><path d="M16.5 28V21.97L9 17.62 16.5 28z" fill="#fff"/></svg>`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function dexscreenerChain(chain: string): string {
  const map: Record<string, string> = {
    base: "base",
    ethereum: "ethereum",
    solana: "solana",
  };
  return map[chain] ?? chain;
}

interface BungalowPageData {
  chain: string;
  tokenAddress: string;
  bungalow: BungalowRow | null;
  customHtml: string | null;
  holders: TokenHolderRow[];
  holderTotal: number;
  bulletinPosts: (BulletinPostRow & {
    poster_username: string | null;
    poster_pfp: string | null;
  })[];
  bulletinTotal: number;
  heatDistribution: TierDistribution;
  fallbackName?: string | null;
  fallbackSymbol?: string | null;
  fallbackImage?: string | null;
}

function renderWalletChoice(): string {
  return `<div class="wallet-choice" style="display:none">
    <button class="wallet-choice-btn pay-base-btn">
      <span class="wallet-choice-icon">&#x26D3;</span>
      Pay with Base (MetaMask)
    </button>
    <button class="wallet-choice-btn pay-solana-btn">
      <span class="wallet-choice-icon">&#x2600;</span>
      Pay with Solana (Phantom)
    </button>
  </div>`;
}

export function renderBungalow(data: BungalowPageData): string {
  const b = data.bungalow;
  const name = b?.name ?? data.fallbackName ?? "Unknown Token";
  const symbol = b?.symbol ?? data.fallbackSymbol ?? "";
  const imageUrl = b?.image_url ?? data.fallbackImage ?? null;
  const isClaimed = b?.is_claimed ?? false;

  const displayTitle = `${esc(name)}${symbol ? ` ($${esc(symbol)})` : ""}`;
  const pageTitle = symbol
    ? `$${esc(symbol)} ${data.tokenAddress}`
    : `${data.tokenAddress}`;
  const dexUrl = `https://dexscreener.com/${dexscreenerChain(data.chain)}/${data.tokenAddress}?embed=1&theme=dark&info=0`;

  const links: { url: string; label: string }[] = [];
  if (b?.link_x) links.push({ url: b.link_x, label: "X" });
  if (b?.link_farcaster)
    links.push({ url: b.link_farcaster, label: "Farcaster" });
  if (b?.link_telegram) links.push({ url: b.link_telegram, label: "Telegram" });
  if (b?.link_website) links.push({ url: b.link_website, label: "Website" });
  if (b?.link_dexscreener)
    links.push({ url: b.link_dexscreener, label: "DexScreener" });

  // Resolve admin X link for claimed-but-no-html state
  const ownerWallet = b?.current_owner ?? null;
  const adminXLink = b?.link_x ?? null;

  // Build __DATA__ for client JS
  const clientData = {
    chain: data.chain,
    tokenAddress: data.tokenAddress,
    name,
    symbol,
    imageUrl,
    isClaimed,
    ownerWallet,
    marketData: b
      ? {
          price_usd: b.price_usd,
          market_cap: b.market_cap,
          volume_24h: b.volume_24h,
          liquidity_usd: b.liquidity_usd,
        }
      : null,
    holderTotal: data.holderTotal,
    heatDistribution: data.heatDistribution,
    bulletinTotal: data.bulletinTotal,
    links,
    dexscreenerUrl: dexUrl,
    solanaRpcUrl: "https://api.mainnet-beta.solana.com",
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${pageTitle} — Memetics</title>
  <meta property="og:title" content="${pageTitle} — Memetics" />
  <meta property="og:type" content="website" />
  ${imageUrl ? `<meta property="og:image" content="${esc(imageUrl)}" />` : ""}
  ${renderMiniappEmbed({
    imageUrl: `https://memetics.lat/api/og-image/${data.chain}/${data.tokenAddress}`,
    buttonTitle: symbol ? `View $${symbol}` : 'View Token',
    launchUrl: `https://memetics.lat/${data.chain}/${data.tokenAddress}`,
  })}
  <style>${BUNGALOW_CSS}</style>
  <script>window.__DATA__ = ${escJson(JSON.stringify(clientData))};</script>
</head>
<body>
  <div class="shell">
    <!-- Top bar -->
    <header class="topbar">
      <a href="/" class="topbar-logo"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 20V4l5 8 4-6 4 6 5-8v16" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></a>
      ${imageUrl ? `<img class="topbar-token-img" src="${esc(imageUrl)}" alt="" />` : ""}
      ${symbol ? `<span class="topbar-token-ticker">$${esc(symbol)}</span>` : ""}
      ${b?.price_usd ? `<span class="topbar-token-price">$${fmtNumber(b.price_usd)}</span>` : ""}
      <span class="topbar-ca" id="copy-ca" title="Click to copy">${shortAddr(data.tokenAddress)}</span>
      <span class="topbar-chain">${chainSvg(data.chain)}</span>
      <div class="topbar-right">
        ${renderTopbarAuth()}
      </div>
    </header>

    <!-- Tab bar -->
    <nav class="tab-bar">
      <button class="tab-btn" data-tab="miniapp">Miniapp</button>
      <button class="tab-btn" data-tab="chart">Chart</button>
      <button class="tab-btn active" data-tab="holders">Holders</button>
    </nav>

    <!-- Tab content -->
    <main class="tab-content">
      <!-- Miniapp -->
      <div class="tab-panel" id="panel-miniapp">
        ${renderMarketStrip(b)}
        ${
          data.customHtml
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
                <p>This bungalow has been claimed${ownerWallet ? ` by <span style="color:${COLORS.accent}">${shortAddr(ownerWallet)}</span>` : ""}.</p>
                <p>They can customize this page with their own HTML anytime.</p>
                <div class="claim-form" id="owner-update-form" style="display:none;max-width:480px;width:100%;margin-top:12px">
                  <p style="color:${COLORS.textMuted};font-size:12px;margin-bottom:8px">Paste a link to a raw GitHub Gist with your HTML and click Update.</p>
                  <input type="text" id="update-url" class="claim-input" placeholder="https://gist.githubusercontent.com/.../raw/.../index.html" spellcheck="false" autocomplete="off" style="width:100%;background:${COLORS.surface};border:1px solid ${COLORS.border};color:${COLORS.text};padding:10px 14px;font-size:13px;font-family:inherit;border-radius:6px;outline:none;margin-bottom:8px" />
                  <button class="cta-link" id="update-btn" style="cursor:pointer;border:none;text-align:center;font-family:inherit;width:100%">Update Page &mdash; 1 USDC</button>
                  <div id="update-status" style="font-size:12px;text-align:center;min-height:20px;margin-top:8px"></div>
                </div>
              </div>`
        }
        ${links.length > 0 ? `<div class="token-links">${links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${l.label}</a>`).join("")}</div>` : ""}
      </div>

      <!-- Chart -->
      <div class="tab-panel" id="panel-chart">
        <div class="chart-layout">
          <iframe class="chart-frame" id="chart-frame" src="" loading="lazy" allow="clipboard-write"></iframe>
        </div>
      </div>

      <!-- Holders -->
      <div class="tab-panel active" id="panel-holders">
        <div id="holder-chart-wrap" class="holder-chart-wrap" style="display:none">
          <div id="holder-chart-skeleton" class="holder-chart-skeleton">
            <div class="skeleton-bar" style="width:80%"></div>
            <div class="skeleton-bar" style="width:55%"></div>
            <div class="skeleton-bar" style="width:70%"></div>
            <div class="skeleton-bar" style="width:40%"></div>
            <div class="skeleton-bar" style="width:90%"></div>
          </div>
          <canvas id="holder-chart-canvas"></canvas>
          <div id="holder-chart-legend" class="holder-chart-legend">
            <button class="holder-chart-search-btn" id="holder-search-btn" title="Search wallet">&#x1F50D; Search</button>
          </div>
          <div class="holder-search-overlay" id="holder-search-overlay">
            <input class="holder-search-input" id="holder-search-input" type="text" placeholder="Paste wallet address..." spellcheck="false" autocomplete="off" />
            <button class="holder-search-go" id="holder-search-go">Add</button>
            <button class="holder-search-close" id="holder-search-close">&times;</button>
          </div>
          <div class="holder-search-msg" id="holder-search-msg"></div>
        </div>
        <div class="panel-scroll" id="holders-scroll">
          <div class="panel-inner">
            ${renderHolders(data.holders, data.holderTotal, data.chain)}
          </div>
        </div>
      </div>

    </main>
  </div>

  <a href="https://x.com/jpfraneto" target="_blank" rel="noopener" class="beta-banner">this app is in BETA. contact @jpfraneto for support</a>
  ${renderClientScript()}
  ${renderMiniappSdk()}
</body>
</html>`;
}

function renderMarketStrip(b: BungalowRow | null): string {
  if (!b) return "";
  const hasData =
    b.price_usd || b.market_cap || b.volume_24h || b.liquidity_usd;
  if (!hasData) return "";

  const items: { label: string; value: string }[] = [];
  if (b.price_usd)
    items.push({ label: "Price", value: fmtNumber(b.price_usd) });
  if (b.market_cap)
    items.push({ label: "MCap", value: fmtNumber(b.market_cap) });
  if (b.liquidity_usd)
    items.push({ label: "Liq", value: fmtNumber(b.liquidity_usd) });
  if (b.volume_24h)
    items.push({ label: "24h Vol", value: fmtNumber(b.volume_24h) });

  if (items.length === 0) return "";

  return `<div class="market-strip">
    ${items.map((i) => `<div class="market-item"><div class="label">${i.label}</div><div class="value">${i.value}</div></div>`).join("")}
  </div>`;
}

function renderHolders(
  holders: TokenHolderRow[],
  total: number,
  chain: string,
): string {
  if (holders.length === 0) {
    return `<div class="scan-cta">
      <p>No holder data yet. Scan this token to see holders &amp; heat.</p>
      <button class="cta-link scan-pay-btn" id="scan-holders-btn">Scan &amp; Claim &mdash; 1 USDC</button>
      ${renderWalletChoice()}
      <div id="scan-holders-status" class="claim-status" style="margin-top:8px"></div>
    </div>`;
  }

  const rows = holders
    .slice(0, 30)
    .map((h, i) => {
      const identity =
        h.fid && h.username
          ? `<span class="holder-identity">
          ${h.pfp_url ? `<img class="holder-pfp" src="${esc(h.pfp_url)}" alt="" />` : ""}
          <span class="holder-username">${esc(h.username)}</span>
        </span>`
          : `<span class="holder-wallet">${shortAddr(h.wallet)}</span>`;

      return `<tr class="holder-row" data-wallet="${esc(h.wallet)}">
      <td class="rank">${i + 1}</td>
      <td><a class="holder-link" href="/wallet/${esc(h.wallet)}">${identity}</a></td>
      <td class="heat" data-wallet="${esc(h.wallet)}">${fmtHeat(h.heat_degrees)}</td>
    </tr>`;
    })
    .join("");

  return `<p class="holder-count" id="holder-count">${total} holder${total !== 1 ? "s" : ""} &middot; <span style="opacity:0.5">tap a heat score to chart it</span></p>
  <div id="holders-list">
    <table class="holders-table">
      <thead><tr><th>#</th><th>Holder</th><th style="text-align:right">Heat Score</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${total > 30 ? '<div class="holders-load-more" id="holders-load-more">Loading more...</div>' : ""}
  </div>`;
}

function renderBulletin(
  posts: (BulletinPostRow & {
    poster_username: string | null;
    poster_pfp: string | null;
  })[],
  total: number,
): string {
  if (posts.length === 0) {
    return '<p class="bulletin-empty">No messages yet.</p>';
  }

  return posts
    .map(
      (p) => `<div class="bulletin-post">
    <div class="bulletin-meta">
      ${p.poster_username ? `<span class="username">${esc(p.poster_username)}</span>` : `<span>${shortAddr(p.wallet)}</span>`}
      <span>${timeAgo(p.created_at)}</span>
    </div>
    <div class="bulletin-content">${esc(p.content)}</div>
  </div>`,
    )
    .join("");
}
