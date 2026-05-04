// PM2 ecosystem for the Geel claudecodeui fork.
//
// Caddy maps ide.geel.dev → :3335. This file binds the Express server there
// and points the working dir at the on-Oracle install with .git (so deploys
// can pull and rebuild). autorestart=true with a max-restart guardrail
// prevents the 38-crash zombie state we hit earlier.
module.exports = {
  apps: [
    {
      name: 'claudecodeui',
      script: 'server/index.js',
      cwd: '/home/ubuntu/projects/claudecodeui-ide',
      env: {
        NODE_ENV: 'production',
        SERVER_PORT: '3335',
        PORT: '3335',
        NERVE_CENTER_WS: 'ws://localhost:3333/ws/conductor',
      },
      autorestart: true,
      max_restarts: 50,
      restart_delay: 5000,
      exp_backoff_restart_delay: 2000,
      max_memory_restart: '1G',
      out_file: '/home/ubuntu/.pm2/logs/claudecodeui-out.log',
      error_file: '/home/ubuntu/.pm2/logs/claudecodeui-err.log',
      merge_logs: true,
      time: true,
    },
  ],
};
