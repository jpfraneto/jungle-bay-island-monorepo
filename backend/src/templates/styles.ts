// Shared CSS constants for server-rendered templates

export const COLORS = {
  bg: '#0a0a0f',
  surface: '#13131a',
  surfaceHover: '#1a1a24',
  border: '#2a2a3a',
  text: '#e4e4e7',
  textMuted: '#71717a',
  accent: '#22d3ee',
  accentDim: '#0e7490',
  green: '#4ade80',
  red: '#f87171',
  orange: '#fb923c',
  yellow: '#facc15',
} as const

export const FONTS = `
  font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', ui-monospace, monospace;
`

export const RESET = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    ${FONTS}
    background: ${COLORS.bg};
    color: ${COLORS.text};
    line-height: 1.5;
    font-size: 14px;
    min-height: 100vh;
  }
  a { color: ${COLORS.accent}; text-decoration: none; }
  a:hover { text-decoration: underline; }
  img { max-width: 100%; display: block; }
`

export const BUNGALOW_CSS = `
  ${RESET}
  html, body { height: 100%; overflow: hidden; }

  /* ── App shell grid ── */
  .shell {
    display: grid;
    height: 100vh; height: 100dvh;
    grid-template-rows: 48px 40px 1fr 32px;
    grid-template-areas: "topbar" "tabs" "content" "banner";
  }

  /* ── Top bar ── */
  .topbar {
    grid-area: topbar;
    display: flex; align-items: center;
    padding: 0 16px; gap: 10px;
    border-bottom: 1px solid ${COLORS.border};
    background: ${COLORS.surface};
    min-width: 0;
  }
  .topbar-logo {
    color: ${COLORS.accent}; font-weight: 700; font-size: 13px;
    letter-spacing: 1.5px; white-space: nowrap; flex-shrink: 0;
  }
  .topbar-logo:hover { text-decoration: none; }
  .topbar-token {
    display: flex; align-items: center; gap: 8px;
    min-width: 0; overflow: hidden;
  }
  .topbar-token-img { width: 22px; height: 22px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
  .topbar-token-ticker { color: ${COLORS.text}; font-weight: 700; font-size: 14px; white-space: nowrap; }
  .topbar-token-price { color: ${COLORS.accent}; font-weight: 600; font-size: 12px; white-space: nowrap; }
  .topbar-token-name {
    font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    color: ${COLORS.textMuted};
  }
  .topbar-ca {
    display: flex; align-items: center; gap: 4px;
    font-size: 11px; color: ${COLORS.textMuted};
    cursor: pointer; padding: 2px 6px; border-radius: 3px;
    border: 1px solid ${COLORS.border}; white-space: nowrap;
    transition: border-color 0.15s;
  }
  .topbar-wallet {
    font-size: 11px; color: ${COLORS.textMuted};
    padding: 2px 8px; border-radius: 3px;
    border: 1px solid ${COLORS.border}; white-space: nowrap;
  }
  .topbar-wallet:empty { display: none; }
  .topbar-ca:hover { border-color: ${COLORS.accent}; color: ${COLORS.accent}; }
  .topbar-ca.copied { border-color: ${COLORS.green}; color: ${COLORS.green}; }
  .topbar-chain {
    display: flex; align-items: center; flex-shrink: 0;
  }
  .chain-icon { width: 16px; height: 16px; flex-shrink: 0; }
  .topbar-right {
    margin-left: auto; display: flex; align-items: center; gap: 8px;
    flex-shrink: 0;
  }
  #auth-root { display: flex; align-items: center; }
  .auth-btn {
    background: ${COLORS.accent}; color: ${COLORS.bg};
    border: none; padding: 5px 14px; border-radius: 4px;
    font-size: 12px; font-weight: 600; font-family: inherit;
    cursor: pointer; white-space: nowrap;
  }
  .auth-btn:hover { opacity: 0.9; }
  .auth-user {
    display: flex; align-items: center; gap: 6px;
    font-size: 12px; color: ${COLORS.text};
  }
  .auth-user img {
    width: 22px; height: 22px; border-radius: 50%;
    border: 1px solid ${COLORS.border};
  }
  .auth-balance { color: ${COLORS.green}; font-size: 11px; font-weight: 600; }

  /* ── Tab bar ── */
  .tab-bar {
    grid-area: tabs;
    display: flex; align-items: stretch;
    background: ${COLORS.surface};
    border-bottom: 1px solid ${COLORS.border};
    overflow-x: auto; -webkit-overflow-scrolling: touch;
  }
  .tab-bar::-webkit-scrollbar { display: none; }
  @media (min-width: 768px) {
    .tab-bar {
      padding-left: 16px;
    }
  }
  .tab-btn {
    flex: 1; display: flex; align-items: center; justify-content: center;
    padding: 0 12px; min-width: 0; white-space: nowrap;
    color: ${COLORS.textMuted}; font-size: 12px; font-weight: 500;
    cursor: pointer; border: none; background: none; font-family: inherit;
    border-bottom: 2px solid transparent;
    transition: color 0.15s, border-color 0.15s;
  }
  .tab-btn:hover { color: ${COLORS.text}; }
  .tab-btn.active { color: ${COLORS.accent}; border-bottom-color: ${COLORS.accent}; }
  @media (min-width: 768px) {
    .tab-btn { flex: none; padding: 0 18px; }
  }

  /* ── Tab panels ── */
  .tab-content {
    grid-area: content;
    overflow: hidden; position: relative;
  }
  .tab-panel {
    display: none; position: absolute; inset: 0;
    flex-direction: column; overflow: hidden;
  }
  .tab-panel.active { display: flex; }

  /* ── Activity bar ── */
  .activity-bar {
    grid-area: activity;
    display: flex; align-items: center;
    background: ${COLORS.surface};
    border-top: 1px solid ${COLORS.border};
    padding: 0 12px; gap: 12px;
    overflow: hidden; font-size: 11px;
  }
  @media (min-width: 768px) {
    .activity-bar { border-top: 1px solid ${COLORS.border}; }
  }
  .recents {
    display: none; align-items: center; gap: 4px; flex-shrink: 0;
  }
  @media (min-width: 768px) { .recents { display: flex; } }
  .recent-pill {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 2px 8px; border-radius: 3px;
    background: ${COLORS.bg}; border: 1px solid ${COLORS.border};
    color: ${COLORS.textMuted}; font-size: 10px; white-space: nowrap;
    text-decoration: none;
  }
  .recent-pill:hover { border-color: ${COLORS.accent}; color: ${COLORS.accent}; text-decoration: none; }
  .activity-ticker {
    flex: 1; overflow: hidden; white-space: nowrap;
    color: ${COLORS.textMuted};
  }
  .activity-ticker span { margin-right: 24px; }
  .activity-ticker .evt-post { color: ${COLORS.accent}; }
  .activity-ticker .evt-scan { color: ${COLORS.green}; }

  /* ── Scrollable content panels ── */
  .panel-scroll {
    flex: 1; overflow-y: auto; padding: 24px 16px;
  }
  .panel-scroll::-webkit-scrollbar { width: 6px; }
  .panel-scroll::-webkit-scrollbar-track { background: transparent; }
  .panel-scroll::-webkit-scrollbar-thumb { background: ${COLORS.border}; border-radius: 3px; }
  .panel-inner { max-width: 680px; margin: 0 auto; width: 100%; }

  /* ── Home tab ── */
  .home-frame {
    flex: 1; width: 100%; border: none; background: #fff;
  }
  .unclaimed-cta {
    flex: 1; display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    text-align: center; padding: 40px 20px;
  }
  .unclaimed-cta p { color: ${COLORS.textMuted}; font-size: 14px; margin-bottom: 12px; }
  .cta-link {
    display: inline-block; background: ${COLORS.accent}; color: ${COLORS.bg};
    padding: 10px 24px; border-radius: 6px; font-weight: 600; font-size: 13px;
    margin-top: 8px;
  }
  .cta-link:hover { opacity: 0.9; text-decoration: none; }
  .claim-btn {
    cursor: pointer; border: none; text-align: center;
    font-family: inherit;
  }
  .claim-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .claim-status {
    font-size: 12px; text-align: center; min-height: 20px; margin-top: 8px;
  }
  .claim-status.error { color: ${COLORS.red}; }
  .claim-status.success { color: ${COLORS.green}; }

  /* ── Market strip ── */
  .market-strip {
    display: flex; gap: 1px; background: ${COLORS.border};
    border-bottom: 1px solid ${COLORS.border}; flex-shrink: 0;
  }
  .market-item {
    flex: 1; background: ${COLORS.surface}; padding: 8px 12px;
    text-align: center; min-width: 0;
  }
  .market-item .label {
    font-size: 9px; text-transform: uppercase; letter-spacing: 1px;
    color: ${COLORS.textMuted}; margin-bottom: 2px;
  }
  .market-item .value { font-size: 13px; font-weight: 600; color: ${COLORS.text}; }

  /* ── Token links bar ── */
  .token-links {
    display: flex; gap: 8px; flex-wrap: wrap;
    padding: 10px 16px; border-top: 1px solid ${COLORS.border};
    background: ${COLORS.surface}; flex-shrink: 0;
  }
  .token-links a {
    display: flex; align-items: center; gap: 5px;
    color: ${COLORS.textMuted}; font-size: 11px;
    padding: 4px 10px; border-radius: 4px;
    border: 1px solid ${COLORS.border};
    transition: border-color 0.15s;
  }
  .token-links a:hover { border-color: ${COLORS.accent}; color: ${COLORS.accent}; text-decoration: none; }

  /* ── Chart tab ── */
  .chart-layout { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .chart-frame {
    flex: 1; width: 100%; border: none; min-height: 0;
  }

  /* ── Holders table ── */
  .holders-table { width: 100%; border-collapse: collapse; }
  .holders-table th {
    text-align: left; font-size: 10px; text-transform: uppercase;
    letter-spacing: 1px; color: ${COLORS.textMuted}; padding: 8px 10px;
    border-bottom: 1px solid ${COLORS.border};
    background: ${COLORS.bg};
  }
  .holders-table td {
    padding: 10px; border-bottom: 1px solid ${COLORS.border};
    font-size: 13px; color: ${COLORS.text};
  }
  .holders-table tr:hover td { background: ${COLORS.surfaceHover}; }
  .holders-table .rank { color: ${COLORS.textMuted}; width: 36px; }
  .holders-table .heat { color: ${COLORS.textMuted}; font-weight: 600; text-align: right; }
  .holder-identity { display: flex; align-items: center; gap: 8px; }
  .holder-pfp { width: 22px; height: 22px; border-radius: 50%; }
  .holder-username { color: ${COLORS.accent}; font-size: 13px; }
  .holder-wallet { color: ${COLORS.textMuted}; font-size: 13px; }
  .arkham-holder-link {
    display: inline-flex; align-items: center;
    color: ${COLORS.textMuted}; margin-left: 6px;
    opacity: 0.4; transition: opacity 0.15s, color 0.15s;
    vertical-align: middle;
  }
  .arkham-holder-link:hover { opacity: 1; color: ${COLORS.accent}; text-decoration: none; }
  .holder-row:hover .arkham-holder-link { opacity: 0.7; }
  .holder-count {
    color: ${COLORS.textMuted}; font-size: 12px; margin-bottom: 16px;
  }
  .scan-cta {
    text-align: center; padding: 60px 20px;
  }
  .scan-cta p { color: ${COLORS.textMuted}; font-size: 14px; margin-bottom: 16px; }
  .scan-progress {
    text-align: center; padding: 48px 20px;
  }
  .scan-progress-phase {
    font-size: 15px; font-weight: 600; color: ${COLORS.text};
    margin-bottom: 4px;
  }
  .scan-progress-detail {
    font-size: 12px; color: ${COLORS.textMuted};
    margin-bottom: 16px;
  }
  .scan-progress-bar {
    width: 100%; max-width: 260px; height: 4px;
    background: ${COLORS.border}; border-radius: 2px;
    margin: 0 auto 12px; overflow: hidden;
  }
  .scan-progress-fill {
    height: 100%; background: ${COLORS.accent};
    border-radius: 2px; transition: width 0.6s ease;
  }
  .scan-progress-pct {
    font-size: 11px; color: ${COLORS.textMuted};
    font-variant-numeric: tabular-nums;
  }
  .scan-progress-done {
    font-size: 16px; font-weight: 700; color: ${COLORS.green};
    margin-bottom: 4px;
  }
  .scan-logs {
    max-height: 180px; overflow-y: auto;
    margin: 16px auto 0; max-width: 360px;
    text-align: left; width: 100%;
  }
  .scan-logs::-webkit-scrollbar { width: 4px; }
  .scan-logs::-webkit-scrollbar-track { background: transparent; }
  .scan-logs::-webkit-scrollbar-thumb { background: ${COLORS.border}; border-radius: 2px; }
  .scan-log-entry {
    font-size: 12px; color: ${COLORS.textMuted}; padding: 3px 0;
    animation: logFadeIn 0.3s ease;
    border-bottom: 1px solid ${COLORS.border};
  }
  .scan-log-entry:last-child { color: ${COLORS.text}; font-weight: 500; }
  @keyframes logFadeIn {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @media (max-width: 767px) {
    .scan-progress { padding: 24px 12px; }
    .scan-logs { max-width: 100%; padding: 0 4px; max-height: 160px; }
    .scan-log-entry { font-size: 11px; padding: 2px 0; }
  }
  .scan-btn {
    display: inline-block; background: ${COLORS.accent}; color: ${COLORS.bg};
    padding: 10px 24px; border-radius: 6px; font-weight: 600; font-size: 13px;
    border: none; cursor: pointer; font-family: inherit;
  }
  .scan-btn:hover { opacity: 0.9; }

  /* ── Heat tab ── */
  .heat-section { margin-bottom: 32px; }
  .heat-section h3 {
    font-size: 14px; font-weight: 600; color: ${COLORS.text};
    margin-bottom: 16px;
  }
  .tier-bars { display: flex; flex-direction: column; gap: 10px; }
  .tier-row {
    display: flex; align-items: center; gap: 12px;
    cursor: pointer; padding: 4px 0; border-radius: 4px;
    transition: background 0.15s;
  }
  .tier-row:hover { background: ${COLORS.surfaceHover}; }
  .tier-row.active {
    background: ${COLORS.surfaceHover};
    outline: 1px solid ${COLORS.accent};
    outline-offset: 2px;
  }
  .tier-label {
    width: 80px; font-size: 12px; color: ${COLORS.textMuted};
    text-align: right; flex-shrink: 0;
  }
  .tier-bar-wrap {
    flex: 1; height: 24px; background: ${COLORS.surface};
    border-radius: 4px; border: 1px solid ${COLORS.border};
    position: relative; overflow: hidden;
  }
  .tier-bar {
    height: 100%; border-radius: 3px; transition: width 0.6s ease;
    min-width: 0;
  }
  .tier-bar.elder { background: ${COLORS.orange}; }
  .tier-bar.builder { background: ${COLORS.yellow}; }
  .tier-bar.resident { background: ${COLORS.green}; }
  .tier-bar.observer { background: ${COLORS.accent}; }
  .tier-bar.drifter { background: ${COLORS.textMuted}; }
  .tier-count {
    width: 40px; font-size: 12px; color: ${COLORS.text};
    text-align: right; flex-shrink: 0; font-weight: 600;
  }
  .heat-stats {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 12px;
  }
  .heat-stat {
    background: ${COLORS.surface}; border: 1px solid ${COLORS.border};
    border-radius: 6px; padding: 14px 16px; text-align: center;
  }
  .heat-stat .label {
    font-size: 10px; text-transform: uppercase; letter-spacing: 1px;
    color: ${COLORS.textMuted}; margin-bottom: 4px;
  }
  .heat-stat .value { font-size: 18px; font-weight: 700; color: ${COLORS.text}; }
  .heat-explainer {
    background: ${COLORS.surface}; border: 1px solid ${COLORS.border};
    border-radius: 6px; padding: 16px; font-size: 12px;
    color: ${COLORS.textMuted}; line-height: 1.7;
  }
  .heat-explainer code {
    background: ${COLORS.bg}; padding: 1px 5px; border-radius: 3px;
    color: ${COLORS.accent}; font-size: 11px;
  }

  /* ── Wall / bulletin ── */
  .bulletin-post {
    background: ${COLORS.surface}; border: 1px solid ${COLORS.border};
    border-radius: 6px; padding: 14px 16px; margin-bottom: 8px;
  }
  .bulletin-meta {
    display: flex; align-items: center; gap: 8px;
    font-size: 11px; color: ${COLORS.textMuted}; margin-bottom: 6px;
  }
  .bulletin-meta .username { color: ${COLORS.accent}; }
  .bulletin-content {
    font-size: 13px; color: ${COLORS.text};
    white-space: pre-wrap; word-break: break-word;
  }
  .bulletin-empty {
    color: ${COLORS.textMuted}; font-size: 14px;
    text-align: center; padding: 60px 20px;
  }

  /* ── Tier filter pills ── */
  .tier-filter {
    display: flex; gap: 6px; flex-wrap: wrap;
    margin-bottom: 16px;
  }
  .tier-filter-btn {
    display: inline-flex; align-items: center; justify-content: center;
    padding: 5px 14px; border-radius: 16px;
    font-size: 12px; font-weight: 500; font-family: inherit;
    background: ${COLORS.surface}; color: ${COLORS.textMuted};
    border: 1px solid ${COLORS.border}; cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
  }
  .tier-filter-btn:hover { border-color: ${COLORS.accent}; color: ${COLORS.text}; }
  .tier-filter-btn.active {
    border-color: ${COLORS.accent}; color: ${COLORS.accent};
    background: ${COLORS.bg};
  }

  /* ── Holder links ── */
  .holder-link {
    color: inherit; text-decoration: none; display: contents;
  }
  .holder-link:hover { text-decoration: none; }
  .holders-table tr.holder-row { cursor: pointer; }
  .holders-table tr.holder-row:hover td { background: ${COLORS.surfaceHover}; }

  /* ── Loading indicator ── */
  .holders-loading {
    text-align: center; padding: 24px; color: ${COLORS.textMuted};
    font-size: 13px;
  }
  .holders-load-more {
    text-align: center; padding: 16px; color: ${COLORS.textMuted};
    font-size: 12px;
  }

  /* ── Wallet choice UI ── */
  .wallet-choice {
    display: flex; gap: 10px; margin-top: 12px;
    justify-content: center; flex-wrap: wrap;
  }
  .wallet-choice-btn {
    display: inline-flex; align-items: center; gap: 8px;
    background: ${COLORS.surface}; color: ${COLORS.text};
    border: 1px solid ${COLORS.border}; border-radius: 6px;
    padding: 10px 20px; font-size: 13px; font-weight: 500;
    font-family: inherit; cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
  }
  .wallet-choice-btn:hover {
    border-color: ${COLORS.accent}; background: ${COLORS.surfaceHover};
  }
  .wallet-choice-icon { font-size: 16px; }

  /* ── Holder balance chart ── */
  .holder-chart-wrap {
    display: none;
    flex-shrink: 0; width: 100%; position: relative;
    background: ${COLORS.bg}; border-bottom: 1px solid ${COLORS.border};
  }
  .holder-chart-wrap.visible { display: block; }
  .holder-chart-wrap canvas {
    width: 100%; display: block;
  }
  /* Desktop: side-by-side layout when chart is visible */
  @media (min-width: 768px) {
    #panel-holders.has-chart {
      flex-direction: row;
    }
    #panel-holders.has-chart .holder-chart-wrap.visible {
      width: 50%; flex-shrink: 0; border-bottom: none;
      border-left: 1px solid ${COLORS.border};
      order: 1; display: flex; flex-direction: column;
      overflow-y: auto;
    }
    #panel-holders.has-chart .panel-scroll {
      width: 50%; order: 0;
    }
  }
  .holder-chart-legend {
    display: flex; gap: 12px; flex-wrap: wrap;
    padding: 8px 16px; font-size: 11px; color: ${COLORS.textMuted};
    border-top: 1px solid ${COLORS.border}; background: ${COLORS.surface};
  }
  .holder-chart-legend-item {
    display: flex; align-items: center; gap: 5px; cursor: pointer;
  }
  .holder-chart-legend-dot {
    width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
  }
  .holders-table td.heat {
    cursor: pointer; transition: color 0.15s, background 0.15s;
    user-select: none; -webkit-user-select: none;
  }
  .holders-table td.heat:hover { color: ${COLORS.accent}; background: ${COLORS.surfaceHover}; }
  .holders-table td.heat.selected {
    font-weight: 700; border-radius: 3px;
  }
  .heat-spinner {
    display: inline-block; width: 14px; height: 14px;
    border: 2px solid currentColor; border-top-color: transparent;
    border-radius: 50%; animation: heat-spin 0.6s linear infinite;
    vertical-align: middle;
  }
  @keyframes heat-spin { to { transform: rotate(360deg); } }

  /* ── Holder chart skeleton ── */
  .holder-chart-skeleton {
    width: 100%; aspect-ratio: 2; display: flex;
    flex-direction: column; justify-content: flex-end;
    padding: 40px 60px 40px 60px; gap: 8px;
    background: ${COLORS.bg}; position: relative;
    overflow: hidden;
  }
  .holder-chart-skeleton::after {
    content: ''; position: absolute; inset: 0;
    background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.03) 50%, transparent 100%);
    animation: shimmer 1.5s infinite;
  }
  @keyframes shimmer {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
  }
  .skeleton-bar {
    height: 3px; border-radius: 2px;
    background: ${COLORS.border}; opacity: 0.5;
  }

  /* ── Holder chart search ── */
  .holder-chart-search-btn {
    margin-left: auto; background: none; border: 1px solid ${COLORS.border};
    color: ${COLORS.textMuted}; padding: 2px 8px; border-radius: 4px;
    font-size: 12px; cursor: pointer; font-family: inherit;
    display: flex; align-items: center; gap: 4px;
    transition: border-color 0.15s, color 0.15s;
    flex-shrink: 0;
  }
  .holder-chart-search-btn:hover { border-color: ${COLORS.accent}; color: ${COLORS.accent}; }
  .holder-search-overlay {
    display: none; position: absolute; top: 0; left: 0; right: 0;
    background: ${COLORS.surface}; border-bottom: 1px solid ${COLORS.border};
    padding: 8px 16px; z-index: 5;
    flex-direction: row; align-items: center; gap: 8px;
  }
  .holder-search-overlay.active { display: flex; }
  .holder-search-input {
    flex: 1; min-width: 0; background: ${COLORS.bg};
    border: 1px solid ${COLORS.border}; color: ${COLORS.text};
    padding: 6px 10px; font-size: 16px; font-family: inherit;
    border-radius: 4px; outline: none;
  }
  .holder-search-input:focus { border-color: ${COLORS.accent}; }
  .holder-search-input::placeholder { color: ${COLORS.textMuted}; }
  .holder-search-go {
    background: ${COLORS.accent}; color: ${COLORS.bg};
    border: none; padding: 6px 14px; border-radius: 4px;
    font-size: 12px; font-weight: 600; font-family: inherit;
    cursor: pointer; white-space: nowrap;
  }
  .holder-search-go:hover { opacity: 0.9; }
  .holder-search-close {
    background: none; border: none; color: ${COLORS.textMuted};
    font-size: 16px; cursor: pointer; padding: 2px 4px;
  }
  .holder-search-close:hover { color: ${COLORS.text}; }
  .holder-search-msg {
    font-size: 11px; color: ${COLORS.red};
    padding: 0 16px 6px; display: none;
    background: ${COLORS.surface};
  }
  .holder-search-msg.active { display: block; }

  /* ── Beta banner ── */
  .beta-banner {
    grid-area: banner;
    display: flex; align-items: center; justify-content: center;
    background: ${COLORS.surface}; border-top: 1px solid ${COLORS.border};
    color: ${COLORS.textMuted}; font-size: 11px;
    text-decoration: none; letter-spacing: 0.5px;
    transition: color 0.15s;
  }
  .beta-banner:hover { color: ${COLORS.accent}; text-decoration: none; }

  /* ── Timeline / Activity tab ── */
  .timeline-container {
    flex: 1; display: flex; flex-direction: column;
    padding: 16px; overflow: hidden;
  }
  .timeline-header {
    text-align: center; margin-bottom: 12px; flex-shrink: 0;
  }
  .timeline-title {
    font-size: 14px; font-weight: 600; color: ${COLORS.text};
    margin-bottom: 2px;
  }
  .timeline-subtitle {
    font-size: 11px; color: ${COLORS.textMuted};
  }
  .timeline-canvas-wrap {
    flex: 1; position: relative; min-height: 0;
  }
  .timeline-canvas-wrap canvas {
    width: 100%; height: 100%; display: block;
  }
  .timeline-loading {
    flex: 1; display: flex; align-items: center; justify-content: center;
    color: ${COLORS.textMuted}; font-size: 13px;
  }
  .timeline-tooltip {
    position: absolute; pointer-events: none;
    background: ${COLORS.surface}; border: 1px solid ${COLORS.border};
    border-radius: 4px; padding: 6px 10px;
    font-size: 11px; color: ${COLORS.text};
    white-space: nowrap; z-index: 10;
    display: none;
  }
  .timeline-empty {
    flex: 1; display: flex; align-items: center; justify-content: center;
    color: ${COLORS.textMuted}; font-size: 14px;
    text-align: center; padding: 20px;
  }
