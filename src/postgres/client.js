/** Postgres connection pool, schema bootstrap, and health probe. */
import pg from "pg";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { config } from "../config.js";
const __dirname = dirname(fileURLToPath(import.meta.url));
let pool = null;
function getPool() {
  if (!pool) {
    pool = new pg.Pool({ connectionString: config.postgres.url });
  }
  return pool;
}
async function initPostgres() {
  const schema = readFileSync(join(__dirname, "schema.sql"), "utf8");
  await getPool().query(schema);
}
async function closePostgres() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
async function probePostgres() {
  try {
    const client = new pg.Client({ connectionString: config.postgres.url });
    await client.connect();
    await client.query("SELECT 1");
    await client.end();
    return true;
  } catch {
    return false;
  }
}
export {
  closePostgres,
  getPool,
  initPostgres,
  probePostgres
};
