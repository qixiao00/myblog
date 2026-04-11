import postgres from "postgres";

let client: postgres.Sql | undefined;

export function getDb() {
  const connectionString = process.env.POSTGRES_URL;

  if (!connectionString) {
    throw new Error("POSTGRES_URL is missing. Run `vercel env pull .env.local` first.");
  }

  if (!client) {
    client = postgres(connectionString, {
      ssl: "require",
      max: 1,
    });
  }

  return client;
}
