// zes-agent-hub — Council Runner
// Executes a council orchestration cycle:
// 1. Orchestrator (castor) receives user prompt
// 2. Posts to council channel
// 3. Council members (john, siti, laurent, labu) discuss
// 4. Orchestrator synthesizes and directs execution
// 5. Pipeline: Vercel + Cloudflare build and deploy

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { seatGenText } from '../server/pollinations-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEATS_CONFIG_PATH = path.resolve(__dirname, '../seats/config.json');

async function main() {
  const prompt = process.argv[2];
  if (!prompt) {
    console.error('Usage: node scripts/council-run.js "<user prompt>"');
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(SEATS_CONFIG_PATH, 'utf-8'));
  const seats = config.seats.reduce((map, s) => { map.set(s.id, s); return map; }, new Map());

  const castor = seats.get('castor'); // Orchestrator
  const councilMembers = config.seats.filter(s => s.id !== 'castor');

  console.log('🏛️  zes-agent-hub — Council Orchestration');
  console.log('==========================================');
  console.log(`📝 User Prompt: ${prompt}`);
  console.log(`👤 Orchestrator: ${castor.nicknameModel}\n`);

  // Phase 1: Orchestrator routes to council
  console.log('Phase 1: Orchestrator routing to council...');
  const routingResponse = await seatGenText(castor, `
    You are the orchestrator seat (castor@deepseek-v4.1-flash). A user has submitted the following prompt:
    "${prompt}"
    
    Your council members are:
    - john@gpt-6-astra (strategy, architecture, decision-making)
    - siti@claude-opus-5.5 (creative, content, UX design)
    - laurent@grok-4.7 (implementation, code review, system architecture)
    - labu@deepseek-v4.1-flash (deployment, Vercel + Cloudflare pipeline)
    
    Decide how to route this to the council. Which members should be involved?
    What should each member focus on? Provide a brief routing plan.
  `);
  console.log(`   📋 Routing plan: ${routingResponse.content.substring(0, 200)}...\n`);

  // Phase 2: Council discussion
  console.log('Phase 2: Council discussion...');
  const councilResponses = {};
  for (const member of councilMembers) {
    const response = await seatGenText(member, `
      You are ${member.nicknameModel}, a ${member.role} on the agent council.
      
      User prompt: "${prompt}"
      
      Orchestrator routing: ${routingResponse.content}
      
      Provide your analysis and recommendations from your role's perspective.
      Keep it concise and actionable.
    `);
    councilResponses[member.id] = response.content;
    console.log(`   💬 ${member.nicknameModel}: ${response.content.substring(0, 150)}...`);
  }

  // Phase 3: Orchestrator synthesizes
  console.log('\nPhase 3: Orchestrator synthesizing council input...');
  const synthesisResponse = await seatGenText(castor, `
    You are the orchestrator seat (castor@deepseek-v4.1-flash). Synthesize the following council input into a unified plan:
    
    ${Object.entries(councilResponses).map(([id, content]) => `${id}: ${content}`).join('\n\n')}
    
    Provide:
    1. Final consensus/decision
    2. Action items assigned to specific seats
    3. Expected outcome
    4. Pipeline stages: build → vercel-deploy → cloudflare-deploy
  `);
  console.log(`   🎯 Synthesis: ${synthesisResponse.content.substring(0, 200)}...\n`);

  // Phase 4: Labu handles deployment pipeline
  console.log('Phase 4: Directing deployment pipeline (labu@deepseek-v4.1-flash)...');
  const labu = seats.get('labu');
  const deployResponse = await seatGenText(labu, `
    You are labu@deepseek-v4.1-flash, the deployment coordinator on the agent council.
    
    Synthesis: ${synthesisResponse.content}
    
    Plan the Vercel + Cloudflare build and deploy pipeline:
    1. Build stage
    2. Vercel deploy stage
    3. Cloudflare deploy stage
    
    Reference template: https://zes.codes
    Local path: /data/data/com.termux/files/home/tmp/vercel/zes.codes
    
    Provide deployment steps and commands.
  `);
  console.log(`   🚀 Deployment plan: ${deployResponse.content.substring(0, 200)}...\n`);

  console.log('==========================================');
  console.log('✅ Council orchestration complete');
  console.log(`\n📊 Summary:`);
  console.log(`   Orchestrator: ${castor.nicknameModel}`);
  console.log(`   Council members: ${councilMembers.map(m => m.nicknameModel).join(', ')}`);
  console.log(`   Pipeline: build → vercel-deploy → cloudflare-deploy`);
  console.log(`   Template: https://zes.codes`);
}

main().catch(err => {
  console.error('❌ Council run failed:', err.message);
  process.exit(1);
});