`

export const USER_PAGE_CSS = `
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

  .wrap { max-width: 620px; margin: 0 auto; padding: 32px 16px; }

  .user-header {
    display: flex; align-items: center; gap: 16px;
    margin-bottom: 24px; flex-wrap: wrap;
  }
  .user-pfp {
    width: 48px; height: 48px; border-radius: 50%;
    border: 2px solid ${COLORS.border}; object-fit: cover;
  }
  .user-info { flex: 1; min-width: 0; }
  .user-name { font-size: 16px; font-weight: 700; color: ${COLORS.text}; }
  .user-wallet-line {
    display: flex; align-items: center; gap: 6px;
    font-size: 12px; color: ${COLORS.textMuted}; margin-top: 2px;
  }
  .user-wallet-primary {
    font-size: 16px; font-weight: 700; color: ${COLORS.text}; margin-top: 0;
  }
  .wallet-full { display: none; word-break: break-all; }
  .wallet-short { display: inline; }
  @media (min-width: 600px) {
    .wallet-full { display: inline; }
    .wallet-short { display: none; }
  }
  .copy-btn {
    background: none; border: 1px solid ${COLORS.border};
    color: ${COLORS.textMuted}; padding: 1px 6px; border-radius: 3px;
    font-size: 10px; cursor: pointer; font-family: inherit;
  }
  .copy-btn:hover { border-color: ${COLORS.accent}; color: ${COLORS.accent}; }
  .arkham-link {
    display: inline-flex; align-items: center;
    color: ${COLORS.textMuted}; padding: 1px 6px; border-radius: 3px;
    border: 1px solid ${COLORS.border}; transition: border-color 0.15s, color 0.15s;
  }
  .arkham-link:hover { border-color: ${COLORS.accent}; color: ${COLORS.accent}; text-decoration: none; }

  .badge {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 4px 12px; border-radius: 4px;
    background: ${COLORS.surface}; border: 1px solid ${COLORS.border};
    font-size: 12px; font-weight: 600;
  }
  .badge-heat { color: ${COLORS.orange}; }
  .badge-tier { color: ${COLORS.accent}; }

  .fc-card {
    display: flex; align-items: center; gap: 10px;
    background: ${COLORS.surface}; border: 1px solid ${COLORS.border};
    border-radius: 6px; padding: 12px 16px; margin-bottom: 24px;
  }
  .fc-pfp {
    width: 36px; height: 36px; border-radius: 50%;
    border: 1px solid ${COLORS.border};
  }
  .fc-username { color: ${COLORS.accent}; font-size: 13px; }
  .fc-display { color: ${COLORS.text}; font-size: 13px; }

  .section-title {
    font-size: 14px; font-weight: 600; color: ${COLORS.text};
    margin-bottom: 12px; margin-top: 24px;
  }

  .token-table { width: 100%; border-collapse: collapse; }
  .token-table th {
    text-align: left; font-size: 10px; text-transform: uppercase;
    letter-spacing: 1px; color: ${COLORS.textMuted}; padding: 8px 10px;
    border-bottom: 1px solid ${COLORS.border};
  }
  .token-table td {
    padding: 10px; border-bottom: 1px solid ${COLORS.border};
    font-size: 13px; color: ${COLORS.text};
  }
  .token-table tr:hover td { background: ${COLORS.surfaceHover}; }
  .token-table a { color: inherit; text-decoration: none; }
  .token-table a:hover { color: ${COLORS.accent}; }
  .chain-icon { width: 14px; height: 14px; flex-shrink: 0; vertical-align: middle; }
  .chain-col { width: 40px; text-align: center; }
  .ca-col { color: ${COLORS.textMuted}; font-size: 11px; }
  .ca-col a { color: ${COLORS.textMuted}; }
  .ca-col a:hover { color: ${COLORS.accent}; }
  .heat-val { color: ${COLORS.orange}; font-weight: 600; text-align: right; }
  .badge-heat { cursor: pointer; transition: border-color 0.15s; }
  .badge-heat:hover { border-color: ${COLORS.accent}; }

  /* ── Modal ── */
  .modal-overlay {
    position: fixed; inset: 0; z-index: 1000;
    background: rgba(0,0,0,0.7);
    display: flex; align-items: center; justify-content: center;
    padding: 16px;
  }
  .modal-box {
    background: ${COLORS.surface}; border: 1px solid ${COLORS.border};
    border-radius: 8px; max-width: 480px; width: 100%;
    max-height: 80vh; overflow-y: auto;
  }
  .modal-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 16px; border-bottom: 1px solid ${COLORS.border};
  }
  .modal-title { font-size: 14px; font-weight: 600; color: ${COLORS.text}; }
  .modal-close {
    background: none; border: none; color: ${COLORS.textMuted};
    font-size: 16px; cursor: pointer; padding: 4px;
  }
  .modal-close:hover { color: ${COLORS.text}; }
  .modal-body { padding: 16px; }
  .modal-total { font-size: 14px; color: ${COLORS.orange}; margin-bottom: 8px; }
  .modal-desc { font-size: 12px; color: ${COLORS.textMuted}; margin-bottom: 16px; line-height: 1.5; }
  .modal-table { width: 100%; border-collapse: collapse; }
  .modal-table th {
    text-align: left; font-size: 10px; text-transform: uppercase;
    letter-spacing: 1px; color: ${COLORS.textMuted}; padding: 6px 8px;
    border-bottom: 1px solid ${COLORS.border};
  }
  .modal-table td {
    padding: 8px; border-bottom: 1px solid ${COLORS.border};
    font-size: 13px; color: ${COLORS.text};
  }

  .empty-state {
    color: ${COLORS.textMuted}; font-size: 14px;
    text-align: center; padding: 40px 20px;
  }

  /* ── Aggregate toggle ── */
  .aggregate-toggle {
    display: flex; gap: 6px; margin-bottom: 12px;
  }
  .toggle-btn {
    display: inline-flex; align-items: center; justify-content: center;
    padding: 5px 14px; border-radius: 16px;
    font-size: 12px; font-weight: 500; font-family: inherit;
    background: ${COLORS.surface}; color: ${COLORS.textMuted};
    border: 1px solid ${COLORS.border}; cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
  }
  .toggle-btn:hover { border-color: ${COLORS.accent}; color: ${COLORS.text}; }
  .toggle-btn.active {
    border-color: ${COLORS.accent}; color: ${COLORS.accent};
    background: ${COLORS.bg};
  }

  /* ── Wallet badge (aggregated view) ── */
  .wallet-badge {
    display: inline-block;
    font-size: 10px; color: ${COLORS.textMuted};
    background: ${COLORS.bg}; border: 1px solid ${COLORS.border};
    padding: 1px 6px; border-radius: 3px; margin-right: 4px;
  }

  /* ── Scan another token ── */
  .scan-form-group { display: flex; gap: 8px; margin-bottom: 8px; }
  .scan-form-group input[type="text"] {
    flex: 1; min-width: 0;
    background: ${COLORS.surface};
    border: 1px solid ${COLORS.border};
    color: ${COLORS.text};
    padding: 12px 14px; font-size: 13px;
    font-family: inherit; border-radius: 6px;
    outline: none; -webkit-appearance: none;
  }
  .scan-form-group input[type="text"]:focus { border-color: ${COLORS.accent}; }
  .scan-form-group input[type="text"]::placeholder { color: ${COLORS.textMuted}; }
  .scan-paste-btn {
    background: ${COLORS.accent}; color: ${COLORS.bg};
    border: none; padding: 12px 20px; font-size: 13px;
    font-weight: 600; font-family: inherit; border-radius: 6px;
    cursor: pointer; white-space: nowrap;
    display: flex; align-items: center; gap: 6px;
    transition: opacity 0.15s;
  }
  .scan-paste-btn:hover { opacity: 0.9; }
  .scan-paste-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .scan-status-msg {
    font-size: 12px; min-height: 20px; margin-bottom: 4px;
    transition: color 0.15s;
  }
  .scan-status-msg.error { color: ${COLORS.red}; }
  .scan-status-msg.checking { color: ${COLORS.textMuted}; }
  .scan-status-msg.success { color: ${COLORS.green}; }
  .scan-hint { color: ${COLORS.textMuted}; font-size: 11px; }
  .scan-another { padding-bottom: 48px; }

  /* ── Farcaster card as link ── */
  .fc-card:hover { border-color: ${COLORS.accent}; }

  /* ── Beta banner ── */
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
`
