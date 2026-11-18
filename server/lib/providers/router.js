// zes-agent-hub — model router (ZAP v1 §9)
// Rules-based routing by task type; no self-training in v1.

const ROUTES = {
  classify: { model: 'openai/gpt-5.4-nano', complexity: 'low', timeoutMs: 60_000, maxRetries: 2 },
  plan: { model: 'deepseek/deepseek-v4.1-flash', complexity: 'high', timeoutMs: 180_000, maxRetries: 2 },
  scout: { model: 'openai/gpt-6-astra', complexity: 'medium', timeoutMs: 180_000, maxRetries: 3 },
  research: { model: 'openai/gpt-6-astra', complexity: 'medium', timeoutMs: 180_000, maxRetries: 3 },
  architecture: { model: 'deepseek/deepseek-v4.1-flash', complexity: 'high', timeoutMs: 240_000, maxRetries: 2 },
  design: { model: 'openai/gpt-6.1-terra', complexity: 'medium', timeoutMs: 180_000, maxRetries: 2 },
  branding: { model: 'openai/gpt-6.1-terra', complexity: 'low', timeoutMs: 120_000, maxRetries: 2 },
  build: { model: 'openai/gpt-6-astra', complexity: 'high', timeoutMs: 300_000, maxRetries: 3 },
  implementation: { model: 'openai/gpt-6-astra', complexity: 'high', timeoutMs: 300_000, maxRetries: 3 },
  image: { model: 'openai/gpt-6.1-terra', complexity: 'low', timeoutMs: 120_000, maxRetries: 2 },
  deploy: { model: 'deepseek/deepseek-v4.1-flash', complexity: 'medium', timeoutMs: 300_000, maxRetries: 2 },
  infrastructure: { model: 'deepseek/deepseek-v4.1-flash', complexity: 'medium', timeoutMs: 300_000, maxRetries: 2 },
  verify: { model: 'openai/gpt-6-astra', complexity: 'high', timeoutMs: 180_000, maxRetries: 2 },
  verification: { model: 'openai/gpt-6-astra', complexity: 'high', timeoutMs: 180_000, maxRetries: 2 },
};

const DEFAULT_ROUTE = ROUTES.classify;

/**
 * Choose a model route for a task.
 * @param {{taskType: string, requiresVision?: boolean, requiresCoding?: boolean, complexity?: string}} input
 */
export function routeFor(input = {}) {
  const base = ROUTES[input.taskType] || DEFAULT_ROUTE;
  const complexity = input.complexity || base.complexity;

  return {
    provider: 'pollinations',
    model: base.model,
    fallbackProvider: 'pollinations',
    fallbackModel: 'openai/gpt-5.4-nano',
    timeoutMs: base.timeoutMs,
    maxRetries: base.maxRetries,
    complexity,
    requiresVision: Boolean(input.requiresVision),
    requiresCoding: Boolean(input.requiresCoding),
  };
}

export function knownTaskTypes() {
  return Object.keys(ROUTES);
}
