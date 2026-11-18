// zes-agent-hub — Vercel + Cloudflare Deploy Pipeline (CLI wrapper)
// Logic lives in server/lib/deploy.js.

import { deployTemplate } from '../server/lib/deploy.js';

async function main() {
  console.log('🚀 zes-agent-hub — Vercel + Cloudflare Deploy Pipeline');
  console.log('========================================================');

  const result = await deployTemplate();

  for (const [target, deployed] of Object.entries(result)) {
    console.log(`${target}: ${deployed.liveUrl || 'deployed (no URL parsed)'}`);
  }

  console.log('✅ Pipeline complete');
}

main().catch((err) => {
  console.error('❌ Pipeline error:', err.message);
  process.exit(1);
});
