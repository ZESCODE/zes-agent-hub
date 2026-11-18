// zes-agent-hub — database access
// PostgreSQL in production (DATABASE_URL), PGlite (real Postgres compiled to WASM)
// for local development and tests. Both expose the same { query, transaction } API.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '../../../migrations');

async function createPostgres(connectionString) {
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString });

  return {
    kind: 'postgres',
    async query(text, params = []) {
      const result = await pool.query(text, params);
      return { rows: result.rows, rowCount: result.rowCount };
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async transaction(fn) {
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        const result = await fn({
          async query(text, params = []) {
            const res = await client.query(text, params);
            return { rows: res.rows, rowCount: res.rowCount };
          },
        });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

async function createPGlite(dataDir) {
  const { PGlite } = await import('@electric-sql/pglite');

  if (dataDir) {
    /*
     * PGlite creates its data directory with a non-recursive mkdir, so a
     * nested path such as `.tmp/pglite-ci` fails unless the parents exist.
     */
    await fs.promises.mkdir(dataDir, { recursive: true });
  }

  const db = dataDir ? new PGlite(dataDir) : new PGlite();
  await db.waitReady;

  const run = async (text, params = []) => {
    const result = await db.query(text, params);
    return { rows: result.rows ?? [], rowCount: result.affectedRows ?? result.rows?.length ?? 0 };
  };

  return {
    kind: 'pglite',
    query: run,
    async exec(sql) {
      await db.exec(sql);
    },
    async transaction(fn) {
      await run('BEGIN');

      try {
        const result = await fn({ query: run });
        await run('COMMIT');
        return result;
      } catch (error) {
        await run('ROLLBACK');
        throw error;
      }
    },
    async close() {
      await db.close();
    },
  };
}

/**
 * Create a database handle.
 * @param {{connectionString?: string, dataDir?: string}} options
 */
export async function createDatabase(options = {}) {
  if (options.connectionString) {
    return createPostgres(options.connectionString);
  }

  return createPGlite(options.dataDir);
}

/**
 * Apply every pending migration in order.
 */
export async function migrate(db) {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const applied = [];

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

    if (typeof db.exec === 'function') {
      await db.exec(sql);
    } else {
      for (const statement of sql.split(';')) {
        const trimmed = statement.trim();

        if (trimmed) {
          await db.query(trimmed);
        }
      }
    }

    applied.push(file);
  }

  return applied;
}

export function defaultDatabaseOptions() {
  return {
    connectionString: process.env.DATABASE_URL || undefined,
    dataDir: process.env.PGLITE_DATA_DIR || undefined,
  };
}
