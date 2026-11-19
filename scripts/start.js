// zes-agent-hub — service entry point
//
// Boots the hub and records the outcome in the database so a failed start can
// be diagnosed from outside the host (Render, Cloudflare, a container).

import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = pathToFileURL(path.join(__dirname, '..', 'server', 'index.js')).href;

async function record(event, detail) {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    return;
  }

  try {
    const { Client } = await import('pg');
    const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });

    await client.connect();
    await client.query(
      'CREATE TABLE IF NOT EXISTS hub_boot_log (id SERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT NOW(), event TEXT NOT NULL, detail TEXT)',
    );
    await client.query('INSERT INTO hub_boot_log (event, detail) VALUES ($1, $2)', [event, detail ?? null]);
    await client.end();
  } catch (error) {
    console.error('[hub] could not record boot event:', error.message);
  }
}

process.on('uncaughtException', async (error) => {
  await record('uncaught_exception', `${error?.message}\n${error?.stack}`);
  console.error('[hub] uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', async (reason) => {
  await record('unhandled_rejection', String(reason?.stack || reason));
  console.error('[hub] unhandled rejection:', reason);
});

await record('boot_attempt', `pid=${process.pid} node=${process.version}`);

try {
  await import(ENTRY);
  await record('boot_ok', `pid=${process.pid} node=${process.version}`);
} catch (error) {
  await record('boot_failed', `${error?.message}\n${error?.stack}`);
  console.error('[hub] failed to start:', error);
  process.exit(1);
}
