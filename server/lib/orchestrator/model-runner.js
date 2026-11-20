// zes-agent-hub — agent model runner
// Executes one task with the routed model and returns a structured result.

import { pollinationsGenChat } from '../../pollinations-client.js';

const SYSTEM_PROMPTS = {
  castor: 'You are Castor, the orchestrator. Break objectives into concrete, verifiable steps.',
  john: 'You are John, the architect and researcher. Be evidence-based and cite sources you used.',
  siti: 'You are Siti, product and UX. Return concrete, implementable direction.',
  laurent: 'You are Laurent, the engineer. Return reviewable implementation guidance.',
  labu: 'You are Labu, infrastructure. Return exact deployment steps and identifiers.',
  verifier: 'You are the Verifier. Evaluate acceptance criteria independently. Missing evidence is not a pass.',
};

function extractJson(content) {
  const match = content.match(/\{[\s\S]*\}/);

  if (!match) {
    return null;
  }

  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

/**
 * Run one task through a model and return a structured AgentResult-shaped payload.
 */
export async function runTaskWithModel({ agent, task, route, timeoutMs = 180_000, budget = null, spent = null }) {
  if (budget && spent) {
    const cost = Number(spent.totalCostUsd || 0);
    const calls = Number(spent.modelCalls || 0);

    if (budget.maxTotalCostUsd !== undefined && budget.maxTotalCostUsd !== null && cost >= budget.maxTotalCostUsd) {
      throw new Error(`Budget exhausted: ${cost.toFixed(4)} USD spent of ${budget.maxTotalCostUsd} USD`);
    }

    if (budget.maxModelCalls !== undefined && budget.maxModelCalls !== null && calls >= budget.maxModelCalls) {
      throw new Error(`Budget exhausted: ${calls} model calls of ${budget.maxModelCalls}`);
    }
  }

  const upstream = Array.isArray(task.input?.upstream) ? task.input.upstream : [];

  const instruction = [
    SYSTEM_PROMPTS[agent.id] || `You are ${agent.name}, a ${agent.role} agent.`,
    `Task objective: ${task.objective}`,
    upstream.length > 0
      ? `Evidence from earlier steps:\n${JSON.stringify(upstream).slice(0, 12_000)}`
      : 'Evidence from earlier steps: none yet, work from the task objective alone.',
    `Expected outputs: ${JSON.stringify(task.expected_outputs || [])}`,
    `Acceptance criteria: ${JSON.stringify(task.acceptance_criteria || [])}`,
    'Respond with JSON only: {"summary": "...", "outputs": ["..."], "issues": ["..."], "evidence": ["..."]}.',
  ].join('\n\n');

  const response = await pollinationsGenChat(
    route.model,
    [
      { role: 'system', content: SYSTEM_PROMPTS[agent.id] || `You are ${agent.name}.` },
      { role: 'user', content: instruction },
    ],
    { maxTokens: 2000, temperature: 0.3 },
  );

  const parsed = extractJson(response.content);

  return {
    result: {
      status: 'completed',
      summary: parsed?.summary || response.content.slice(0, 800),
      artifacts: [],
      outputs: parsed?.outputs || [],
      issues: parsed?.issues || [],
      evidence: Array.isArray(parsed?.evidence) ? parsed.evidence : [],
      requiresApproval: false,
      model: route.model,
      agentId: agent.id,
    },
    inputTokens: response.tokens ? Math.round(response.tokens * 0.7) : null,
    outputTokens: response.tokens ? Math.round(response.tokens * 0.3) : null,
    estimatedCost: estimateCost(response.tokens),
    timeoutMs,
  };
}

const COST_PER_MILLION_TOKENS = 0.5;

function estimateCost(tokens) {
  if (!tokens) {
    return 0;
  }

  return Number(((tokens / 1_000_000) * COST_PER_MILLION_TOKENS).toFixed(6));
}
