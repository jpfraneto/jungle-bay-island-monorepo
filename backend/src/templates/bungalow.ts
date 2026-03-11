import { COLORS, BUNGALOW_CSS } from "./styles";
import { renderClientScript } from "./client";
import { renderTopbarAuth, renderMiniappEmbed, renderMiniappSdk } from "./auth-ui";
import {
  buildBungalowDescription,
  getAbsoluteUrl,
  getSiteOgImageUrl,
  renderSocialMeta,
} from "../services/siteMeta";
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

function arkhamSvg(size = 12): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 761 703" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M114.48 515.486L380.133 703L471.864 638.119L149.705 410.677L114.48 515.486ZM272.991 465.577L380.133 541.153L471.864 476.272L308.216 360.769L272.991 465.577ZM403.616 557.552L495.347 622.433L761 434.919L725.775 330.111L403.616 557.552ZM402.882 395.705L494.613 460.586L601.755 384.297L566.53 279.489C567.264 279.489 402.882 395.705 402.882 395.705ZM199.607 262.377L158.511 385.01L250.242 449.178L312.619 262.377H199.607ZM101.271 131.189L0 434.919L91.731 499.8L214.284 131.902L101.271 131.189ZM242.904 131.189L207.679 235.997H410.221L374.996 131.189H242.904ZM403.616 131.189L466.727 317.99L558.458 253.108L517.363 130.476C517.363 131.189 403.616 131.189 403.616 131.189ZM145.302 0.712982L110.077 105.521H508.556L473.332 0L145.302 0.712982ZM614.964 0H501.952L625.238 367.899L716.969 303.017L614.964 0Z" fill="currentColor"/></svg>`;
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
    return `<svg class="chain-icon" width="${size}" height="${size}" viewBox="0 0 249 249" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M0 19.671C0 12.9332 0 9.56425 1.26956 6.97276C2.48511 4.49151 4.49151 2.48511 6.97276 1.26956C9.56425 0 12.9332 0 19.671 0H229.329C236.067 0 239.436 0 242.027 1.26956C244.508 2.48511 246.515 4.49151 247.73 6.97276C249 9.56425 249 12.9332 249 19.671V229.329C249 236.067 249 239.436 247.73 242.027C246.515 244.508 244.508 246.515 242.027 247.73C239.436 249 236.067 249 229.329 249H19.671C12.9332 249 9.56425 249 6.97276 247.73C4.49151 246.515 2.48511 244.508 1.26956 242.027C0 239.436 0 236.067 0 229.329V19.671Z" fill="#0000FF"/></svg>`;
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
      Base USDC (EVM Wallet)
    </button>
    <button class="wallet-choice-btn pay-solana-btn">
      <span class="wallet-choice-icon">&#x2600;</span>
      Solana USDC (Phantom)
    </button>
  </div>`;
}

export function renderBungalow(data: BungalowPageData): string {
  const b = data.bungalow;
  const name = b?.name ?? data.fallbackName ?? "Unknown Token";
  const symbol = b?.symbol ?? data.fallbackSymbol ?? "";
  const imageUrl = b?.image_url ?? data.fallbackImage ?? null;
  const isClaimed = b?.is_claimed ?? false;
  const tokenLabel = symbol ? `${name} ($${symbol})` : name;
  const pageDescription = buildBungalowDescription(name, symbol);
  const pageTitle = `${tokenLabel} | Jungle Bay Island`;
  const canonicalUrl = getAbsoluteUrl(`/${data.chain}/${data.tokenAddress}`);
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
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ctext y='52' font-size='52'%3E%F0%9F%8F%9D%EF%B8%8F%3C/text%3E%3C/svg%3E" />
  <title>${esc(pageTitle)}</title>
  ${renderSocialMeta({
    title: pageTitle,
    description: pageDescription,
    url: canonicalUrl,
    imageAlt: `${tokenLabel} on Jungle Bay Island`,
  })}
  ${renderMiniappEmbed({
    imageUrl: getSiteOgImageUrl(),
    buttonTitle: symbol ? `View $${symbol}` : "View Token",
    launchUrl: canonicalUrl,
  })}
  <style>${BUNGALOW_CSS}</style>
  <script>window.__DATA__ = ${escJson(JSON.stringify(clientData))};</script>
</head>
<body>
  <div class="shell">
    <!-- Top bar -->
    <header class="topbar">
      <a href="/" class="topbar-logo"><img src="/logo.svg" alt="Memetics" style="width:20px;height:20px" /></a>
      ${imageUrl ? `<img class="topbar-token-img" src="${esc(imageUrl)}" alt="" />` : ""}
      ${symbol ? `<span class="topbar-token-ticker">$${esc(symbol)}</span>` : ""}
      <span class="topbar-ca" id="copy-ca" title="Click to copy">${shortAddr(data.tokenAddress)}</span>
      <span class="topbar-chain">${chainSvg(data.chain)}</span>
      <div class="topbar-right">
        <button id="share-btn" class="topbar-icon-btn" title="Share"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg></button>
        ${renderTopbarAuth()}
      </div>
    </header>

    <!-- Main content -->
    <main class="tab-content">
      <div class="tab-panel active" id="panel-holders">
        <div id="holder-chart-wrap" class="holder-chart-wrap">
          <div id="holder-chart-skeleton" class="holder-chart-skeleton">
            <div class="skeleton-bar" style="width:80%"></div>
            <div class="skeleton-bar" style="width:55%"></div>
            <div class="skeleton-bar" style="width:70%"></div>
            <div class="skeleton-bar" style="width:40%"></div>
            <div class="skeleton-bar" style="width:90%"></div>
          </div>
          <canvas id="holder-chart-canvas"></canvas>
          <div id="holder-chart-legend" class="holder-chart-legend">
            <button class="holder-chart-search-btn" id="holder-search-btn" title="Search wallet">&#x1F50D; </button>
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
      const arkham = `<a class="arkham-holder-link" href="https://intel.arkm.com/explorer/address/${esc(h.wallet)}" target="_blank" rel="noopener" title="View on Arkham">${arkhamSvg(12)}</a>`;

      return `<tr class="holder-row" data-wallet="${esc(h.wallet)}">
      <td class="rank">${i + 1}</td>
      <td><a class="holder-link" href="/wallet/${esc(h.wallet)}">${identity}</a>${arkham}</td>
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
