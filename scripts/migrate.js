// zes-agent-hub — apply database migrations
// Usage: npm run db:migrate

import { createDatabase, defaultDatabaseOptions, migrate } from '../server/lib/db/pool.js';

const db = await createDatabase(defaultDatabaseOptions());

try {
  const applied = await migrate(db);
  console.log(`Applied ${applied.length} migration(s): ${applied.join(', ')}`);
} finally {
  await db.close();
}
