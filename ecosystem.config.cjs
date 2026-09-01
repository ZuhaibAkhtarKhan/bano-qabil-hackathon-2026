module.exports = {
  apps: [
    {
      name: "1apply-web",
      cwd: "./apps/web",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      env: {
        NODE_ENV: "production",
      },
      max_memory_restart: "800M",
    },
  ],
};
