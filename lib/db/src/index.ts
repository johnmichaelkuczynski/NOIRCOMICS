import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// The PC server can run without database-backed features. Fail explicitly on
// database use, not on importing this package during server startup.
if (!process.env.DATABASE_URL) {
  const unavailable = (): never => {
    throw new Error("A database operation requires DATABASE_URL to be configured.");
  };
  pool.query = unavailable;
  pool.connect = unavailable;
}
export const db = drizzle(pool, { schema });

export * from "./schema";
