module.exports = {
  apps: [
    {
      name: "berni-inventory",
      cwd: "/www/wwwroot/bonierp",
      script: "./node_modules/.bin/tsx",
      args: "src/server/index.ts",
      env: {
        NODE_ENV: "production",
        PORT: "3001",
        DATABASE_URL: "postgresql://bonierp:Bonierp@2026@localhost:5432/bonierp",
        BERNI_ADMIN_PASSWORD: "Admin@2026",
        BERNI_OPERATOR_PASSWORD: "Operator@2026",
        BERNI_OPERATION_PASSWORD: "Operation@2026",
        BERNI_PURCHASER_PASSWORD: "Purchaser@2026",
        BERNI_INBOUND_PASSWORD: "Inbound@2026",
        BERNI_OUTBOUND_PASSWORD: "Outbound@2026",
        BERNI_ALLOWED_ORIGINS: "http://39.108.125.91:3001,http://www.bonierp.com",
        PG_POOL_MAX: "10",
      },
    },
  ],
};
