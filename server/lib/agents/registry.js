// zes-agent-hub — agent registry (ZAP v1 §4.1)
// Definitions are configuration-driven: seats/config.json plus built-in roles.

import { z } from 'zod';

const agentDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  description: z.string().min(1),
  enabled: z.boolean(),
  provider: z.string().min(1),
  model: z.string().min(1),
  fallbackProvider: z.string().optional(),
  fallbackModel: z.string().optional(),
  tools: z.array(z.string()),
  permissions: z.array(z.string()),
  maxConcurrentTasks: z.number().int().positive(),
  maxRetries: z.number().int().nonnegative(),
  timeoutMs: z.number().int().positive(),
  systemPromptVersion: z.string().min(1),
});

const BUILTIN_AGENTS = [
  {
    id: 'verifier',
    name: 'Verifier',
    role: 'quality',
    description: 'Independent quality and acceptance verification',
    enabled: true,
    provider: 'pollinations',
    model: 'openai/gpt-6-astra',
    tools: ['qc.check', 'github.repository.read'],
    permissions: ['verification.read', 'qc.run'],
    maxConcurrentTasks: 2,
    maxRetries: 1,
    timeoutMs: 120_000,
    systemPromptVersion: 'zap-v1.0.0',
  },
];

const DEFAULT_TOOLS = ['pollinations.text', 'pollinations.image', 'qc.check'];
const DEFAULT_PERMISSIONS = ['model.generate'];
const PERMISSION_BY_AGENT = {
  castor: ['model.generate', 'task.assign', 'approval.request'],
  john: ['model.generate', 'github.repository.read'],
  siti: ['model.generate'],
  laurent: ['model.generate', 'builder.project.read'],
  labu: ['model.generate', 'deployment.preview'],
};

export function buildAgentRegistry(config) {
  const definitions = new Map();

  for (const seat of config.seats || []) {
    const definition = {
      id: seat.id,
      name: seat.nicknameModel.split('@')[0],
      role: seat.role,
      description: seat.mission,
      enabled: true,
      provider: seat.provider || 'pollinations',
      model: seat.model,
      tools: DEFAULT_TOOLS,
      permissions: PERMISSION_BY_AGENT[seat.id] || DEFAULT_PERMISSIONS,
      maxConcurrentTasks: seat.id === 'castor' ? 1 : 3,
      maxRetries: 3,
      timeoutMs: 180_000,
      systemPromptVersion: 'zap-v1.0.0',
    };

    definitions.set(definition.id, agentDefinitionSchema.parse(definition));
  }

  for (const builtin of BUILTIN_AGENTS) {
    if (!definitions.has(builtin.id)) {
      definitions.set(builtin.id, agentDefinitionSchema.parse(builtin));
    }
  }

  return {
    list: () => [...definitions.values()],
    find: (id) => definitions.get(id) || null,
    forTaskType(taskType) {
      const map = {
        scout: 'john',
        research: 'john',
        architecture: 'john',
        design: 'siti',
        branding: 'siti',
        build: 'laurent',
        implementation: 'laurent',
        deploy: 'labu',
        infrastructure: 'labu',
        verify: 'verifier',
        verification: 'verifier',
        plan: 'castor',
      };

      return definitions.get(map[taskType] || 'laurent') || null;
    },
  };
}
