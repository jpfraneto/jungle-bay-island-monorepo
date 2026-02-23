import { COLORS, USER_PAGE_CSS } from "./styles";
import { renderMiniappSdk } from "./auth-ui";
import type { SessionUser } from "../services/session";

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

interface ProfilePageData {
  session: SessionUser;
  wallets: Array<{ wallet: string; wallet_kind: string; linked_at: string }>;
}

const PROFILE_EXTRA_CSS = `
  .wallet-list { margin-bottom: 24px; }
  .wallet-item {
    display: flex; align-items: center; gap: 10px;
    background: ${COLORS.surface}; border: 1px solid ${COLORS.border};
    border-radius: 6px; padding: 10px 14px; margin-bottom: 6px;
  }
  .wallet-item .kind {
    font-size: 9px; text-transform: uppercase; letter-spacing: 1px;
    background: ${COLORS.bg}; color: ${COLORS.textMuted};
    padding: 2px 6px; border-radius: 3px; border: 1px solid ${COLORS.border};
  }
  .wallet-item .addr { flex: 1; font-size: 13px; color: ${COLORS.text}; }
  .wallet-item .unlink-btn {
    background: none; border: 1px solid ${COLORS.border};
    color: ${COLORS.red}; padding: 3px 10px; border-radius: 4px;
    font-size: 11px; cursor: pointer; font-family: inherit;
  }
  .wallet-item .unlink-btn:hover { border-color: ${COLORS.red}; }

  .connect-section {
    display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 24px;
  }
  .connect-btn {
    display: inline-flex; align-items: center; gap: 6px;
    background: ${COLORS.surface}; color: ${COLORS.text};
    border: 1px solid ${COLORS.border}; padding: 10px 18px;
    border-radius: 6px; font-size: 13px; font-weight: 500;
    cursor: pointer; font-family: inherit;
    transition: border-color 0.15s;
  }
  .connect-btn:hover { border-color: ${COLORS.accent}; color: ${COLORS.accent}; }
  .connect-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .status-msg {
    font-size: 12px; margin-top: 8px; min-height: 20px;
  }
  .status-msg.error { color: ${COLORS.red}; }
  .status-msg.success { color: ${COLORS.green}; }
`;

