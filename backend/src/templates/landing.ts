import { COLORS, RESET } from "./styles";
import {
  renderTopbarAuth,
  renderMiniappSdk,
  renderMiniappEmbed,
} from "./auth-ui";
import type { RecentScanRow } from "../db/queries";

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

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "1m ago";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const LANDING_CSS = `
    ${RESET}
    .topbar {
      display: flex; align-items: center;
      padding: 0 16px; height: 48px;
      border-bottom: 1px solid ${COLORS.border};
      background: ${COLORS.surface};
    }
    .topbar-logo {
      color: ${COLORS.accent}; font-weight: 700; font-size: 13px;
      letter-spacing: 1.5px;
    }
    .topbar-logo:hover { text-decoration: none; }
    .topbar-right {
      margin-left: auto; display: flex; align-items: center;
    }
    #auth-root { display: flex; align-items: center; }
    .auth-btn {
      background: ${COLORS.accent}; color: ${COLORS.bg};
      border: none; padding: 5px 14px; border-radius: 4px;
      font-size: 12px; font-weight: 600; font-family: inherit;
      cursor: pointer;
    }
    .auth-btn:hover { opacity: 0.9; }
    .wrap { max-width: 480px; margin: 0 auto; padding: 60px 20px; text-align: center; }
    @media (max-width: 480px) { .wrap { padding: 40px 16px; } }
    h1 { font-size: 28px; font-weight: 700; color: ${COLORS.accent}; margin-bottom: 8px; letter-spacing: 2px; }
    .tagline { color: ${COLORS.textMuted}; font-size: 13px; margin-bottom: 8px; }
    .form-group { display: flex; gap: 8px; margin-bottom: 8px; }
    input[type="text"] {
      flex: 1; min-width: 0;
      background: ${COLORS.surface};
      border: 1px solid ${COLORS.border};
      color: ${COLORS.text};
      padding: 12px 14px;
      font-size: 13px;
      font-family: inherit;
      border-radius: 6px;
      outline: none;
      -webkit-appearance: none;
    }
    input[type="text"]:focus { border-color: ${COLORS.accent}; }
    input[type="text"]::placeholder { color: ${COLORS.textMuted}; }
    .paste-btn {
      background: ${COLORS.accent};
      color: ${COLORS.bg};
      border: none;
      padding: 12px 20px;
      font-size: 13px;
      font-weight: 600;
      font-family: inherit;
      border-radius: 6px;
      cursor: pointer;
      white-space: nowrap;
      display: flex; align-items: center; gap: 6px;
      transition: opacity 0.15s;
    }
    .paste-btn:hover { opacity: 0.9; }
    .paste-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .paste-btn svg { flex-shrink: 0; }
    .hint { color: ${COLORS.textMuted}; font-size: 11px; }
    .status-msg {
      font-size: 12px; min-height: 0; margin: 0; padding: 0;
      transition: color 0.15s;
    }
    .status-msg.error { color: ${COLORS.red}; }
    .status-msg.checking { color: ${COLORS.textMuted}; }
    .status-msg.success { color: ${COLORS.green}; }
    .footer { margin-top: 8px; color: ${COLORS.textMuted}; font-size: 11px; }
    .footer a { color: ${COLORS.accentDim}; }
    .feed { margin-top: 32px; text-align: left; }
    .feed-item {
      display: flex; align-items: baseline; gap: 4px;
      font-size: 12px; color: ${COLORS.textMuted};
      padding: 6px 0; border-bottom: 1px solid ${COLORS.border};
      line-height: 1.5;
    }
    .feed-item a { color: ${COLORS.accent}; }
    .feed-item .feed-time { margin-left: auto; flex-shrink: 0; color: ${COLORS.textMuted}; opacity: 0.6; white-space: nowrap; }
    .feed-ca { cursor: pointer; transition: color 0.15s; }
    .feed-ca:hover { color: ${COLORS.accent}; }
    .feed-ca.copied { color: ${COLORS.green}; }
    .error-banner {
      background: ${COLORS.surface}; border-bottom: 1px solid ${COLORS.border};
      padding: 12px 16px; text-align: center;
      color: ${COLORS.red}; font-size: 14px; font-weight: 600;
      letter-spacing: 1px;
    }
    .beta-banner {
      position: fixed; bottom: 0; left: 0; right: 0;
      display: flex; align-items: center; justify-content: center;
      height: 32px; background: ${COLORS.surface};
      border-top: 1px solid ${COLORS.border};
      color: ${COLORS.textMuted}; font-size: 11px;
      text-decoration: none; letter-spacing: 0.5px;
      z-index: 100; transition: color 0.15s;
    }
    .beta-banner:hover { color: ${COLORS.accent}; text-decoration: none; }
`;

