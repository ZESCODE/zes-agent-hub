// zes-agent-hub — agent model runner
// Executes one task with the routed model and returns a structured result.

import { costPerMillionTokens, DEFAULT_PROVIDER, getProvider } from '../providers/registry.js';

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
  const artifacts = Array.isArray(task.input?.artifacts) ? task.input.artifacts : [];

  const instruction = [
    SYSTEM_PROMPTS[agent.id] || `You are ${agent.name}, a ${agent.role} agent.`,
    `Task objective: ${task.objective}`,
    upstream.length > 0
      ? `Evidence from earlier steps, use it as the factual basis of your answer:\n${JSON.stringify(upstream).slice(0, 12_000)}`
      : 'Evidence from earlier steps: none yet, work from the task objective alone.',
    artifacts.length > 0
      ? `Artifacts collected in this run:\n${JSON.stringify(artifacts).slice(0, 8_000)}`
      : 'Artifacts collected in this run: none yet.',
    `Expected outputs: ${JSON.stringify(task.expected_outputs || [])}`,
    `Acceptance criteria: ${JSON.stringify(task.acceptance_criteria || [])}`,
    'Respond with JSON only: {"summary": "...", "outputs": ["..."], "issues": ["..."], "evidence": ["..."]}.',
  ].join('\n\n');

  const messages = [
    { role: 'system', content: SYSTEM_PROMPTS[agent.id] || `You are ${agent.name}.` },
    { role: 'user', content: instruction },
  ];

  const { response, provider: usedProvider, model: usedModel, fallbackReason } = await callWithFallback({
    route,
    messages,
    timeoutMs,
  });

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
      model: usedModel,
      provider: usedProvider,
      agentId: agent.id,
    },
    inputTokens: response.inputTokens ?? (response.tokens ? Math.round(response.tokens * 0.7) : null),
    outputTokens: response.outputTokens ?? (response.tokens ? Math.round(response.tokens * 0.3) : null),
    estimatedCost: estimateCost(response.tokens, usedProvider),
    timeoutMs,
    provider: usedProvider,
    model: usedModel,
    fallback: Boolean(fallbackReason),
    fallbackReason: fallbackReason || null,
  };
}

/**
 * Call the routed provider. A fallback provider is used only when the route
 * names one explicitly, so a provider failure never silently switches the
 * work to another provider.
 */
async function callWithFallback({ route, messages, timeoutMs }) {
  const providerId = route.provider || DEFAULT_PROVIDER;
  const provider = getProvider(providerId);
  const options = { maxTokens: 2000, temperature: 0.3, timeoutMs };

  try {
    const response = await provider.genChat(route.model, messages, options);
    return { response, provider: providerId, model: response.model || route.model, fallbackReason: null };
  } catch (error) {
    const fallbackProvider = route.fallbackProvider;

    if (!fallbackProvider || fallbackProvider === providerId) {
      throw error;
    }

    const fallback = getProvider(fallbackProvider);
    const response = await fallback.genChat(route.fallbackModel, messages, options);

    return {
      response: { ...response, fallback: true },
      provider: fallbackProvider,
      model: response.model || route.fallbackModel,
      fallbackReason: error.message,
    };
  }
}

function estimateCost(tokens, providerId) {
  if (!tokens) {
    return 0;
  }

  const rate = costPerMillionTokens(providerId);
  return Number(((tokens / 1_000_000) * rate).toFixed(6));
}