export function renderProfilePage(data: ProfilePageData): string {
  const { session, wallets } = data;

  const walletItems = wallets
    .map(
      (w) => `
    <div class="wallet-item" data-wallet="${esc(w.wallet)}">
      <span class="kind">${w.wallet_kind}</span>
      <span class="addr">${shortAddr(w.wallet)}</span>
      <a href="/wallet/${esc(w.wallet)}" style="color:${COLORS.accent};font-size:12px">view</a>
      <button class="unlink-btn" data-unlink="${esc(w.wallet)}">unlink</button>
    </div>
  `,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>@${esc(session.x_username)} — Profile — Memetics</title>
  <style>${USER_PAGE_CSS}${PROFILE_EXTRA_CSS}</style>
</head>
<body>
  <header class="topbar">
    <a href="/" class="topbar-logo"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 20V4l5 8 4-6 4 6 5-8v16" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></a>
    <div style="margin-left:auto;display:flex;align-items:center;gap:8px">
      <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:${COLORS.text}">
        ${session.x_pfp ? `<img src="${esc(session.x_pfp)}" alt="" style="width:22px;height:22px;border-radius:50%;border:1px solid ${COLORS.border}" />` : ""}
        <span>@${esc(session.x_username)}</span>
      </div>
      <a href="/auth/logout?return=/profile" style="color:${COLORS.textMuted};font-size:11px">logout</a>
    </div>
  </header>

  <div class="wrap">
    <div class="user-header">
      ${session.x_pfp ? `<img class="user-pfp" src="${esc(session.x_pfp)}" alt="" />` : ""}
      <div class="user-info">
        <div class="user-name">${esc(session.x_name)}</div>
        <div class="user-wallet-line">
          <span>@${esc(session.x_username)}</span>
        </div>
      </div>
    </div>

    <h3 class="section-title">Connected Wallets</h3>
    <div class="wallet-list" id="wallet-list">
      ${walletItems || '<p class="empty-state">No wallets connected yet.</p>'}
    </div>

    <h3 class="section-title">Connect a Wallet</h3>
    <div class="connect-section">
      <button class="connect-btn" id="connect-evm">Connect EVM Wallet</button>
      <button class="connect-btn" id="connect-solana">Connect Solana Wallet</button>
    </div>
    <div class="status-msg" id="connect-status"></div>
  </div>

  <a href="https://x.com/jpfraneto" target="_blank" rel="noopener" class="beta-banner">this app is in BETA. contact @jpfraneto for support</a>

  <script>
  (function() {
    var statusEl = document.getElementById('connect-status');
    function showStatus(msg, type) {
      if (!statusEl) return;
      statusEl.textContent = msg;
      statusEl.className = 'status-msg' + (type ? ' ' + type : '');
    }

    // ── Connect EVM wallet ──
    var evmBtn = document.getElementById('connect-evm');
    if (evmBtn) {
      evmBtn.addEventListener('click', async function() {
        if (!window.ethereum) {
          showStatus('No EVM wallet detected. Install MetaMask.', 'error');
          return;
        }
        evmBtn.disabled = true;
        showStatus('Connecting wallet...', '');
        try {
          var accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
          if (!accounts || !accounts[0]) throw new Error('No accounts');
          var wallet = accounts[0];

          showStatus('Getting nonce...', '');
          var nonceResp = await fetch('/api/wallets/nonce');
          var nonceData = await nonceResp.json();
          if (!nonceData.nonce) throw new Error('Failed to get nonce');

          var message = 'Link wallet ' + wallet + ' to @${esc(session.x_username)}' + ' on Memetics.\\nNonce: ' + nonceData.nonce;

          showStatus('Sign the message in your wallet...', '');
          var signature = await window.ethereum.request({
            method: 'personal_sign',
            params: [message, wallet],
          });

          showStatus('Verifying...', '');
          var resp = await fetch('/api/wallets/link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              wallet: wallet,
              wallet_kind: 'evm',
              signature: signature,
              nonce: nonceData.nonce,
            }),
          });
          var result = await resp.json();
          if (resp.ok && result.ok) {
            showStatus('EVM wallet linked! Reloading...', 'success');
            setTimeout(function() { location.reload(); }, 1000);
          } else {
            showStatus(result.error || 'Failed to link wallet', 'error');
          }
        } catch(err) {
          var msg = err.message || 'Unknown error';
          if (msg.includes('User denied') || msg.includes('rejected')) {
            showStatus('Cancelled.', 'error');
          } else {
            showStatus('Error: ' + msg, 'error');
          }
        }
        evmBtn.disabled = false;
      });
    }

    // ── Connect Solana wallet ──
    var solBtn = document.getElementById('connect-solana');
    if (solBtn) {
      solBtn.addEventListener('click', async function() {
        var phantom = window.phantom && window.phantom.solana;
        var solflare = window.solflare;
        var provider = (phantom && phantom.isPhantom) ? phantom : solflare;
        if (!provider) {
          showStatus('No Solana wallet detected. Install Phantom.', 'error');
          return;
        }
        solBtn.disabled = true;
        showStatus('Connecting Solana wallet...', '');
        try {
          var resp = await provider.connect();
          var wallet = resp.publicKey.toString();

          showStatus('Getting nonce...', '');
          var nonceResp = await fetch('/api/wallets/nonce');
          var nonceData = await nonceResp.json();
          if (!nonceData.nonce) throw new Error('Failed to get nonce');

          var message = 'Link wallet ' + wallet + ' to @${esc(session.x_username)}' + ' on Memetics.\\nNonce: ' + nonceData.nonce;

          showStatus('Sign the message in your wallet...', '');
          var encodedMessage = new TextEncoder().encode(message);
          var signed = await provider.signMessage(encodedMessage, 'utf8');
          // Phantom returns { signature: Uint8Array }, Solflare may differ
          var sigBytes = signed.signature || signed;
          var sigBase64 = btoa(String.fromCharCode.apply(null, sigBytes));

          showStatus('Verifying...', '');
          var linkResp = await fetch('/api/wallets/link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              wallet: wallet,
              wallet_kind: 'solana',
              signature: sigBase64,
              nonce: nonceData.nonce,
            }),
          });
          var result = await linkResp.json();
          if (linkResp.ok && result.ok) {
            showStatus('Solana wallet linked! Reloading...', 'success');
            setTimeout(function() { location.reload(); }, 1000);
          } else {
            showStatus(result.error || 'Failed to link wallet', 'error');
          }
        } catch(err) {
          var msg = err.message || 'Unknown error';
          if (msg.includes('User denied') || msg.includes('rejected') || msg.includes('User rejected')) {
            showStatus('Cancelled.', 'error');
          } else {
            showStatus('Error: ' + msg, 'error');
          }
        }
        solBtn.disabled = false;
      });
    }

    // ── Unlink wallet ──
    document.addEventListener('click', async function(e) {
      var btn = e.target.closest('.unlink-btn');
      if (!btn) return;
      var wallet = btn.getAttribute('data-unlink');
      if (!wallet || !confirm('Unlink ' + wallet.slice(0,8) + '...?')) return;
      btn.disabled = true;
      try {
        var resp = await fetch('/api/wallets/' + encodeURIComponent(wallet), { method: 'DELETE' });
        if (resp.ok) {
          btn.closest('.wallet-item').remove();
          showStatus('Wallet unlinked.', 'success');
        } else {
          showStatus('Failed to unlink.', 'error');
        }
      } catch(err) {
        showStatus('Error: ' + err.message, 'error');
      }
      btn.disabled = false;
    });
  })();
  </script>
  ${renderMiniappSdk()}
</body>
</html>`;
}
