// zes-agent-hub — Council Runner (CLI wrapper)
// Logic lives in server/lib/council.js and is shared with POST /api/pipeline/council.

import { runCouncil } from '../server/lib/council.js';

async function main() {
  const prompt = process.argv[2];

  if (!prompt) {
    console.error('Usage: node scripts/council-run.js "<user prompt>"');
    process.exit(1);
  }

  console.log('🏛️  zes-agent-hub — Council Orchestration');
  console.log('==========================================');

  const result = await runCouncil(prompt, { logger: (line) => console.log(`   ${line}`) });

  console.log('==========================================');
  console.log('✅ Council orchestration complete');
  console.log(`   Orchestrator: ${result.orchestrator}`);
  console.log(`   Council: ${result.council.join(', ')}`);
}

main().catch((err) => {
  console.error('❌ Council run failed:', err.message);
  process.exit(1);
});