const PASTE_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M9 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2h-2"/></svg>`;

const PASTE_SCRIPT = `
<script>
(function() {
  var EVM_RE = /^0x[0-9a-fA-F]{40}$/;
  var SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

  var input = document.getElementById('ca-input');
  var pasteBtn = document.getElementById('paste-btn');
  var statusEl = document.getElementById('status-msg');

  function setStatus(msg, type) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = 'status-msg' + (type ? ' ' + type : '');
  }

  function detectChain(addr) {
    if (EVM_RE.test(addr)) return 'base';
    if (SOL_RE.test(addr)) return 'solana';
    return null;
  }

  async function validateAndGo(addr) {
    var chain = detectChain(addr);
    if (!chain) {
      setStatus('Not a valid contract address', 'error');
      return;
    }

    input.value = addr;
    setStatus('Checking token...', 'checking');
    pasteBtn.disabled = true;

    try {
      var resp = await fetch('https://api.dexscreener.com/latest/dex/tokens/' + addr);
      var data = await resp.json();

      if (data.pairs && data.pairs.length > 0) {
        // Valid token — detect chain from DexScreener data if possible
        var pair = data.pairs[0];
        if (pair.chainId === 'solana') chain = 'solana';
        else if (pair.chainId === 'base') chain = 'base';
        else if (pair.chainId === 'ethereum') chain = 'ethereum';

        setStatus('Token found! Redirecting...', 'success');
        setTimeout(function() {
          window.location.href = '/' + chain + '/' + addr;
        }, 300);
        return;
      }

      // DexScreener didn't find it — try going anyway (might be unscanned)
      setStatus('Token not listed on DexScreener. Loading anyway...', 'checking');
      setTimeout(function() {
        window.location.href = '/' + chain + '/' + addr;
      }, 800);
    } catch(e) {
      // API failed — go anyway with regex-detected chain
      setStatus('Could not verify token. Loading...', 'checking');
      setTimeout(function() {
        window.location.href = '/' + chain + '/' + addr;
      }, 500);
    }
  }

  if (pasteBtn) {
    pasteBtn.addEventListener('click', async function() {
      setStatus('', '');
      try {
        var text = await navigator.clipboard.readText();
        var addr = (text || '').trim();
        if (!addr) {
          setStatus('Clipboard is empty', 'error');
          return;
        }
        await validateAndGo(addr);
      } catch(e) {
        // Clipboard API denied — fallback: focus input so user can Ctrl+V
        setStatus('Clipboard access denied. Paste manually below.', 'error');
        input.focus();
      }
    });
  }

  // Also handle manual paste (Ctrl+V / Cmd+V) into the input
  if (input) {
    input.addEventListener('paste', function(e) {
      setTimeout(function() {
        var addr = input.value.trim();
        if (addr) validateAndGo(addr);
      }, 50);
    });
  }
  // ── Feed: click CA to copy ──
  document.addEventListener('click', function(e) {
    var el = e.target;
    if (!el || !el.classList || !el.classList.contains('feed-ca')) return;
    var ca = el.getAttribute('data-ca');
    if (!ca) return;
    navigator.clipboard.writeText(ca).then(function() {
      var orig = el.textContent;
      el.textContent = 'copied!';
      el.classList.add('copied');
      setTimeout(function() {
        el.textContent = orig;
        el.classList.remove('copied');
      }, 1200);
    });
  });
})();
</script>`;

function renderForm(): string {
  return `<div class="form-group">
        <input type="text" id="ca-input" placeholder="base or solana CA" autocomplete="off" spellcheck="false" readonly />
        <button type="button" class="paste-btn" id="paste-btn">${PASTE_ICON} PASTE</button>
      </div>
      <div class="status-msg" id="status-msg"></div>`;
}

