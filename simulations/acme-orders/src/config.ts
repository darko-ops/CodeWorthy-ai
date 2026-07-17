// Runtime configuration. Defaults line up with docker-compose.yml so a fresh
// checkout works without a .env file.
export const config = {
  port: parseInt(process.env.PORT ?? "3000", 10),
  databaseUrl:
    process.env.DATABASE_URL ?? "postgres://acme:acme@localhost:5432/acme_orders",
};
