// ecosystem.config.js
// PM2 process configuration for Jungle Bay Island
// This file lives at the root of FINAL/
// Usage:
//   pm2 start ecosystem.config.js        ← first time
//   pm2 reload ecosystem.config.js       ← graceful reload (zero downtime)
//   pm2 restart ecosystem.config.js      ← hard restart (only if graceful fails)

module.exports = {
  apps: [
    {
      name: "jbi",
      cwd: "./backend",
      script: "bun",
      args: "--env-file=.env.local src/index.ts",

      // ─── Graceful shutdown ─────────────────────────────────────────────────
      // How long PM2 waits for in-flight requests to finish before force-killing.
      // 15 seconds is generous. Most requests finish in < 1s.
      // Blockchain verification calls (claim flow) can take up to 5-8s.
      kill_timeout: 15000,

      // Tell PM2 the app is ready only after it sends process.send('ready')
      // This prevents traffic from being routed to a half-started process.
      wait_ready: true,

      // How long to wait for ready signal before giving up (ms)
      listen_timeout: 10000,

      // ─── Crash recovery ───────────────────────────────────────────────────
      // Restart automatically if the process crashes
      autorestart: true,

      // Wait 2s before restarting after a crash (prevents restart loops)
      restart_delay: 2000,

      // Stop trying to restart after 10 consecutive crashes in 30 seconds
      max_restarts: 10,
      min_uptime: "30s",

      // ─── Logging ──────────────────────────────────────────────────────────
      out_file: "./logs/out.log",
      error_file: "./logs/error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,

      // ─── Environment ──────────────────────────────────────────────────────
      // env vars are loaded from .env.local via the --env-file flag above.
      // Add any process-level env vars here if needed.
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