function renderFeed(scans: RecentScanRow[]): string {
  if (scans.length === 0) return "";
  const items = scans
    .map((s) => {
      const who = `<a href="/wallet/${esc(s.requested_by)}">${shortAddr(s.requested_by)}</a>`;
      const sym = s.symbol ? `$${esc(s.symbol)}` : shortAddr(s.token_address);
      const token = `<a href="/${esc(s.chain)}/${esc(s.token_address)}">${sym}</a>`;
      const ca = shortAddr(s.token_address);
      const chain =
        s.chain === "solana"
          ? "solana"
          : s.chain === "base"
            ? "base"
            : "ethereum";
      const ago = timeAgo(s.completed_at);
      return `<div class="feed-item"><span>${who} claimed ${token} <span class="feed-ca" data-ca="${esc(s.token_address)}">${ca}</span></span><span class="feed-time">${ago}</span></div>`;
    })
    .join("");
  return `<div class="feed">${items}</div>`;
}

export function renderLanding(recentScans: RecentScanRow[] = []): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Memetics \u2014 the home for your token</title>
  <meta name="description" content="The home for your token. Claim your bungalow." />
  <meta property="og:title" content="Memetics \u2014 the home for your token" />
  <meta property="og:description" content="The home for your token. Claim your bungalow." />
  <meta property="og:type" content="website" />
  ${renderMiniappEmbed()}
  <style>${LANDING_CSS}</style>
</head>
<body>
  <header class="topbar">
    <a href="/" class="topbar-logo"><img src="/logo.svg" alt="Memetics" style="width:20px;height:20px" /></a>
    <div class="topbar-right">
      ${renderTopbarAuth()}
    </div>
  </header>

  <div class="wrap">
    <h1>MEMETICS</h1>
    <p class="tagline">the home for your token</p>
    ${renderForm()}
    <div class="footer">
      powered by <a href="${process.env.SERVER_URL || "https://memetics.lat"}/base/0x3313338fe4bb2a166b81483bfcb2d4a6a1ebba8d">jungle bay memes</a>
    </div>
    ${renderFeed(recentScans)}
  </div>
  <a href="https://x.com/jpfraneto" target="_blank" rel="noopener" class="beta-banner">this app is in BETA. contact @jpfraneto for support</a>
  ${PASTE_SCRIPT}
  ${renderMiniappSdk()}
</body>
</html>`;
}

export function renderInvalidToken(
  tokenAddress: string,
  chain: string,
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Not a valid token \u2014 Memetics</title>
  <style>${LANDING_CSS}</style>
</head>
<body>
  <header class="topbar">
    <a href="/" class="topbar-logo"><img src="/logo.svg" alt="Memetics" style="width:20px;height:20px" /></a>
    <div class="topbar-right">
      ${renderTopbarAuth()}
    </div>
  </header>

  <div class="error-banner">NOT A VALID TOKEN</div>

  <div class="wrap">
    <h1>MEMETICS</h1>
    <p class="tagline">We couldn't find a token at that address on ${chain === "solana" ? "Solana" : chain === "base" ? "Base" : "Ethereum"}.</p>
    <p class="hint" style="margin-bottom:32px;word-break:break-all;color:#71717a">${tokenAddress}</p>
    ${renderForm()}
    <div class="footer">
      powered by <a href="${process.env.SERVER_URL || "https://memetics.lat"}/base/0x3313338fe4bb2a166b81483bfcb2d4a6a1ebba8d">jungle bay memes</a>
    </div>
  </div>
  <a href="https://x.com/jpfraneto" target="_blank" rel="noopener" class="beta-banner">this app is in BETA. contact @jpfraneto for support</a>
  ${PASTE_SCRIPT}
  ${renderMiniappSdk()}
</body>
</html>`;
}

