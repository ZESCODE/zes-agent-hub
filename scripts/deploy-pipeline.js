// zes-agent-hub — Vercel + Cloudflare Deploy Pipeline
// First pipeline: build and deploy website using Vercel + Cloudflare

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const TEMPLATE_URL = 'https://zes.codes';
const LOCAL_PATH = process.env.ZES_CODES_PATH || '/data/data/com.termux/files/home/tmp/vercel/zes.codes';

async function main() {
  console.log('🚀 zes-agent-hub — Vercel + Cloudflare Deploy Pipeline');
  console.log('========================================================');
  console.log(`Template: ${TEMPLATE_URL}`);
  console.log(`Local Path: ${LOCAL_PATH}`);
  console.log('');

  // Stage 1: Build
  console.log('Stage 1: Build');
  console.log('---------------');
  try {
    if (!fs.existsSync(LOCAL_PATH)) {
      console.log(`  Cloning template from ${TEMPLATE_URL}...`);
      execSync(`git clone https://github.com/ZESCODE/zes.codes.git "${LOCAL_PATH}"`, { stdio: 'inherit' });
    } else {
      console.log(`  Template already exists at ${LOCAL_PATH}, pulling latest...`);
      execSync(`git -C "${LOCAL_PATH}" pull`, { stdio: 'inherit' });
    }
    console.log('  ✅ Build complete');
  } catch (err) {
    console.error(`  ❌ Build failed:`, err.message);
    process.exit(1);
  }

  // Stage 2: Vercel Deploy
  console.log('\nStage 2: Vercel Deploy');
  console.log('-----------------------');
  try {
    console.log(`  Deploying to Vercel...`);
    execSync(`vercel --prod --cwd "${LOCAL_PATH}"`, { stdio: 'inherit' });
    console.log('  ✅ Vercel deploy complete');
  } catch (err) {
    console.error(`  ❌ Vercel deploy failed:`, err.message);
    console.log('  ⚠️  Make sure VERCEL_API_KEY is set and you are logged in to Vercel');
  }

  // Stage 3: Cloudflare Deploy
  console.log('\nStage 3: Cloudflare Deploy');
  console.log('---------------------------');
  try {
    console.log(`  Deploying to Cloudflare...`);
    execSync(`wrangler deploy --cwd "${LOCAL_PATH}"`, { stdio: 'inherit' });
    console.log('  ✅ Cloudflare deploy complete');
  } catch (err) {
    console.error(`  ❌ Cloudflare deploy failed:`, err.message);
    console.log('  ⚠️  Make sure CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are set');
  }

  console.log('\n========================================================');
  console.log('✅ Pipeline complete — website deployed to Vercel + Cloudflare');
}

main().catch(err => {
  console.error('❌ Pipeline error:', err.message);
  process.exit(1);
});
