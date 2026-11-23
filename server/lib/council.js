// zes-agent-hub — Council orchestration library
// Runs one council cycle: routing → discussion → synthesis → deployment plan.
// Used by scripts/council-run.js and POST /api/pipeline/*.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { seatGenText } from './providers/seat-call.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEATS_CONFIG_PATH = process.env.SEATS_CONFIG_PATH
  ? path.resolve(process.env.SEATS_CONFIG_PATH)
  : path.resolve(__dirname, '../../seats/config.json');

export function loadSeatConfig(configPath = SEATS_CONFIG_PATH) {
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

const noop = () => {};

/**
 * Run a full council cycle.
 * @param {string} prompt
 * @param {{config?: Object, logger?: Function}} options
 */
export async function runCouncil(prompt, options = {}) {
  if (!prompt || !prompt.trim()) {
    throw new Error('A prompt is required');
  }

  const log = options.logger || noop;
  const config = options.config || loadSeatConfig();
  const seats = new Map(config.seats.map((seat) => [seat.id, seat]));
  const castor = seats.get('castor');
  const council = config.seats.filter((seat) => seat.id !== 'castor');

  if (!castor) {
    throw new Error('castor seat is missing from seats/config.json');
  }

  log(`Orchestrator: ${castor.nicknameModel}`);

  const routing = await seatGenText(
    castor,
    `You are the orchestrator seat (${castor.nicknameModel}). A user has submitted:
"${prompt}"

Your council members are:
${council.map((m) => `- ${m.nicknameModel} (${m.mission})`).join('\n')}

Decide how to route this to the council. Which members should be involved and what
should each focus on? Keep the routing plan brief.`,
  );
  log(`Routing: ${routing.content.slice(0, 200)}`);

  const councilResponses = {};

  for (const member of council) {
    const response = await seatGenText(
      member,
      `You are ${member.nicknameModel}, a ${member.role} on the agent council.

User prompt: "${prompt}"

Orchestrator routing: ${routing.content}

Provide your analysis and recommendations from your role's perspective. Keep it concise
and actionable.`,
    );
    councilResponses[member.id] = response.content;
    log(`${member.nicknameModel}: ${response.content.slice(0, 150)}`);
  }

  const synthesis = await seatGenText(
    castor,
    `You are the orchestrator seat (${castor.nicknameModel}). Synthesize the council input
into one plan:

${Object.entries(councilResponses)
  .map(([id, content]) => `${id}: ${content}`)
  .join('\n\n')}

Provide:
1. Final consensus
2. Action items per seat
3. Expected outcome
4. Pipeline stages: build → vercel-deploy → cloudflare-deploy`,
  );

  const labu = seats.get('labu') || castor;
  const deployment = await seatGenText(
    labu,
    `You are ${labu.nicknameModel}, the deployment coordinator.

Synthesis: ${synthesis.content}

Plan the build and deploy steps for:
1. Build
2. Vercel deploy
3. Cloudflare deploy

Reference template: ${config.pipeline?.template || 'https://zes.codes'}`,
  );

  return {
    ok: true,
    prompt,
    orchestrator: castor.nicknameModel,
    council: council.map((m) => m.nicknameModel),
    routing: routing.content,
    responses: councilResponses,
    synthesis: synthesis.content,
    deployment: deployment.content,
  };
}