export function renderLoginPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Login \u2014 Memetics</title>
  <style>${LANDING_CSS}
    .login-card {
      background: ${COLORS.surface}; border: 1px solid ${COLORS.border};
      border-radius: 8px; padding: 32px 24px; margin-top: 8px;
      text-align: left;
    }
    .login-card h2 {
      font-size: 16px; font-weight: 700; color: ${COLORS.text};
      margin-bottom: 16px; text-align: center;
    }
    .login-step {
      display: flex; gap: 12px; margin-bottom: 16px;
      font-size: 13px; color: ${COLORS.text}; line-height: 1.6;
    }
    .login-step-num {
      flex-shrink: 0; width: 24px; height: 24px;
      display: flex; align-items: center; justify-content: center;
      background: ${COLORS.accent}; color: ${COLORS.bg};
      border-radius: 50%; font-size: 12px; font-weight: 700;
      margin-top: 2px;
    }
    .login-wallets {
      display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px;
    }
    .login-wallet-pill {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 6px 14px; border-radius: 20px;
      background: ${COLORS.bg}; border: 1px solid ${COLORS.border};
      color: ${COLORS.textMuted}; font-size: 12px; font-weight: 500;
    }
    .login-divider {
      text-align: center; color: ${COLORS.textMuted}; font-size: 11px;
      margin: 20px 0; position: relative;
    }
    .login-divider::before, .login-divider::after {
      content: ''; position: absolute; top: 50%;
      width: calc(50% - 20px); height: 1px;
      background: ${COLORS.border};
    }
    .login-divider::before { left: 0; }
    .login-divider::after { right: 0; }
    .login-desktop {
      font-size: 13px; color: ${COLORS.textMuted}; text-align: center;
      line-height: 1.6;
    }
    .login-desktop strong { color: ${COLORS.text}; }
    .login-copy-link {
      font-weight: 600;
      color: ${COLORS.accent};
      cursor: pointer;
      text-decoration: underline;
    }
    .login-copy-link:hover { opacity: 0.9; }
    .login-copy-msg {
      margin-left: 6px;
      font-size: 11px;
      color: ${COLORS.green};
    }
  </style>
</head>
<body>
  <header class="topbar">
    <a href="/" class="topbar-logo"><img src="/logo.svg" alt="Memetics" style="width:20px;height:20px" /></a>
  </header>

  <div class="wrap">

    <div class="login-card">
      <h2>How to log in</h2>

      <div class="login-step">
        <span class="login-step-num">1</span>
        <div>
          Open
          <a href="https://memetics.lat" id="memetics-login-link" class="login-copy-link">memetics.lat</a>
          in your wallet's built-in browser. Your wallet connects automatically \u2014 no popups, no seed phrases.
          <span id="memetics-login-msg" class="login-copy-msg"></span>
        </div>
      </div>

      <div class="login-step" style="margin-top:20px">
        <span class="login-step-num">2</span>
        <div>Browse any bungalow and your wallet address will appear in the top bar. That's it \u2014 you're logged in.</div>
      </div>

      <div class="login-divider">or</div>

      <div class="login-desktop">
        On <strong>desktop</strong>, install a browser extension like MetaMask or Phantom and visit any bungalow. Your connected wallet is your identity.
      </div>
    </div>

    <div class="footer" style="margin-top:16px">
      <a href="/">\u2190 back to home</a>
    </div>
  </div>
  <a href="https://x.com/jpfraneto" target="_blank" rel="noopener" class="beta-banner">this app is in BETA. contact @jpfraneto for support</a>
  <script>
  (function() {
    var link = document.getElementById('memetics-login-link');
    var msg = document.getElementById('memetics-login-msg');
    if (!link) return;
    link.addEventListener('click', function(e) {
      e.preventDefault();
      var url = 'https://memetics.lat';
      if (!navigator.clipboard || !navigator.clipboard.writeText) {
        if (msg) {
          msg.textContent = 'copied';
          setTimeout(function() { msg.textContent = ''; }, 1200);
        }
        return;
      }
      navigator.clipboard.writeText(url).then(function() {
        if (!msg) return;
        msg.textContent = 'copied';
        setTimeout(function() { msg.textContent = ''; }, 1200);
      }).catch(function() {
        if (msg) {
          msg.textContent = 'copied';
          setTimeout(function() { msg.textContent = ''; }, 1200);
        }
      });
    });
  })();
  </script>
  ${renderMiniappSdk()}
</body>
</html>`;
}

export function render404(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>404 \u2014 Memetics</title>
  <style>${LANDING_CSS}</style>
</head>
<body>
  <header class="topbar">
    <a href="/" class="topbar-logo"><img src="/logo.svg" alt="Memetics" style="width:20px;height:20px" /></a>
  </header>

  <div class="error-banner">404 NOT FOUND</div>

  <div class="wrap">
    <h1>MEMETICS</h1>
    <p class="tagline">this page doesn't exist</p>
    ${renderForm()}
    <div class="footer">
      powered by <a href="${process.env.SERVER_URL || "https://memetics.lat"}/base/0x3313338fe4bb2a166b81483bfcb2d4a6a1ebba8d">jungle bay memes</a>
    </div>
  </div>
  <a href="https://x.com/jpfraneto" target="_blank" rel="noopener" class="beta-banner">this app is in BETA. contact @jpfraneto for support</a>
  ${PASTE_SCRIPT}
  ${renderMiniappSdk()}
</body>
</html>`;
}
