/**
 * PM2 Ecosystem Config
 * 
 * Usage:
 *   pm2 start ecosystem.config.js          # Start in cluster mode
 *   pm2 start ecosystem.config.js --env production
 *   pm2 save                                # Save process list
 *   pm2 startup                             # Auto-start on reboot
 *   pm2 monit                               # Monitor dashboard
 *   pm2 logs eixora-server                  # View logs
 */

module.exports = {
  apps: [
    {
      name: 'eixora-server',
      script: 'index.js',

      // Cluster mode — uses all available CPU cores
      // On a 2-core server this = 2 processes, 4-core = 4 processes
      instances: 'max',
      exec_mode: 'cluster',

      // Auto-restart on crash
      autorestart: true,
      watch: false, // Don't watch files in production

      // Memory limit — restart if process exceeds 512MB
      // (video processing can be memory-heavy)
      max_memory_restart: '512M',

      // Restart delay to avoid rapid crash loops
      restart_delay: 3000,
      max_restarts: 10,

      // Environment variables
      env: {
        NODE_ENV: 'development',
        PORT: 4000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 4000,
      },

      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      merge_logs: true,

      // Graceful shutdown — wait for in-flight requests to finish
      kill_timeout: 10000,
      listen_timeout: 8000,

      // Zero-downtime reload
      wait_ready: true,
    },
  ],
};
