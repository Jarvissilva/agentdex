module.exports = {
  apps: [
    {
      name: 'agentdex',
      cwd: __dirname,
      script: 'apps/server/dist/index.js',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 6001,
        AGENTDEX_ALLOWED_ORIGINS: 'https://agentdex.tailae2d54.ts.net',
      },
    },
  ],
};
