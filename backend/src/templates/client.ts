// Client-side JavaScript for bungalow pages (rendered as inline <script>)

export function renderClientScript(): string {
  return `<script>
(function() {
  var D = window.__DATA__ || {};

  // ── Tab switching ──
  var tabs = document.querySelectorAll('.tab-btn');
  var panels = document.querySelectorAll('.tab-panel');
  var chartLoaded = false;

  var currentTier = '';

  function switchTab(name, updateUrl) {
    tabs.forEach(function(t) {
      t.classList.toggle('active', t.getAttribute('data-tab') === name);
    });
    panels.forEach(function(p) {
      p.classList.toggle('active', p.id === 'panel-' + name);
    });
    // Lazy-load chart iframe on first visit
    if (name === 'chart' && !chartLoaded && D.dexscreenerUrl) {
      var frame = document.getElementById('chart-frame');
      if (frame) {
        frame.src = D.dexscreenerUrl;
        chartLoaded = true;
      }
    }
    // Save active tab
    try { sessionStorage.setItem('activeTab', name); } catch(e) {}
    // Update URL if requested
    if (updateUrl !== false) {
      var params = new URLSearchParams();
      if (name !== 'home') params.set('tab', name);
      if (currentTier && name === 'holders') params.set('tier', currentTier);
      var qs = params.toString();
      var newUrl = window.location.pathname + (qs ? '?' + qs : '');
      history.replaceState({ tab: name, tier: currentTier }, '', newUrl);
    }
  }

  tabs.forEach(function(tab) {
    tab.addEventListener('click', function(e) {
      e.preventDefault();
      switchTab(this.getAttribute('data-tab'));
    });
  });

  // ── Helper: short address ──
  function shortAddr(addr) {
    if (!addr || addr.length <= 10) return addr || '';
    return addr.slice(0, 6) + '\\u2026' + addr.slice(-4);
  }

  // ── Helper: format heat ──
  function fmtHeat(val) {
    return Number(val).toFixed(1) + '\\u00B0';
  }

  // ── AJAX: fetch and render filtered holders ──
  function fetchHolders(tier) {
    var list = document.getElementById('holders-list');
    var countEl = document.getElementById('holder-count');
    if (!list) return;
    list.innerHTML = '<div class="holders-loading">Loading...</div>';

    var url = '/api/token/' + D.tokenAddress + '/holders?limit=50';
    if (tier) url += '&tier=' + encodeURIComponent(tier);

    fetch(url)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.holders || data.holders.length === 0) {
          list.innerHTML = '<p class="holders-loading">No holders found for this tier.</p>';
          if (countEl) countEl.textContent = '0 holders';
          return;
        }
        if (countEl) countEl.textContent = data.total + ' holder' + (data.total !== 1 ? 's' : '');
        var rows = data.holders.map(function(h, i) {
          var identity = h.farcaster && h.farcaster.username
            ? '<span class="holder-identity">'
              + (h.farcaster.pfp_url ? '<img class="holder-pfp" src="' + h.farcaster.pfp_url + '" alt="" />' : '')
              + '<span class="holder-username">' + h.farcaster.username + '</span></span>'
            : '<span class="holder-wallet">' + shortAddr(h.wallet) + '</span>';
          return '<tr class="holder-row"><td class="rank">' + (i + 1) + '</td>'
            + '<td><a class="holder-link" href="/user/' + h.wallet + '">' + identity + '</a></td>'
            + '<td class="heat">' + fmtHeat(h.heat_degrees) + '</td></tr>';
        }).join('');
        list.innerHTML = '<table class="holders-table">'
          + '<thead><tr><th>#</th><th>Holder</th><th style="text-align:right">Heat</th></tr></thead>'
          + '<tbody>' + rows + '</tbody></table>';
      })
      .catch(function() {
        list.innerHTML = '<p class="holders-loading">Failed to load holders.</p>';
      });
  }

  // ── Tier filter pills ──
  function activateTierFilter(tier) {
    currentTier = tier || '';
    var pills = document.querySelectorAll('.tier-filter-btn');
    pills.forEach(function(btn) {
      btn.classList.toggle('active', btn.getAttribute('data-tier-filter') === currentTier);
    });
    // Highlight matching tier bar
    var bars = document.querySelectorAll('.tier-row');
    bars.forEach(function(row) {
      row.classList.toggle('active', tier && row.getAttribute('data-tier') === tier);
    });
    fetchHolders(currentTier);
  }

  document.addEventListener('click', function(e) {
    var pill = e.target.closest('.tier-filter-btn');
    if (pill) {
      var tier = pill.getAttribute('data-tier-filter');
      switchTab('holders');
      activateTierFilter(tier);
      return;
    }
    var tierRow = e.target.closest('.tier-row[data-tier]');
    if (tierRow) {
      var tier = tierRow.getAttribute('data-tier');
      switchTab('holders');
      activateTierFilter(tier);
      return;
    }
  });

  // ── Popstate (back/forward) ──
  window.addEventListener('popstate', function(e) {
    var state = e.state;
    if (state && state.tab) {
      switchTab(state.tab, false);
      if (state.tier) {
        activateTierFilter(state.tier);
      }
    }
  });

  // ── Restore from URL params on load ──
  (function() {
    var params = new URLSearchParams(window.location.search);
    var tab = params.get('tab');
    var tier = params.get('tier');
    if (tab && document.getElementById('panel-' + tab)) {
      switchTab(tab, false);
      if (tier) {
        activateTierFilter(tier);
      }
    } else {
      // Fallback to sessionStorage
      try {
        var saved = sessionStorage.getItem('activeTab');
        if (saved && document.getElementById('panel-' + saved)) {
          switchTab(saved, false);
        }
      } catch(e) {}
    }
  })();

  // ── Copy contract address ──
  var caBtn = document.getElementById('copy-ca');
  if (caBtn) {
    caBtn.addEventListener('click', function() {
      var ca = D.tokenAddress || '';
      if (!ca) return;
      navigator.clipboard.writeText(ca).then(function() {
        caBtn.classList.add('copied');
        var orig = caBtn.textContent;
        caBtn.textContent = 'Copied!';
        setTimeout(function() {
          caBtn.classList.remove('copied');
          caBtn.textContent = orig;
        }, 1500);
      });
    });
  }

  // ── Heat tier bar chart ──
  var dist = D.heatDistribution;
  if (dist) {
    var total = (dist.elders || 0) + (dist.builders || 0) + (dist.residents || 0) + (dist.observers || 0) + (dist.drifters || 0);
    if (total > 0) {
      var tiers = ['elder', 'builder', 'resident', 'observer', 'drifter'];
      var counts = [dist.elders, dist.builders, dist.residents, dist.observers, dist.drifters];
      tiers.forEach(function(tier, i) {
        var bar = document.getElementById('bar-' + tier);
        if (bar) {
          var pct = Math.round((counts[i] / total) * 100);
          bar.style.width = Math.max(pct, counts[i] > 0 ? 2 : 0) + '%';
        }
        var countEl = document.getElementById('count-' + tier);
        if (countEl) countEl.textContent = counts[i];
      });
      var totalEl = document.getElementById('heat-total');
      if (totalEl) totalEl.textContent = total;
    }
  }

  // ── Recently visited bungalows (localStorage) ──
  function getRecents() {
    try {
      var raw = localStorage.getItem('recentBungalows');
      return raw ? JSON.parse(raw) : [];
    } catch(e) { return []; }
  }

  function saveRecent(chain, ca, name) {
    var recents = getRecents().filter(function(r) { return r.ca !== ca; });
    recents.unshift({ chain: chain, ca: ca, name: name || ca.slice(0,8) });
    if (recents.length > 8) recents = recents.slice(0, 8);
    try { localStorage.setItem('recentBungalows', JSON.stringify(recents)); } catch(e) {}
  }

  function renderRecents() {
    var container = document.getElementById('recents');
    if (!container) return;
    var recents = getRecents();
    if (recents.length === 0) { container.style.display = 'none'; return; }
    container.innerHTML = recents.map(function(r) {
      return '<a class="recent-pill" href="/' + r.chain + '/' + r.ca + '">' + (r.name || r.ca.slice(0,8)) + '</a>';
    }).join('');
  }

  // Save current visit
  if (D.chain && D.tokenAddress) {
    saveRecent(D.chain, D.tokenAddress, D.name);
  }
  renderRecents();

  // ── Activity bar polling ──
  var tickerEl = document.getElementById('activity-ticker');
  var activityInterval = null;

  function renderActivity(events) {
    if (!tickerEl || !events || events.length === 0) return;
    tickerEl.innerHTML = events.slice(0, 10).map(function(ev) {
      if (ev.type === 'scan') {
        return '<span class="evt-scan">\\u25B8 Scan complete: ' + (ev.token_name || ev.token_address.slice(0,8)) + ' (' + (ev.detail || '?') + ' holders)</span>';
      }
      if (ev.type === 'post') {
        var who = ev.username || 'anon';
        return '<span class="evt-post">\\u25B8 ' + who + ' posted on ' + (ev.token_name || ev.token_address.slice(0,8)) + '</span>';
      }
      return '';
    }).join('');
  }

  function pollActivity() {
    fetch('/api/activity?limit=10')
      .then(function(r) { return r.json(); })
      .then(function(data) { renderActivity(data.events); })
      .catch(function() {});
  }

  // Initial load + poll every 15s
  pollActivity();
  activityInterval = setInterval(pollActivity, 15000);

  // ════════════════════════════════════════════════════════
  // ── Payment helpers ──
  // ════════════════════════════════════════════════════════

  var TREASURY = '0xe91B8920Ef5DBf6e1289991F1CE4eeF3671A610E';
  var USDC_ADDR = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  var CLAIM_AMOUNT = 'f4240'; // 1_000_000 in hex (1 USDC, 6 decimals)

  var SOL_TREASURY = 'Grd283VR3E1KQnrdpHkPhAB5BwSGX7Rq5WPdBs416pes';
  var SOL_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  var SOL_RPC = D.solanaRpcUrl || 'https://api.mainnet-beta.solana.com';

  // ── payEvmUsdc: connect wallet → switch to Base → send ERC20 transfer → poll receipt ──
  async function payEvmUsdc() {
    if (!window.ethereum) throw new Error('No EVM wallet detected. Install MetaMask.');

    var accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    if (!accounts || accounts.length === 0) throw new Error('No accounts');
    var from = accounts[0];

    // Switch to Base (chain 8453 = 0x2105)
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x2105' }]
      });
    } catch (switchErr) {
      if (switchErr.code === 4902) {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: '0x2105',
            chainName: 'Base',
            nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
            rpcUrls: ['https://mainnet.base.org'],
            blockExplorerUrls: ['https://basescan.org']
          }]
        });
      } else {
        throw switchErr;
      }
    }

    // Check USDC balance before sending
    try {
      var balData = '0x70a08231' + from.slice(2).toLowerCase().padStart(64, '0');
      var balHex = await window.ethereum.request({
        method: 'eth_call',
        params: [{ to: USDC_ADDR, data: balData }, 'latest']
      });
      var balance = BigInt(balHex);
      if (balance < BigInt('0x' + CLAIM_AMOUNT)) {
        throw new Error('Insufficient USDC balance on Base');
      }
    } catch(e) {
      if (e.message.includes('Insufficient')) throw e;
      // If balance check fails, proceed anyway — wallet will reject if insufficient
    }

    // ERC20 transfer(address,uint256) = 0xa9059cbb + padded address + padded amount
    var transferData = '0xa9059cbb'
      + TREASURY.slice(2).toLowerCase().padStart(64, '0')
      + CLAIM_AMOUNT.padStart(64, '0');

    var txHash = await window.ethereum.request({
      method: 'eth_sendTransaction',
      params: [{
        from: from,
        to: USDC_ADDR,
        data: transferData,
      }]
    });

    // Poll for receipt
    var confirmed = false;
    for (var attempt = 0; attempt < 30; attempt++) {
      await new Promise(function(r) { setTimeout(r, 3000); });
      try {
        var receipt = await window.ethereum.request({
          method: 'eth_getTransactionReceipt',
          params: [txHash]
        });
        if (receipt && receipt.status === '0x1') { confirmed = true; break; }
        if (receipt && receipt.status === '0x0') throw new Error('Transaction reverted');
      } catch(e) {
        if (e.message === 'Transaction reverted') throw e;
      }
    }

    if (!confirmed) throw new Error('Transaction not confirmed after 90s');

    return { proof: txHash, from: from, chain: 'base' };
  }

  // ── paySolanaUsdc: connect Phantom/Solflare → build SPL transfer → sign+send ──
  async function paySolanaUsdc() {
    var provider = (window.phantom && window.phantom.solana) || window.solflare;
    if (!provider) throw new Error('No Solana wallet detected. Install Phantom or Solflare.');

    // Connect
    if (!provider.isConnected) {
      await provider.connect();
    }
    var from = provider.publicKey.toString();

    // Lazy-load Solana libs from CDN
    var [web3Mod, splMod] = await Promise.all([
      import('https://esm.sh/@solana/web3.js@1.95.8'),
      import('https://esm.sh/@solana/spl-token@0.4.9'),
    ]);

    var Connection = web3Mod.Connection;
    var PublicKey = web3Mod.PublicKey;
    var Transaction = web3Mod.Transaction;
    var getAssociatedTokenAddress = splMod.getAssociatedTokenAddress;
    var createTransferInstruction = splMod.createTransferInstruction;
    var createAssociatedTokenAccountInstruction = splMod.createAssociatedTokenAccountInstruction;
    var TOKEN_PROGRAM_ID = splMod.TOKEN_PROGRAM_ID;

    var connection = new Connection(SOL_RPC, 'confirmed');
    var senderPk = new PublicKey(from);
    var treasuryPk = new PublicKey(SOL_TREASURY);
    var usdcMintPk = new PublicKey(SOL_USDC_MINT);

    // Derive ATAs
    var senderAta = await getAssociatedTokenAddress(usdcMintPk, senderPk);
    var treasuryAta = await getAssociatedTokenAddress(usdcMintPk, treasuryPk);

    // Check sender USDC balance
    try {
      var senderBalance = await connection.getTokenAccountBalance(senderAta);
      var senderAmount = BigInt(senderBalance.value.amount);
      if (senderAmount < 1000000n) {
        throw new Error('Insufficient USDC balance on Solana');
      }
    } catch(e) {
      if (e.message.includes('Insufficient')) throw e;
      if (e.message.includes('could not find account')) {
        throw new Error('No USDC token account found. You need USDC on Solana.');
      }
      // Other errors: proceed, wallet will handle it
    }

    // Build transaction
    var tx = new Transaction();

    // Check if treasury ATA exists, create if not
    try {
      await connection.getTokenAccountBalance(treasuryAta);
    } catch(e) {
      // ATA doesn't exist — add create instruction (costs sender ~0.002 SOL rent)
      tx.add(createAssociatedTokenAccountInstruction(
        senderPk,     // payer
        treasuryAta,  // ATA to create
        treasuryPk,   // owner
        usdcMintPk    // mint
      ));
    }

    // Add SPL transfer instruction (1 USDC = 1_000_000 raw units, 6 decimals)
    tx.add(createTransferInstruction(
      senderAta,
      treasuryAta,
      senderPk,
      1000000 // 1 USDC
    ));

    // Get recent blockhash
    var bh = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = bh.blockhash;
    tx.feePayer = senderPk;

    // Sign and send
    var signed = await provider.signAndSendTransaction(tx);
    var signature = signed.signature || signed;

    return { proof: signature, from: from, chain: 'solana' };
  }

  // ── payUsdc: unified wrapper — detects wallets, shows choice if both available ──
  function payUsdc(statusFn) {
    return new Promise(function(resolve, reject) {
      var hasEvm = !!window.ethereum;
      var hasSolana = !!(window.phantom && window.phantom.solana) || !!window.solflare;

      if (!hasEvm && !hasSolana) {
        reject(new Error('No wallet detected. Install MetaMask (Base) or Phantom (Solana).'));
        return;
      }

      // Only one wallet type available — use it directly
      if (hasEvm && !hasSolana) {
        if (statusFn) statusFn('Connecting wallet...');
        payEvmUsdc().then(resolve).catch(reject);
        return;
      }
      if (hasSolana && !hasEvm) {
        if (statusFn) statusFn('Connecting wallet...');
        paySolanaUsdc().then(resolve).catch(reject);
        return;
      }

      // Both available — show wallet choice UI
      var choiceEl = document.getElementById('wallet-choice');
      if (choiceEl) {
        choiceEl.style.display = 'flex';

        var baseBtn = document.getElementById('pay-base-btn');
        var solBtn = document.getElementById('pay-solana-btn');

        function cleanup() {
          choiceEl.style.display = 'none';
          if (baseBtn) baseBtn.onclick = null;
          if (solBtn) solBtn.onclick = null;
        }

        if (baseBtn) {
          baseBtn.onclick = function() {
            cleanup();
            if (statusFn) statusFn('Connecting MetaMask...');
            payEvmUsdc().then(resolve).catch(reject);
          };
        }
        if (solBtn) {
          solBtn.onclick = function() {
            cleanup();
            if (statusFn) statusFn('Connecting Phantom...');
            paySolanaUsdc().then(resolve).catch(reject);
          };
        }
      } else {
        // No choice UI in DOM — default to EVM
        if (statusFn) statusFn('Connecting wallet...');
        payEvmUsdc().then(resolve).catch(reject);
      }
    });
  }

  // ════════════════════════════════════════════════════════
  // ── Scan & Claim (combined for unscanned tokens) ──
  // ════════════════════════════════════════════════════════

  var scanClaimBtn = document.getElementById('scan-claim-btn');
  var scanClaimStatus = document.getElementById('scan-claim-status');

  function showScanClaim(msg, type) {
    if (!scanClaimStatus) return;
    scanClaimStatus.textContent = msg;
    scanClaimStatus.className = 'claim-status' + (type ? ' ' + type : '');
  }

  if (scanClaimBtn) {
    scanClaimBtn.addEventListener('click', async function() {
      scanClaimBtn.disabled = true;
      showScanClaim('', '');

      try {
        var result = await payUsdc(function(msg) {
          scanClaimBtn.textContent = msg;
          showScanClaim(msg, '');
        });

        // Payment confirmed — trigger scan (backend auto-claims)
        scanClaimBtn.textContent = 'Starting scan...';
        showScanClaim('Payment confirmed! Starting scan...', '');

        var scanResp = await fetch('/api/scan/' + D.chain + '/' + D.tokenAddress, {
          method: 'POST',
          headers: {
            'X-Wallet-Address': result.from,
            'X-Payment-Proof': result.proof,
          },
        });

        var scanResult = await scanResp.json();

        if (!scanResp.ok) {
          showScanClaim(scanResult.error || 'Scan request failed', 'error');
          scanClaimBtn.disabled = false;
          scanClaimBtn.textContent = 'Scan & Claim \\u2014 1 USDC';
          return;
        }

        // Poll scan progress
        var scanId = scanResult.scan_id;
        if (scanId) {
          showScanClaim('Scan in progress... This may take a few minutes.', '');
          scanClaimBtn.textContent = 'Scanning...';
          var pollScan = setInterval(async function() {
            try {
              var statusResp = await fetch('/api/scan/' + scanId + '/status');
              var statusData = await statusResp.json();
              if (statusData.status === 'complete') {
                clearInterval(pollScan);
                showScanClaim('Scan complete! ' + (statusData.holders_found || 0) + ' holders found. Reloading...', 'success');
                setTimeout(function() { window.location.reload(); }, 2000);
              } else if (statusData.status === 'failed') {
                clearInterval(pollScan);
                showScanClaim('Scan failed: ' + (statusData.error_message || 'Unknown error'), 'error');
                scanClaimBtn.disabled = false;
                scanClaimBtn.textContent = 'Scan & Claim \\u2014 1 USDC';
              } else {
                var phase = statusData.progress_phase || 'processing';
                var pct = statusData.progress_pct != null ? ' (' + Math.round(statusData.progress_pct) + '%)' : '';
                showScanClaim('Scanning: ' + phase + pct, '');
              }
            } catch(e) {}
          }, 3000);
        } else {
          showScanClaim('Scan started! Reload in a few minutes.', 'success');
        }

      } catch(err) {
        var msg = err.message || 'Unknown error';
        if (msg.includes('User denied') || msg.includes('rejected')) {
          showScanClaim('Transaction cancelled.', 'error');
        } else {
          showScanClaim('Error: ' + msg, 'error');
        }
        scanClaimBtn.disabled = false;
        scanClaimBtn.textContent = 'Scan & Claim \\u2014 1 USDC';
      }
    });
  }

  // ════════════════════════════════════════════════════════
  // ── Claim bungalow (already scanned but unclaimed) ──
  // ════════════════════════════════════════════════════════

  var claimBtn = document.getElementById('claim-btn');
  var claimStatus = document.getElementById('claim-status');

  function showClaim(msg, type) {
    if (!claimStatus) return;
    claimStatus.textContent = msg;
    claimStatus.className = 'claim-status' + (type ? ' ' + type : '');
  }

  if (claimBtn) {
    claimBtn.addEventListener('click', async function() {
      claimBtn.disabled = true;
      showClaim('', '');

      try {
        var result = await payUsdc(function(msg) {
          claimBtn.textContent = msg;
          showClaim(msg, '');
        });

        claimBtn.textContent = 'Claiming bungalow...';
        showClaim('Payment confirmed! Claiming bungalow...', '');

        var resp = await fetch('/api/v1/bungalow', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Payment-Signature': result.proof,
          },
          body: JSON.stringify({
            mint_address: D.tokenAddress,
          }),
        });

        var claimResult = await resp.json();

        if (resp.ok && claimResult.ok) {
          showClaim('Bungalow claimed! Reloading...', 'success');
          setTimeout(function() { window.location.reload(); }, 1500);
        } else {
          showClaim(claimResult.error || 'Claim failed', 'error');
          claimBtn.disabled = false;
          claimBtn.textContent = 'Claim Bungalow \\u2014 1 USDC';
        }
      } catch(err) {
        var msg = err.message || 'Unknown error';
        if (msg.includes('User denied') || msg.includes('rejected')) {
          showClaim('Transaction cancelled.', 'error');
        } else {
          showClaim('Error: ' + msg, 'error');
        }
        claimBtn.disabled = false;
        claimBtn.textContent = 'Claim Bungalow \\u2014 1 USDC';
      }
    });
  }

  // ════════════════════════════════════════════════════════
  // ── Update page (claimed bungalow, paste gist URL + pay) ──
  // ════════════════════════════════════════════════════════

  var updateBtn = document.getElementById('update-btn');
  var updateStatus = document.getElementById('update-status');

  function showUpdate(msg, type) {
    if (!updateStatus) return;
    updateStatus.textContent = msg;
    updateStatus.style.color = type === 'error' ? '#f87171' : type === 'success' ? '#4ade80' : '#71717a';
  }

  if (updateBtn) {
    updateBtn.addEventListener('click', async function() {
      var urlInput = document.getElementById('update-url');
      var htmlUrl = (urlInput ? urlInput.value : '').trim();

      if (!htmlUrl) { showUpdate('Paste the raw gist URL to your HTML file', 'error'); return; }

      updateBtn.disabled = true;
      showUpdate('', '');

      try {
        var result = await payUsdc(function(msg) {
          updateBtn.textContent = msg;
          showUpdate(msg, '');
        });

        updateBtn.textContent = 'Deploying...';
        showUpdate('Payment confirmed! Fetching HTML and deploying...', '');

        var resp = await fetch('/api/v1/bungalow', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Payment-Signature': result.proof,
          },
          body: JSON.stringify({
            mint_address: D.tokenAddress,
            html_url: htmlUrl,
            title: D.name,
          }),
        });

        var updateResult = await resp.json();

        if (resp.ok && updateResult.ok) {
          showUpdate('Page updated! Reloading...', 'success');
          setTimeout(function() { window.location.reload(); }, 1500);
        } else {
          showUpdate(updateResult.error || 'Update failed', 'error');
          updateBtn.disabled = false;
          updateBtn.textContent = 'Update Page \\u2014 1 USDC';
        }
      } catch(err) {
        var msg = err.message || 'Unknown error';
        if (msg.includes('User denied') || msg.includes('rejected')) {
          showUpdate('Transaction cancelled.', 'error');
        } else {
          showUpdate('Error: ' + msg, 'error');
        }
        updateBtn.disabled = false;
        updateBtn.textContent = 'Update Page \\u2014 1 USDC';
      }
    });
  }

  // ── Scan-only button (holders tab, when token is unscanned) ──
  var scanBtn = document.getElementById('scan-btn');
  var scanStatus = document.getElementById('scan-status');

  function showScan(msg, type) {
    if (!scanStatus) return;
    scanStatus.textContent = msg;
    scanStatus.className = 'claim-status' + (type ? ' ' + type : '');
  }

  if (scanBtn) {
    scanBtn.addEventListener('click', async function() {
      scanBtn.disabled = true;
      showScan('', '');

      try {
        var result = await payUsdc(function(msg) {
          scanBtn.textContent = msg;
          showScan(msg, '');
        });

        scanBtn.textContent = 'Starting scan...';
        showScan('Payment confirmed! Starting scan...', '');

        var scanResp = await fetch('/api/scan/' + D.chain + '/' + D.tokenAddress, {
          method: 'POST',
          headers: {
            'X-Wallet-Address': result.from,
            'X-Payment-Proof': result.proof,
          },
        });

        var scanResult = await scanResp.json();

        if (!scanResp.ok) {
          showScan(scanResult.error || 'Scan request failed', 'error');
          scanBtn.disabled = false;
          scanBtn.textContent = 'Scan & Claim \\u2014 1 USDC';
          return;
        }

        var scanId = scanResult.scan_id;
        if (scanId) {
          showScan('Scan in progress...', '');
          scanBtn.textContent = 'Scanning...';
          var pollScan = setInterval(async function() {
            try {
              var statusResp = await fetch('/api/scan/' + scanId + '/status');
              var statusData = await statusResp.json();
              if (statusData.status === 'complete') {
                clearInterval(pollScan);
                showScan('Scan complete! ' + (statusData.holders_found || 0) + ' holders found. Reloading...', 'success');
                setTimeout(function() { window.location.reload(); }, 2000);
              } else if (statusData.status === 'failed') {
                clearInterval(pollScan);
                showScan('Scan failed: ' + (statusData.error_message || 'Unknown error'), 'error');
                scanBtn.disabled = false;
                scanBtn.textContent = 'Scan & Claim \\u2014 1 USDC';
              } else {
                var phase = statusData.progress_phase || 'processing';
                var pct = statusData.progress_pct != null ? ' (' + Math.round(statusData.progress_pct) + '%)' : '';
                showScan('Scanning: ' + phase + pct, '');
              }
            } catch(e) {}
          }, 3000);
        } else {
          showScan('Scan started! Reload in a few minutes.', 'success');
        }

      } catch(err) {
        var msg = err.message || 'Unknown error';
        if (msg.includes('User denied') || msg.includes('rejected')) {
          showScan('Transaction cancelled.', 'error');
        } else {
          showScan('Error: ' + msg, 'error');
        }
        scanBtn.disabled = false;
        scanBtn.textContent = 'Scan & Claim \\u2014 1 USDC';
      }
    });
  }

  // Auth is now server-rendered (session cookie), no client-side auth needed
})();
</script>`
}
