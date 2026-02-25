// Client-side JavaScript for bungalow pages (rendered as inline <script>)

export function renderClientScript(): string {
  return `<script>
(function() {
  var D = window.__DATA__ || {};

  // ── Helper: get best EVM provider ──
  // Only use Farcaster miniapp provider when actually inside a miniapp frame;
  // otherwise prefer the injected browser wallet (Rainbow, MetaMask, etc.)
  function getEvmProvider() {
    var isMiniApp = !!(window.FarcasterMiniApp || (window.parent !== window && window.__FC_PROVIDER__));
    if (isMiniApp) {
      var fc = window.__FC_PROVIDER__;
      if (fc && typeof fc.request === 'function') return fc;
    }
    if (window.ethereum && typeof window.ethereum.request === 'function') return window.ethereum;
    return null;
  }

  // ── Passive wallet detection (no popup) ──
  (function() {
    var display = document.getElementById('wallet-display');
    if (!display) return;

    function show(addr) {
      if (!addr) return;
      var short = addr.length > 10 ? addr.slice(0, 6) + '\\u2026' + addr.slice(-4) : addr;
      display.textContent = short;
      display.title = addr;
    }

    function tryEvmPassive(provider) {
      if (!provider) return;
      provider.request({ method: 'eth_accounts' }).then(function(accts) {
        if (accts && accts.length > 0) show(accts[0]);
      }).catch(function() {});
    }

    // EVM: passive check (no connect popup) — try Farcaster provider first, then injected
    tryEvmPassive(getEvmProvider());

    // Solana: Phantom embedded browser exposes publicKey immediately
    if (window.phantom && window.phantom.solana && window.phantom.solana.publicKey) {
      show(window.phantom.solana.publicKey.toString());
    } else if (window.solflare && window.solflare.publicKey) {
      show(window.solflare.publicKey.toString());
    }

    // Farcaster miniapp SDK loads async — handle late arrival
    window.__onFcProvider = function(provider) {
      tryEvmPassive(provider);
    };
  })();

  // ── Tab switching ──
  var tabs = document.querySelectorAll('.tab-btn');
  var panels = document.querySelectorAll('.tab-panel');
  var chartLoaded = false;

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
      if (name !== 'holders') params.set('tab', name);
      var qs = params.toString();
      var newUrl = window.location.pathname + (qs ? '?' + qs : '');
      history.replaceState({ tab: name }, '', newUrl);
    }
  }

  tabs.forEach(function(tab) {
    tab.addEventListener('click', function(e) {
      e.preventDefault();
      switchTab(this.getAttribute('data-tab'));
    });
  });

  // ════════════════════════════════════════════════════════
  // ── Holder balance history chart (click heat to toggle) ──
  // ════════════════════════════════════════════════════════

  var HOLDER_COLORS = ['#22d3ee', '#f87171', '#4ade80', '#facc15', '#fb923c', '#a78bfa', '#f472b6', '#38bdf8'];
  var selectedHolders = []; // [{wallet, color, points, label}]

  function showSkeleton() {
    var wrap = document.getElementById('holder-chart-wrap');
    var skel = document.getElementById('holder-chart-skeleton');
    var canvas = document.getElementById('holder-chart-canvas');
    var holderPanel = document.getElementById('panel-holders');
    if (wrap) wrap.classList.add('visible');
    if (holderPanel) holderPanel.classList.add('has-chart');
    if (skel) skel.style.display = 'flex';
    if (canvas) canvas.style.display = 'none';
  }

  function hideSkeleton() {
    var skel = document.getElementById('holder-chart-skeleton');
    var canvas = document.getElementById('holder-chart-canvas');
    if (skel) skel.style.display = 'none';
    if (canvas) canvas.style.display = 'block';
  }

  function toggleHolderHistory(wallet, label) {
    console.log('[toggle] wallet:', wallet, 'label:', label, 'selected:', selectedHolders.length);
    var idx = -1;
    for (var i = 0; i < selectedHolders.length; i++) {
      if (selectedHolders[i].wallet === wallet) { idx = i; break; }
    }

    if (idx !== -1) {
      console.log('[toggle] deselecting wallet at idx', idx);
      selectedHolders.splice(idx, 1);
      updateHolderChartUI();
      return;
    }

    // Solana history may or may not be available — try anyway

    var color = HOLDER_COLORS[selectedHolders.length % HOLDER_COLORS.length];
    markHeatCell(wallet, color, true);

    if (selectedHolders.length === 0) {
      console.log('[toggle] showing skeleton');
      showSkeleton();
    }

    var url = '/api/token/' + D.chain + '/' + D.tokenAddress + '/holder/' + wallet + '/history';
    console.log('[toggle] fetching:', url);

    fetch(url)
      .then(function(r) {
        console.log('[toggle] fetch status:', r.status);
        return r.json();
      })
      .then(function(data) {
        console.log('[toggle] data received, points:', data.points ? data.points.length : 0);
        if (!data.points || data.points.length === 0) {
          console.log('[toggle] no points, hiding');
          markHeatCell(wallet, null, false);
          if (selectedHolders.length === 0) {
            var wrap = document.getElementById('holder-chart-wrap');
            if (wrap) wrap.classList.remove('visible');
            var holderPanel = document.getElementById('panel-holders');
            if (holderPanel) holderPanel.classList.remove('has-chart');
          }
          if (searchMsg) {
            searchMsg.textContent = 'This wallet hasn\\u2019t interacted with this token.';
            searchMsg.classList.add('active');
            setTimeout(function() { searchMsg.classList.remove('active'); searchMsg.textContent = ''; }, 4000);
          }
          return;
        }
        selectedHolders.push({ wallet: wallet, color: color, points: data.points, label: label || shortAddr(wallet) });
        ensureHolderRow(wallet, label || shortAddr(wallet));
        console.log('[toggle] calling updateHolderChartUI, selected:', selectedHolders.length);
        updateHolderChartUI();
      })
      .catch(function(err) {
        console.error('[toggle] fetch error:', err);
        markHeatCell(wallet, null, false);
        if (selectedHolders.length === 0) {
          var wrap = document.getElementById('holder-chart-wrap');
          if (wrap) wrap.classList.remove('visible');
          var holderPanel = document.getElementById('panel-holders');
          if (holderPanel) holderPanel.classList.remove('has-chart');
        }
      });
  }

  function ensureHolderRow(wallet, label) {
    // If the wallet already has a row in the table, nothing to do
    var existing = document.querySelector('tr.holder-row[data-wallet="' + wallet + '"]');
    if (existing) return;
    // Find the holders table tbody and append a row
    var tbody = document.querySelector('#holders-list .holders-table tbody');
    if (!tbody) return;
    var rowCount = tbody.querySelectorAll('tr.holder-row').length;
    var displayLabel = label || shortAddr(wallet);
    var tr = document.createElement('tr');
    tr.className = 'holder-row';
    tr.setAttribute('data-wallet', wallet);
    tr.innerHTML = '<td class="rank">' + (rowCount + 1) + '</td>'
      + '<td><a class="holder-link" href="/wallet/' + wallet + '"><span class="holder-wallet">' + displayLabel + '</span></a></td>'
      + '<td class="heat" data-wallet="' + wallet + '">—</td>';
    tbody.appendChild(tr);
  }

  function markHeatCell(wallet, color, loading) {
    var cells = document.querySelectorAll('td.heat[data-wallet="' + wallet + '"]');
    for (var i = 0; i < cells.length; i++) {
      if (color) {
        cells[i].classList.add('selected');
        cells[i].style.color = color;
        if (loading) {
          // Save original text and show spinner
          if (!cells[i].getAttribute('data-orig')) {
            cells[i].setAttribute('data-orig', cells[i].textContent);
          }
          cells[i].innerHTML = '<span class="heat-spinner"></span>';
        } else {
          cells[i].style.opacity = '1';
        }
      } else {
        cells[i].classList.remove('selected');
        cells[i].style.color = '';
        cells[i].style.opacity = '1';
        // Restore original text
        var orig = cells[i].getAttribute('data-orig');
        if (orig) {
          cells[i].textContent = orig;
          cells[i].removeAttribute('data-orig');
        }
      }
    }
  }

  function updateHolderChartUI() {
    var wrap = document.getElementById('holder-chart-wrap');
    if (!wrap) return;

    // Update all heat cell colors
    var allCells = document.querySelectorAll('td.heat[data-wallet]');
    for (var c = 0; c < allCells.length; c++) {
      var w = allCells[c].getAttribute('data-wallet');
      var found = null;
      for (var s = 0; s < selectedHolders.length; s++) {
        if (selectedHolders[s].wallet === w) { found = selectedHolders[s]; break; }
      }
      // Restore spinner to original text if needed
      var orig = allCells[c].getAttribute('data-orig');
      if (orig && !allCells[c].querySelector('.heat-spinner')) {
        // Already restored
      } else if (orig) {
        allCells[c].textContent = orig;
        allCells[c].removeAttribute('data-orig');
      }
      if (found) {
        allCells[c].classList.add('selected');
        allCells[c].style.color = found.color;
        allCells[c].style.opacity = '1';
      } else {
        allCells[c].classList.remove('selected');
        allCells[c].style.color = '';
        allCells[c].style.opacity = '1';
      }
    }

    var holderPanel = document.getElementById('panel-holders');
    if (selectedHolders.length === 0) {
      wrap.classList.remove('visible');
      if (holderPanel) holderPanel.classList.remove('has-chart');
      return;
    }

    wrap.classList.add('visible');
    if (holderPanel) holderPanel.classList.add('has-chart');
    drawHolderChart();
  }

  function drawHolderChart() {
    var wrap = document.getElementById('holder-chart-wrap');
    var canvas = document.getElementById('holder-chart-canvas');
    var legend = document.getElementById('holder-chart-legend');
    if (!wrap || !canvas || !legend) return;
    hideSkeleton();

    var dpr = window.devicePixelRatio || 1;
    var w = wrap.clientWidth;
    var panel = wrap.closest('.tab-panel');
    var isDesktopSplit = panel && panel.classList.contains('has-chart') && window.innerWidth >= 768;
    var h;
    if (isDesktopSplit) {
      // Desktop: chart fills the right half vertically, leave room for legend
      h = Math.max((panel.clientHeight || 400) - 40, 200);
    } else {
      // Mobile: cap to 50% of panel height
      var maxH = panel ? Math.round(panel.clientHeight * 0.5) : 300;
      h = Math.min(Math.round(w / 2), maxH);
    }
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    var ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    var pad = { top: 24, right: 16, bottom: 40, left: 60 };
    var cw = w - pad.left - pad.right;
    var ch = h - pad.top - pad.bottom;

    // Background
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, w, h);

    if (cw < 40 || ch < 40) return;

    // Find global time and balance range
    var tMin = Infinity, tMax = -Infinity, bMax = 0;
    for (var si = 0; si < selectedHolders.length; si++) {
      var pts = selectedHolders[si].points;
      for (var pi = 0; pi < pts.length; pi++) {
        if (pts[pi].t < tMin) tMin = pts[pi].t;
        if (pts[pi].t > tMax) tMax = pts[pi].t;
        if (pts[pi].b > bMax) bMax = pts[pi].b;
      }
    }
    if (tMin >= tMax) tMax = tMin + 1;
    if (bMax <= 0) bMax = 1;

    // Y grid + labels
    var ySteps = 4;
    ctx.strokeStyle = '#1a1a24';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#71717a';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (var yi = 0; yi <= ySteps; yi++) {
      var yVal = (bMax / ySteps) * yi;
      var yPos = pad.top + ch - (ch * yi / ySteps);
      ctx.beginPath();
      ctx.moveTo(pad.left, yPos);
      ctx.lineTo(w - pad.right, yPos);
      ctx.stroke();
      var yLabel;
      if (yVal >= 1e9) yLabel = (yVal / 1e9).toFixed(1) + 'B';
      else if (yVal >= 1e6) yLabel = (yVal / 1e6).toFixed(1) + 'M';
      else if (yVal >= 1e3) yLabel = (yVal / 1e3).toFixed(1) + 'K';
      else yLabel = yVal.toFixed(yVal < 10 ? 2 : 0);
      ctx.fillText(yLabel, pad.left - 6, yPos);
    }

    // X-axis date labels
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    var xLabels = 5;
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    for (var xi = 0; xi < xLabels; xi++) {
      var xT = tMin + (tMax - tMin) * xi / (xLabels - 1);
      var xX = pad.left + cw * xi / (xLabels - 1);
      var dd = new Date(xT * 1000);
      ctx.fillText(months[dd.getMonth()] + ' ' + dd.getDate() + ', ' + String(dd.getFullYear()).slice(2), xX, pad.top + ch + 8);
    }

    // Draw lines for each selected holder
    for (var hi = 0; hi < selectedHolders.length; hi++) {
      var holder = selectedHolders[hi];
      var pts = holder.points;
      if (pts.length < 2) continue;

      ctx.strokeStyle = holder.color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (var p = 0; p < pts.length; p++) {
        var px = pad.left + ((pts[p].t - tMin) / (tMax - tMin)) * cw;
        var py = pad.top + ch - (pts[p].b / bMax) * ch;
        if (p === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    // Legend (preserve search button)
    legend.innerHTML = selectedHolders.map(function(h) {
      return '<span class="holder-chart-legend-item" data-wallet="' + h.wallet + '">'
        + '<span class="holder-chart-legend-dot" style="background:' + h.color + '"></span>'
        + h.label
        + ' \\u2715'
        + '</span>';
    }).join('')
      + '<button class="holder-chart-search-btn" id="holder-search-btn" title="Search wallet">\\uD83D\\uDD0D</button>';

    // Click legend item to deselect
    legend.querySelectorAll('.holder-chart-legend-item').forEach(function(el) {
      el.addEventListener('click', function() {
        var w = el.getAttribute('data-wallet');
        if (w) toggleHolderHistory(w);
      });
    });

    // Re-bind search button (was recreated in innerHTML)
    var newSearchBtn = document.getElementById('holder-search-btn');
    if (newSearchBtn) {
      newSearchBtn.addEventListener('click', function() {
        var overlay = document.getElementById('holder-search-overlay');
        if (overlay) overlay.classList.add('active');
      });
    }
  }

  // ── Click handler for heat cells ──
  document.addEventListener('click', function(e) {
    var cell = e.target.closest('td.heat[data-wallet]');
    if (!cell) { console.log('[heat-click] no td.heat cell found, target:', e.target.tagName, e.target.className); return; }
    e.preventDefault();
    e.stopPropagation();
    var wallet = cell.getAttribute('data-wallet');
    console.log('[heat-click] wallet:', wallet, 'chain:', D.chain, 'token:', D.tokenAddress);
    if (!wallet) return;

    // Build label from the row
    var row = cell.closest('tr');
    var label = wallet;
    if (row) {
      var un = row.querySelector('.holder-username');
      if (un) label = un.textContent;
      else {
        var wa = row.querySelector('.holder-wallet');
        if (wa) label = wa.textContent;
      }
    }
    toggleHolderHistory(wallet, label);
  });

  // Redraw chart on resize
  var hcResizeTimer;
  window.addEventListener('resize', function() {
    if (selectedHolders.length > 0) {
      clearTimeout(hcResizeTimer);
      hcResizeTimer = setTimeout(drawHolderChart, 150);
    }
  });

  // ── Holder search ──
  var searchBtn = document.getElementById('holder-search-btn');
  var searchOverlay = document.getElementById('holder-search-overlay');
  var searchInput = document.getElementById('holder-search-input');
  var searchGo = document.getElementById('holder-search-go');
  var searchClose = document.getElementById('holder-search-close');
  var searchMsg = document.getElementById('holder-search-msg');

  if (searchBtn) {
    searchBtn.addEventListener('click', function() {
      if (searchOverlay) {
        searchOverlay.classList.add('active');
      }
    });
  }
  if (searchClose) {
    searchClose.addEventListener('click', function() {
      if (searchOverlay) searchOverlay.classList.remove('active');
      if (searchMsg) { searchMsg.classList.remove('active'); searchMsg.textContent = ''; }
      if (searchInput) searchInput.value = '';
    });
  }
  function doHolderSearch() {
    if (!searchInput) return;
    var addr = searchInput.value.trim();
    if (!addr) return;
    if (searchMsg) { searchMsg.classList.remove('active'); searchMsg.textContent = ''; }

    // Check if already selected
    for (var i = 0; i < selectedHolders.length; i++) {
      if (selectedHolders[i].wallet.toLowerCase() === addr.toLowerCase()) {
        if (searchOverlay) searchOverlay.classList.remove('active');
        if (searchInput) searchInput.value = '';
        return;
      }
    }

    // Check if wallet exists in the loaded holder rows
    var row = document.querySelector('tr.holder-row[data-wallet="' + addr + '"]')
      || document.querySelector('tr.holder-row[data-wallet="' + addr.toLowerCase() + '"]');
    var label = addr;
    if (row) {
      var un = row.querySelector('.holder-username');
      if (un) label = un.textContent;
      else {
        var wa = row.querySelector('.holder-wallet');
        if (wa) label = wa.textContent;
      }
    }

    // Try to load history regardless (wallet may exist but not be in current page)
    if (searchOverlay) searchOverlay.classList.remove('active');
    if (searchInput) searchInput.value = '';
    toggleHolderHistory(addr, label);
  }
  if (searchGo) {
    searchGo.addEventListener('click', doHolderSearch);
  }
  if (searchInput) {
    searchInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') doHolderSearch();
    });
  }

  // ── Helper: short address ──
  function shortAddr(addr) {
    if (!addr || addr.length <= 10) return addr || '';
    return addr.slice(0, 6) + '\\u2026' + addr.slice(-4);
  }

  // ── Helper: Arkham link ──
  function arkhamLink(wallet) {
    return '<a class="arkham-holder-link" href="https://intel.arkm.com/explorer/address/' + wallet + '" target="_blank" rel="noopener" title="View on Arkham">'
      + '<svg width="12" height="12" viewBox="0 0 761 703" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M114.48 515.486L380.133 703L471.864 638.119L149.705 410.677L114.48 515.486ZM272.991 465.577L380.133 541.153L471.864 476.272L308.216 360.769L272.991 465.577ZM403.616 557.552L495.347 622.433L761 434.919L725.775 330.111L403.616 557.552ZM402.882 395.705L494.613 460.586L601.755 384.297L566.53 279.489C567.264 279.489 402.882 395.705 402.882 395.705ZM199.607 262.377L158.511 385.01L250.242 449.178L312.619 262.377H199.607ZM101.271 131.189L0 434.919L91.731 499.8L214.284 131.902L101.271 131.189ZM242.904 131.189L207.679 235.997H410.221L374.996 131.189H242.904ZM403.616 131.189L466.727 317.99L558.458 253.108L517.363 130.476C517.363 131.189 403.616 131.189 403.616 131.189ZM145.302 0.712982L110.077 105.521H508.556L473.332 0L145.302 0.712982ZM614.964 0H501.952L625.238 367.899L716.969 303.017L614.964 0Z" fill="currentColor"/></svg>'
      + '</a>';
  }

  // ── Helper: format heat ──
  function fmtHeat(val) {
    return Number(val).toFixed(1) + '\\u00B0';
  }

  // ── AJAX: fetch and render holders ──
  var holdersPage = 0;
  var holdersLoading = false;
  var holdersAllLoaded = false;
  var HOLDERS_PER_PAGE = 30;

  function fetchHolders(offset, append) {
    var list = document.getElementById('holders-list');
    var countEl = document.getElementById('holder-count');
    if (!list || holdersLoading) return;
    holdersLoading = true;

    var url = '/api/token/' + D.chain + '/' + D.tokenAddress + '/holders?limit=' + HOLDERS_PER_PAGE + '&offset=' + offset;

    fetch(url)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        holdersLoading = false;
        if (!data.holders || data.holders.length === 0) {
          holdersAllLoaded = true;
          var loadMore = document.getElementById('holders-load-more');
          if (loadMore) loadMore.style.display = 'none';
          return;
        }
        if (data.holders.length < HOLDERS_PER_PAGE) {
          holdersAllLoaded = true;
        }
        if (countEl && data.total) countEl.textContent = data.total + ' holder' + (data.total !== 1 ? 's' : '');
        var rows = data.holders.map(function(h, i) {
          var rank = offset + i + 1;
          var identity = h.farcaster && h.farcaster.username
            ? '<span class="holder-identity">'
              + (h.farcaster.pfp_url ? '<img class="holder-pfp" src="' + h.farcaster.pfp_url + '" alt="" />' : '')
              + '<span class="holder-username">' + h.farcaster.username + '</span></span>'
            : '<span class="holder-wallet">' + shortAddr(h.wallet) + '</span>';
          return '<tr class="holder-row" data-wallet="' + h.wallet + '"><td class="rank">' + rank + '</td>'
            + '<td><a class="holder-link" href="/wallet/' + h.wallet + '">' + identity + '</a>' + arkhamLink(h.wallet) + '</td>'
            + '<td class="heat" data-wallet="' + h.wallet + '">' + fmtHeat(h.heat_degrees) + '</td></tr>';
        }).join('');

        if (append) {
          var tbody = list.querySelector('tbody');
          if (tbody) {
            tbody.insertAdjacentHTML('beforeend', rows);
          }
        } else {
          list.innerHTML = '<table class="holders-table">'
            + '<thead><tr><th>#</th><th>Holder</th><th style="text-align:right">Heat Score</th></tr></thead>'
            + '<tbody>' + rows + '</tbody></table>'
            + (holdersAllLoaded ? '' : '<div class="holders-load-more" id="holders-load-more">Loading more...</div>');
        }

        var loadMore = document.getElementById('holders-load-more');
        if (loadMore && holdersAllLoaded) loadMore.style.display = 'none';
      })
      .catch(function() {
        holdersLoading = false;
      });
  }

  // ── Infinite scroll for holders ──
  var holdersScroll = document.getElementById('holders-scroll');
  if (holdersScroll) {
    holdersScroll.addEventListener('scroll', function() {
      if (holdersAllLoaded || holdersLoading) return;
      var el = holdersScroll;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) {
        holdersPage += 1;
        fetchHolders(holdersPage * HOLDERS_PER_PAGE, true);
      }
    });
  }

  // ── Popstate (back/forward) ──
  window.addEventListener('popstate', function(e) {
    var state = e.state;
    if (state && state.tab) {
      switchTab(state.tab, false);
    }
  });

  // ── Restore from URL params on load ──
  (function() {
    var params = new URLSearchParams(window.location.search);
    var tab = params.get('tab');
    if (tab && document.getElementById('panel-' + tab)) {
      switchTab(tab, false);
    }
    // Default is holders (set in HTML), no need to override
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

  // ── Share button ──
  var shareBtn = document.getElementById('share-btn');
  if (shareBtn) {
    shareBtn.addEventListener('click', function() {
      var url = window.location.href;
      var title = D.name ? D.name + ' ($' + D.symbol + ')' : 'Check this token on Memetics';
      if (navigator.share) {
        navigator.share({ title: title, url: url }).catch(function() {});
      } else {
        navigator.clipboard.writeText(url).then(function() {
          shareBtn.title = 'Link copied!';
          setTimeout(function() { shareBtn.title = 'Share'; }, 1500);
        }).catch(function() {});
      }
    });
  }

  // ── Show update form only if connected wallet matches owner ──
  var ownerForm = document.getElementById('owner-update-form');
  if (ownerForm && D.ownerWallet) {
    // Check if EVM wallet matches owner (Farcaster miniapp or injected)
    var ownerProvider = getEvmProvider();
    if (ownerProvider) {
      ownerProvider.request({ method: 'eth_accounts' }).then(function(accounts) {
        if (accounts && accounts.length > 0 && accounts[0].toLowerCase() === D.ownerWallet.toLowerCase()) {
          ownerForm.style.display = 'block';
        }
      }).catch(function() {});
    }
    // Handle late Farcaster provider arrival
    var origOnFc = window.__onFcProvider;
    window.__onFcProvider = function(provider) {
      if (origOnFc) origOnFc(provider);
      provider.request({ method: 'eth_accounts' }).then(function(accounts) {
        if (accounts && accounts.length > 0 && accounts[0].toLowerCase() === D.ownerWallet.toLowerCase()) {
          ownerForm.style.display = 'block';
        }
      }).catch(function() {});
    };
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

  // Save current visit
  if (D.chain && D.tokenAddress) {
    saveRecent(D.chain, D.tokenAddress, D.name);
  }

  // ── Payment receipt storage (survives page reload) ──
  var PAYMENT_KEY = 'scanPayments';

  function getSavedPayment(tokenAddr) {
    try {
      var all = JSON.parse(localStorage.getItem(PAYMENT_KEY) || '{}');
      var entry = all[tokenAddr.toLowerCase()];
      if (!entry) return null;
      // Expire after 24h
      if (Date.now() - entry.ts > 86400000) {
        delete all[tokenAddr.toLowerCase()];
        localStorage.setItem(PAYMENT_KEY, JSON.stringify(all));
        return null;
      }
      return entry;
    } catch(e) { return null; }
  }

  function savePayment(tokenAddr, proof, from) {
    try {
      var all = JSON.parse(localStorage.getItem(PAYMENT_KEY) || '{}');
      all[tokenAddr.toLowerCase()] = { proof: proof, from: from, ts: Date.now() };
      localStorage.setItem(PAYMENT_KEY, JSON.stringify(all));
    } catch(e) {}
  }

  function clearPayment(tokenAddr) {
    try {
      var all = JSON.parse(localStorage.getItem(PAYMENT_KEY) || '{}');
      delete all[tokenAddr.toLowerCase()];
      localStorage.setItem(PAYMENT_KEY, JSON.stringify(all));
    } catch(e) {}
  }

  // ════════════════════════════════════════════════════════
  // ── Payment helpers ──
  // ════════════════════════════════════════════════════════

  var TREASURY = '0xe91B8920Ef5DBf6e1289991F1CE4eeF3671A610E';
  var USDC_ADDR = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  var CLAIM_AMOUNT = 'f4240'; // 1_000_000 in hex (1 USDC, 6 decimals)

  var SOL_TREASURY = 'Grd283VR3E1KQnrdpHkPhAB5BwSGX7Rq5WPdBs416pes';
  var SOL_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  var SOL_RPC = '/api/solana-rpc'; // Backend proxy (public RPC blocks browser requests)

  // ── payEvmUsdc: connect wallet → switch to Base → send ERC20 transfer → poll receipt ──
  async function payEvmUsdc() {
    var evmProvider = getEvmProvider();
    console.log('[payEvmUsdc] provider:', evmProvider ? 'found' : 'null', 'isPhantom:', !!(evmProvider && evmProvider.isPhantom), 'isMetaMask:', !!(evmProvider && evmProvider.isMetaMask));
    if (!evmProvider) throw new Error('No EVM wallet detected. Install an EVM one.');

    var accounts;
    try {
      accounts = await evmProvider.request({ method: 'eth_requestAccounts' });
    } catch(connectErr) {
      console.error('[payEvmUsdc] eth_requestAccounts error:', connectErr, typeof connectErr);
      var rawMsg = (connectErr && connectErr.message) ? connectErr.message : '';
      if (rawMsg.includes('User denied') || rawMsg.includes('rejected')) {
        throw new Error('Wallet connection cancelled.');
      }
      throw new Error('EVM wallet failed to connect. Make sure you have MetaMask or a compatible EVM wallet, or use the Solana option instead.');
    }
    console.log('[payEvmUsdc] accounts:', accounts);
    if (!accounts || accounts.length === 0) throw new Error('No accounts returned from wallet');
    var from = accounts[0];

    // Switch to Base (chain 8453 = 0x2105)
    try {
      await evmProvider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x2105' }]
      });
      console.log('[payEvmUsdc] switched to Base');
    } catch (switchErr) {
      console.log('[payEvmUsdc] switch error:', switchErr);
      if (switchErr && switchErr.code === 4902) {
        await evmProvider.request({
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
        var switchMsg = (switchErr && switchErr.message) ? switchErr.message : 'Failed to switch to Base network';
        throw new Error(switchMsg);
      }
    }

    // Check USDC balance before sending
    try {
      var balData = '0x70a08231' + from.slice(2).toLowerCase().padStart(64, '0');
      var balHex = await evmProvider.request({
        method: 'eth_call',
        params: [{ to: USDC_ADDR, data: balData }, 'latest']
      });
      console.log('[payEvmUsdc] balance hex:', balHex);
      var balance = BigInt(balHex);
      if (balance < BigInt('0x' + CLAIM_AMOUNT)) {
        throw new Error('Insufficient USDC balance on Base');
      }
    } catch(e) {
      console.log('[payEvmUsdc] balance check error:', e);
      if (e && e.message && e.message.includes('Insufficient')) throw e;
      // If balance check fails, proceed anyway — wallet will reject if insufficient
    }

    // ERC20 transfer(address,uint256) = 0xa9059cbb + padded address + padded amount
    var transferData = '0xa9059cbb'
      + TREASURY.slice(2).toLowerCase().padStart(64, '0')
      + CLAIM_AMOUNT.padStart(64, '0');

    console.log('[payEvmUsdc] sending tx from:', from);
    var txHash;
    try {
      txHash = await evmProvider.request({
        method: 'eth_sendTransaction',
        params: [{
          from: from,
          to: USDC_ADDR,
          data: transferData,
        }]
      });
    } catch(txErr) {
      console.error('[payEvmUsdc] eth_sendTransaction error:', txErr, typeof txErr);
      var txMsg = (txErr && txErr.message) ? txErr.message : 'Transaction failed';
      throw new Error(txMsg);
    }
    console.log('[payEvmUsdc] txHash:', txHash);

    // Wallet accepted the tx — return immediately, backend will verify on-chain
    return { proof: txHash, from: from, chain: 'base' };
  }

  // ── Helper: call Solana RPC through backend proxy ──
  async function solanaRpc(method, params) {
    var res = await fetch(SOL_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: method, params: params }),
    });
    var data = await res.json();
    if (data.error) throw new Error('Solana RPC: ' + (data.error.message || JSON.stringify(data.error)));
    return data.result;
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

    var PublicKey = web3Mod.PublicKey;
    var Transaction = web3Mod.Transaction;
    var getAssociatedTokenAddress = splMod.getAssociatedTokenAddress;
    var createTransferInstruction = splMod.createTransferInstruction;
    var createAssociatedTokenAccountInstruction = splMod.createAssociatedTokenAccountInstruction;

    var senderPk = new PublicKey(from);
    var treasuryPk = new PublicKey(SOL_TREASURY);
    var usdcMintPk = new PublicKey(SOL_USDC_MINT);

    // Derive ATAs
    var senderAta = await getAssociatedTokenAddress(usdcMintPk, senderPk);
    var treasuryAta = await getAssociatedTokenAddress(usdcMintPk, treasuryPk);

    // Check sender USDC balance via proxy
    try {
      var balResult = await solanaRpc('getTokenAccountBalance', [senderAta.toBase58()]);
      var senderAmount = BigInt(balResult.value.amount);
      if (senderAmount < 1000000n) {
        throw new Error('Insufficient USDC balance on Solana');
      }
    } catch(e) {
      if (e.message.includes('Insufficient')) throw e;
      if (e.message.includes('could not find') || e.message.includes('null')) {
        throw new Error('No USDC token account found. You need USDC on Solana.');
      }
    }

    // Build transaction
    var tx = new Transaction();

    // Check if treasury ATA exists, create if not
    try {
      await solanaRpc('getTokenAccountBalance', [treasuryAta.toBase58()]);
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

    // Get recent blockhash via proxy
    var bhResult = await solanaRpc('getLatestBlockhash', [{ commitment: 'confirmed' }]);
    tx.recentBlockhash = bhResult.value.blockhash;
    tx.feePayer = senderPk;

    // Sign and send via wallet (wallet handles sending to network directly)
    var signed = await provider.signAndSendTransaction(tx);
    var signature = signed.signature || signed;

    return { proof: signature, from: from, chain: 'solana' };
  }

  // ── payUsdc: unified wrapper — detects wallets, shows choice if both available ──
  // statusFn receives a single string to show on the button
  // contextEl is the container near the button (to find the right wallet-choice)
  function payUsdc(statusFn, contextEl) {
    return new Promise(function(resolve, reject) {
      var hasEvm = !!getEvmProvider();
      var hasSolana = !!(window.phantom && window.phantom.solana) || !!window.solflare;

      if (!hasEvm && !hasSolana) {
        reject(new Error('No wallet detected. Install Rainbow (EVM) or Phantom (Solana).'));
        return;
      }

      function wrapEvm() {
        if (statusFn) statusFn('Connecting wallet...');
        payEvmUsdc().then(function(r) {
          if (statusFn) statusFn('Submitting scan...');
          resolve(r);
        }).catch(reject);
      }

      function wrapSolana() {
        if (statusFn) statusFn('Connecting wallet...');
        paySolanaUsdc().then(function(r) {
          if (statusFn) statusFn('Submitting scan...');
          resolve(r);
        }).catch(reject);
      }

      if (hasEvm && !hasSolana) { wrapEvm(); return; }
      if (hasSolana && !hasEvm) { wrapSolana(); return; }

      // Both available — show wallet choice UI (find nearest one to the button)
      var choiceEl = contextEl
        ? contextEl.querySelector('.wallet-choice')
        : document.querySelector('.wallet-choice');
      if (choiceEl) {
        if (statusFn) statusFn('Choose wallet');
        choiceEl.style.display = 'flex';

        var baseBtn = choiceEl.querySelector('.pay-base-btn');
        var solBtn = choiceEl.querySelector('.pay-solana-btn');

        function cleanup() {
          choiceEl.style.display = 'none';
          if (baseBtn) baseBtn.onclick = null;
          if (solBtn) solBtn.onclick = null;
        }

        if (baseBtn) {
          baseBtn.onclick = function() { cleanup(); wrapEvm(); };
        }
        if (solBtn) {
          solBtn.onclick = function() { cleanup(); wrapSolana(); };
        }
      } else {
        wrapEvm();
      }
    });
  }

  // ════════════════════════════════════════════════════════
  // ── Scan & Claim (unified for all scan buttons) ──
  // ════════════════════════════════════════════════════════

  var originalTitle = document.title;

  // Show error text below the button
  function showError(el, msg) {
    if (!el) return;
    el.textContent = msg;
    el.className = 'claim-status error';
  }
  function clearError(el) {
    if (!el) return;
    el.textContent = '';
    el.className = 'claim-status';
  }

  // ── Phase name mapping ──
  var PHASE_LABELS = {
    metadata:      'Fetching token info',
    transfers:     'Fetching transfer history',
    deploy_block:  'Finding contract origin',
    transfer_logs: 'Reading transfer history',
    timestamps:    'Processing timestamps',
    balances:      'Computing holder balances',
    holders:       'Discovering holders',
    heat:          'Calculating heat scores',
    complete:      'Scan complete',
  };

  function phaseLabel(raw) {
    return PHASE_LABELS[raw] || 'Processing';
  }

  // Replace the scan CTA container with a progress UI
  function showScanProgress(container) {
    container.innerHTML =
      '<div class="scan-progress">'
      + '<div class="scan-progress-phase" id="sp-phase">Starting scan...</div>'
      + '<div class="scan-progress-bar"><div class="scan-progress-fill" id="sp-fill" style="width:0%"></div></div>'
      + '<div class="scan-progress-pct" id="sp-pct"></div>'
      + '<div class="scan-logs" id="sp-logs"></div>'
      + '</div>';
    lastLogCount = 0;
  }

  var lastLogCount = 0;

  function updateScanProgressUI(phase, pct, detail, logs) {
    var phaseEl = document.getElementById('sp-phase');
    var fillEl = document.getElementById('sp-fill');
    var pctEl = document.getElementById('sp-pct');
    if (phaseEl) phaseEl.textContent = phaseLabel(phase);
    if (fillEl && pct != null) fillEl.style.width = Math.round(pct) + '%';
    if (pctEl && pct != null) pctEl.textContent = Math.round(pct) + '%';

    // Render activity feed logs
    if (logs && logs.length > lastLogCount) {
      var logsEl = document.getElementById('sp-logs');
      if (logsEl) {
        for (var li = lastLogCount; li < logs.length; li++) {
          var entry = document.createElement('div');
          var isLargeTokenMsg = logs[li].indexOf('You can close this page') !== -1;
          entry.className = 'scan-log-entry' + (isLargeTokenMsg ? ' scan-log-highlight' : '');
          entry.textContent = logs[li];
          logsEl.appendChild(entry);
        }
        lastLogCount = logs.length;
        logsEl.scrollTop = logsEl.scrollHeight;
      }
    }
  }

  function showScanDone(container, holdersFound) {
    container.innerHTML =
      '<div class="scan-progress">'
      + '<div class="scan-progress-done">' + holdersFound + ' holders found!</div>'
      + '<div class="scan-progress-detail">Reloading page...</div>'
      + '<div class="scan-progress-bar"><div class="scan-progress-fill" style="width:100%"></div></div>'
      + '</div>';
  }

  function showScanError(container, msg, btn) {
    container.innerHTML =
      '<div class="scan-cta">'
      + '<p style="color:#f87171">' + msg + '</p>'
      + '<p style="color:#71717a;font-size:12px;margin-top:8px">This will be retried automatically. Come back in a few minutes.</p>'
      + '</div>';
    if (btn) {
      container.querySelector('.scan-cta').appendChild(btn);
      btn.disabled = false;
      btn.textContent = 'Try Again Now';
      btn.style.display = '';
    }
  }

  // Shared: submit scan request and poll progress
  function submitScanAndPoll(from, proof, btn, statusEl) {
    // Find the parent container to replace with progress UI
    var container = btn ? btn.closest('.scan-cta') || btn.closest('.unclaimed-cta') : null;
    if (container) {
      showScanProgress(container);
    } else if (btn) {
      btn.textContent = 'Starting scan...';
    }

    fetch('/api/scan/' + D.chain + '/' + D.tokenAddress, {
      method: 'POST',
      headers: {
        'X-Wallet-Address': from,
        'X-Payment-Proof': proof || '',
      },
    }).then(function(scanResp) {
      var contentType = scanResp.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error('Server error (' + scanResp.status + '). Please try again.');
      }
      return scanResp.json().then(function(scanResult) {
        if (!scanResp.ok) {
          var errMsg = (scanResult && scanResult.error) ? scanResult.error : 'Scan request failed';
          if (container) {
            showScanError(container, errMsg, btn);
          } else {
            showError(statusEl, errMsg);
            if (btn) { btn.disabled = false; btn.textContent = 'Retry Scan'; }
          }
          return;
        }

        if (scanResult.status === 'already_exists') {
          clearPayment(D.tokenAddress);
          if (container) showScanDone(container, '\\u2713');
          setTimeout(function() { window.location.reload(); }, 1500);
          return;
        }

        var scanId = scanResult.scan_id;
        if (scanId) {
          var lastUpdate = Date.now();
          var STALL_TIMEOUT = 300000; // 5 minutes with no progress change (large tokens need more time)
          var lastPct = -1;
          var lastDetail = null;

          var pollScan = setInterval(async function() {
            try {
              var sr = await fetch('/api/scan/' + scanId + '/status');
              if (!sr.ok || !(sr.headers.get('content-type') || '').includes('application/json')) throw new Error('poll error');
              var sd = await sr.json();
              if (sd.status === 'complete') {
                clearInterval(pollScan);
                clearPayment(D.tokenAddress);
                if (container) {
                  showScanDone(container, sd.holders_found || 0);
                } else if (btn) {
                  btn.textContent = sd.holders_found + ' holders found!';
                }
                setTimeout(function() { window.location.reload(); }, 2000);
              } else if (sd.status === 'failed') {
                clearInterval(pollScan);
                if (container) {
                  showScanError(container, sd.error_message || 'Scan failed', btn);
                } else {
                  showError(statusEl, sd.error_message || 'Scan failed');
                  if (btn) { btn.disabled = false; btn.textContent = 'Retry Scan'; }
                }
              } else {
                var phase = sd.progress_phase || 'processing';
                var pct = sd.progress_pct != null ? Number(sd.progress_pct) : null;
                var detail = sd.progress_detail || null;

                // Track stalls — detail changes also count as progress
                if ((pct !== null && pct !== lastPct) || (detail && detail !== lastDetail)) {
                  lastPct = pct;
                  lastDetail = detail;
                  lastUpdate = Date.now();
                }

                if (container) {
                  updateScanProgressUI(phase, pct, detail, sd.logs || []);
                  // Stall warning
                  if (Date.now() - lastUpdate > STALL_TIMEOUT) {
                    var phaseStall = document.getElementById('sp-phase');
                    if (phaseStall) phaseStall.textContent = 'Taking longer than usual. Hang tight...';
                  }
                } else if (btn) {
                  btn.textContent = phaseLabel(phase) + (pct != null ? ' ' + Math.round(pct) + '%' : '...');
                }
              }
            } catch(e) {}
          }, 3000);
        } else {
          if (container) updateScanProgressUI('metadata', 5, null, []);
          else if (btn) btn.textContent = 'Scan started...';
        }
      });
    }).catch(function(err) {
      if (container) {
        showScanError(container, err.message || 'Unknown error', btn);
      } else {
        showError(statusEl, err.message || 'Unknown error');
        if (btn) { btn.disabled = false; btn.textContent = 'Retry Scan'; }
      }
    });
  }

  // ── Reusable scan button initializer ──
  function initScanButton(btn, statusEl) {
    if (!btn) return;
    var saved = getSavedPayment(D.tokenAddress);
    if (saved) {
      btn.textContent = 'Retry Scan (already paid)';
      btn.addEventListener('click', async function() {
        btn.disabled = true;
        clearError(statusEl);
        var from = saved.from;
        if (!from) {
          btn.textContent = 'Connecting wallet...';
          try {
            var retryProvider = getEvmProvider();
            if (retryProvider) {
              var accounts = await retryProvider.request({ method: 'eth_requestAccounts' });
              from = accounts && accounts[0];
            }
          } catch(e) {}
        }
        if (!from) {
          showError(statusEl, 'Connect your wallet to retry.');
          btn.disabled = false;
          btn.textContent = 'Retry Scan (already paid)';
          return;
        }
        submitScanAndPoll(from, saved.proof, btn, statusEl);
      });
    } else {
      btn.addEventListener('click', async function() {
        btn.disabled = true;
        clearError(statusEl);
        try {
          document.title = 'Memetics Bungalow';
          var result = await payUsdc(function(msg) { btn.textContent = msg; }, btn.parentElement);
          document.title = originalTitle;
          savePayment(D.tokenAddress, result.proof, result.from);
          submitScanAndPoll(result.from, result.proof, btn, statusEl);
        } catch(err) {
          document.title = originalTitle;
          var msg = err.message || 'Unknown error';
          if (msg.includes('User denied') || msg.includes('rejected')) {
            showError(statusEl, 'Transaction cancelled.');
          } else {
            showError(statusEl, msg);
          }
          btn.disabled = false;
          btn.textContent = 'Scan & Claim \\u2014 1 USDC';
        }
      });
    }
  }

  // Wire up both scan buttons (Miniapp tab + Holders tab)
  initScanButton(document.getElementById('scan-claim-btn'), document.getElementById('scan-claim-status'));
  initScanButton(document.getElementById('scan-holders-btn'), document.getElementById('scan-holders-status'));

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
        }, claimBtn.parentElement);

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

        if (!(resp.headers.get('content-type') || '').includes('application/json')) {
          throw new Error('Server error (' + resp.status + '). Please try again.');
        }
        var claimResult = await resp.json();

        if (resp.ok && claimResult.ok) {
          showClaim('Bungalow claimed! Reloading...', 'success');
          setTimeout(function() { window.location.reload(); }, 1500);
        } else {
          showClaim((claimResult && claimResult.error) || 'Claim failed', 'error');
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
        }, updateBtn.parentElement);

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

  // Wallet-based UX: no auth needed, wallet IS the identity
})();
</script>`;
}
