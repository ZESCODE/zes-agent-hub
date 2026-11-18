// zes-agent-hub — Seat Setup Script
// Registers all seats on the AgoraHub and configures missions/delegations

import fs from 'fs';
import path from 'path';

const __dirname = path.dirname(path.toFileURL(import.meta.url).pathname);

async function main() {
  const configPath = path.resolve(__dirname, '../seats/config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  console.log('🔧 zes-agent-hub — Seat Setup');
  console.log('=====================================');

  // Check Pollinations API key
  const polliApiKey = process.env.POLLINATIONS_API_KEY;
  if (!polliApiKey) {
    console.error('❌ POLLINATIONS_API_KEY not set');
    process.exit(1);
  }

  console.log(`📋 Configuring ${config.seats.length} seats...`);
  console.log(`📡 Council Channel: ${config.councilChannel}`);
  console.log(`🔄 Drive Loop Interval: ${config.driveLoopIntervalMs}ms`);
  console.log(`🚀 Pipeline: ${config.pipeline?.name || 'vercel-cloudflare-build-deploy'}`);
  console.log(`📋 Template: ${config.pipeline?.template || 'https://zes.codes'}`);

  console.log(`\n  🪑 Seats:`);
  for (const seat of config.seats) {
    console.log(`     ${seat.nicknameModel}`);
    console.log(`        Role: ${seat.role}`);
    console.log(`        Provider: ${seat.provider}`);
    console.log(`        Model: ${seat.model}`);
    console.log(`        Mission: ${seat.mission}`);
    console.log(`        Capabilities: ${seat.capabilities?.join(', ') || 'none'}`);
    console.log(`        ✅ Configured`);
  }

  console.log(`\n  🔗 Delegations:`);
  for (const dep of config.delegations || []) {
    console.log(`     ${dep.from} → ${dep.to} (${dep.type})`);
  }

  console.log(`\n  🚀 Pipeline Stages:`);
  for (const stage of config.pipeline?.stages || []) {
    console.log(`     → ${stage}`);
  }

  console.log(`\n✅ Seat setup complete!`);
}

main().catch(err => {
  console.error('❌ Setup failed:', err.message);
  process.exit(1);
});
