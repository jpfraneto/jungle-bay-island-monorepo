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
    grid-template-rows: 48px 1fr 40px 44px;
    grid-template-areas: "topbar" "content" "activity" "tabs";
  }

  @media (min-width: 768px) {
    .shell {
      grid-template-rows: 48px 40px 1fr 40px;
      grid-template-areas: "topbar" "tabs" "content" "activity";
    }
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
  .topbar-token-img {
    width: 22px; height: 22px; border-radius: 50%;
    border: 1px solid ${COLORS.border}; object-fit: cover; flex-shrink: 0;
  }
  .topbar-token-name {
    font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .topbar-token-sym { color: ${COLORS.textMuted}; }
  .topbar-ca {
    display: none; align-items: center; gap: 4px;
    font-size: 11px; color: ${COLORS.textMuted};
    cursor: pointer; padding: 2px 6px; border-radius: 3px;
    border: 1px solid ${COLORS.border}; white-space: nowrap;
    transition: border-color 0.15s;
  }
  .topbar-ca:hover { border-color: ${COLORS.accent}; color: ${COLORS.accent}; }
  .topbar-ca.copied { border-color: ${COLORS.green}; color: ${COLORS.green}; }
  @media (min-width: 768px) { .topbar-ca { display: flex; } }
  .topbar-chain {
    font-size: 9px; text-transform: uppercase; letter-spacing: 1px;
    background: ${COLORS.bg}; color: ${COLORS.textMuted};
    padding: 2px 7px; border-radius: 3px; border: 1px solid ${COLORS.border};
    white-space: nowrap; flex-shrink: 0;
  }
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
    border-top: 1px solid ${COLORS.border};
    overflow-x: auto; -webkit-overflow-scrolling: touch;
  }
  .tab-bar::-webkit-scrollbar { display: none; }
  @media (min-width: 768px) {
    .tab-bar {
      border-top: none;
      border-bottom: 1px solid ${COLORS.border};
      padding-left: 16px;
    }
  }
  .tab-btn {
    flex: 1; display: flex; align-items: center; justify-content: center;
    padding: 0 12px; min-width: 0; white-space: nowrap;
    color: ${COLORS.textMuted}; font-size: 12px; font-weight: 500;
    cursor: pointer; border: none; background: none; font-family: inherit;
    border-top: 2px solid transparent;
    transition: color 0.15s, border-color 0.15s;
  }
  .tab-btn:hover { color: ${COLORS.text}; }
  .tab-btn.active { color: ${COLORS.accent}; border-top-color: ${COLORS.accent}; }
  @media (min-width: 768px) {
    .tab-btn {
      flex: none; padding: 0 18px;
      border-top: none; border-bottom: 2px solid transparent;
    }
    .tab-btn.active { border-bottom-color: ${COLORS.accent}; border-top-color: transparent; }
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
  .swap-placeholder {
    padding: 24px; text-align: center; color: ${COLORS.textMuted};
    border-top: 1px solid ${COLORS.border}; font-size: 13px;
    background: ${COLORS.surface};
  }
  @media (min-width: 768px) {
    .chart-layout { flex-direction: row; }
    .chart-frame { flex: 7; }
    .swap-placeholder { flex: 3; border-top: none; border-left: 1px solid ${COLORS.border}; }
  }

  /* ── Holders table ── */
  .holders-table { width: 100%; border-collapse: collapse; }
  .holders-table th {
    text-align: left; font-size: 10px; text-transform: uppercase;
    letter-spacing: 1px; color: ${COLORS.textMuted}; padding: 8px 10px;
    border-bottom: 1px solid ${COLORS.border};
    position: sticky; top: 0; background: ${COLORS.bg};
  }
  .holders-table td {
    padding: 10px; border-bottom: 1px solid ${COLORS.border};
    font-size: 13px; color: ${COLORS.text};
  }
  .holders-table tr:hover td { background: ${COLORS.surfaceHover}; }
  .holders-table .rank { color: ${COLORS.textMuted}; width: 36px; }
  .holders-table .heat { color: ${COLORS.orange}; font-weight: 600; text-align: right; }
  .holder-identity { display: flex; align-items: center; gap: 8px; }
  .holder-pfp { width: 22px; height: 22px; border-radius: 50%; }
  .holder-username { color: ${COLORS.accent}; font-size: 13px; }
  .holder-wallet { color: ${COLORS.textMuted}; font-size: 13px; }
  .holder-count {
    color: ${COLORS.textMuted}; font-size: 12px; margin-bottom: 16px;
  }
  .scan-cta {
    text-align: center; padding: 60px 20px;
  }
  .scan-cta p { color: ${COLORS.textMuted}; font-size: 14px; margin-bottom: 16px; }
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
  .copy-btn {
    background: none; border: 1px solid ${COLORS.border};
    color: ${COLORS.textMuted}; padding: 1px 6px; border-radius: 3px;
    font-size: 10px; cursor: pointer; font-family: inherit;
  }
  .copy-btn:hover { border-color: ${COLORS.accent}; color: ${COLORS.accent}; }

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
  .chain-badge {
    font-size: 9px; text-transform: uppercase; letter-spacing: 1px;
    background: ${COLORS.bg}; color: ${COLORS.textMuted};
    padding: 2px 6px; border-radius: 3px; border: 1px solid ${COLORS.border};
  }
  .heat-val { color: ${COLORS.orange}; font-weight: 600; text-align: right; }

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
`
