import { COLORS, RESET } from "./styles";
import { renderTopbarAuth } from './auth-ui';
import type { SessionUser } from '../services/session';

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
    .tagline { color: ${COLORS.textMuted}; font-size: 13px; margin-bottom: 48px; }
    .form-group { display: flex; gap: 8px; margin-bottom: 12px; }
    input[type="text"] {
      flex: 1; min-width: 0;
      background: ${COLORS.surface};
      border: 1px solid ${COLORS.border};
      color: ${COLORS.text};
      padding: 12px 14px;
      font-size: 16px;
      font-family: inherit;
      border-radius: 6px;
      outline: none;
      -webkit-appearance: none;
    }
    input[type="text"]:focus { border-color: ${COLORS.accent}; }
    input[type="text"]::placeholder { color: ${COLORS.textMuted}; }
    button {
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
    }
    button:hover { opacity: 0.9; }
    .hint { color: ${COLORS.textMuted}; font-size: 11px; }
    .footer { margin-top: 80px; color: ${COLORS.textMuted}; font-size: 11px; }
    .footer a { color: ${COLORS.accentDim}; }
    .error-banner {
      background: ${COLORS.surface}; border-bottom: 1px solid ${COLORS.border};
      padding: 12px 16px; text-align: center;
      color: ${COLORS.red}; font-size: 14px; font-weight: 600;
      letter-spacing: 1px;
    }
`;

export function renderLanding(session?: SessionUser | null): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Memetics — the home for your token</title>
  <meta name="description" content="The home for your token. Claim your bungalow." />
  <meta property="og:title" content="Memetics — the home for your token" />
  <meta property="og:description" content="The home for your token. Claim your bungalow." />
  <meta property="og:type" content="website" />
  <style>${LANDING_CSS}</style>
</head>
<body>
  <header class="topbar">
    <a href="/" class="topbar-logo">MEMETICS</a>
    <div class="topbar-right">
      ${renderTopbarAuth(session ?? null, '/')}
    </div>
  </header>

  <div class="wrap">
    <h1>MEMETICS</h1>
    <p class="tagline">the home for your token</p>

    <form id="go-form">
      <div class="form-group">
        <input type="text" id="ca-input" placeholder="paste contract address" autocomplete="off" spellcheck="false" />
        <button type="submit">GO</button>
      </div>
      <p class="hint">Base &amp; Solana tokens supported</p>
    </form>

    <div class="footer">
      powered by <a href="${process.env.SERVER_URL || "https://memetics.lat"}/base/0x3313338fe4bb2a166b81483bfcb2d4a6a1ebba8d">jungle bay memes</a>
    </div>
  </div>

  <script>
    document.getElementById('go-form').addEventListener('submit', function(e) {
      e.preventDefault();
      var ca = document.getElementById('ca-input').value.trim();
      if (!ca) return;
      var isSolana = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ca);
      var chain = isSolana ? 'solana' : 'base';
      window.location.href = '/' + chain + '/' + ca;
    });
  </script>
</body>
</html>`;
}

export function renderInvalidToken(tokenAddress: string, chain: string, session?: SessionUser | null): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Not a valid token — Memetics</title>
  <style>${LANDING_CSS}</style>
</head>
<body>
  <header class="topbar">
    <a href="/" class="topbar-logo">MEMETICS</a>
    <div class="topbar-right">
      ${renderTopbarAuth(session ?? null, '/')}
    </div>
  </header>

  <div class="error-banner">NOT A VALID TOKEN</div>

  <div class="wrap">
    <h1>MEMETICS</h1>
    <p class="tagline">We couldn't find a token at that address on ${chain === 'solana' ? 'Solana' : chain === 'base' ? 'Base' : 'Ethereum'}.</p>
    <p class="hint" style="margin-bottom:32px;word-break:break-all;color:#71717a">${tokenAddress}</p>

    <form id="go-form">
      <div class="form-group">
        <input type="text" id="ca-input" placeholder="paste contract address" autocomplete="off" spellcheck="false" />
        <button type="submit">GO</button>
      </div>
      <p class="hint">Base &amp; Solana tokens supported</p>
    </form>

    <div class="footer">
      powered by <a href="${process.env.SERVER_URL || "https://memetics.lat"}/base/0x3313338fe4bb2a166b81483bfcb2d4a6a1ebba8d">jungle bay memes</a>
    </div>
  </div>

  <script>
    document.getElementById('go-form').addEventListener('submit', function(e) {
      e.preventDefault();
      var ca = document.getElementById('ca-input').value.trim();
      if (!ca) return;
      var isSolana = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ca);
      var chain = isSolana ? 'solana' : 'base';
      window.location.href = '/' + chain + '/' + ca;
    });
  </script>
</body>
</html>`;
}

export function render404(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>404 — Memetics</title>
  <style>${LANDING_CSS}</style>
</head>
<body>
  <header class="topbar">
    <a href="/" class="topbar-logo">MEMETICS</a>
  </header>

  <div class="error-banner">404 NOT FOUND</div>

  <div class="wrap">
    <h1>MEMETICS</h1>
    <p class="tagline">this page doesn't exist</p>

    <form id="go-form">
      <div class="form-group">
        <input type="text" id="ca-input" placeholder="paste contract address" autocomplete="off" spellcheck="false" />
        <button type="submit">GO</button>
      </div>
      <p class="hint">Base &amp; Solana tokens supported</p>
    </form>

    <div class="footer">
      powered by <a href="${process.env.SERVER_URL || "https://memetics.lat"}/base/0x3313338fe4bb2a166b81483bfcb2d4a6a1ebba8d">jungle bay memes</a>
    </div>
  </div>

  <script>
    document.getElementById('go-form').addEventListener('submit', function(e) {
      e.preventDefault();
      var ca = document.getElementById('ca-input').value.trim();
      if (!ca) return;
      var isSolana = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ca);
      var chain = isSolana ? 'solana' : 'base';
      window.location.href = '/' + chain + '/' + ca;
    });
  </script>
</body>
</html>`;
}
