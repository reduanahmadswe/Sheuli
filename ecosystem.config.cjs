module.exports = {
  apps: [
    {
      name: 'sheuli',
      script: 'server/index.js',
      cwd: __dirname,
      interpreter: 'node',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 20,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production'
      },
      error_file: 'logs/sheuli-error.log',
      out_file: 'logs/sheuli-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true
    }
  ]
};
