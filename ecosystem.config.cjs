module.exports = {
  apps: [
    {
      name: "1apply-web",
      cwd: "./apps/web",
      script: "npm",
      args: "run start",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
      },
      max_memory_restart: "800M",
    },
  ],
};
