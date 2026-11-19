// zes-agent-hub — workflow tool registry
// Tools are the only way a workflow may act outside the hub. Every tool is
// invoked by the scheduler with an idempotency key and an explicit job, and
// publication tools stay disabled unless they are explicitly enabled and the
// workflow carries an approval.

import { qcCheck } from '../qc.js';
import { runFreeTier } from '../deploy.js';

const TOOL_DEFINITIONS = [
  {
    name: 'qc.check',
    description: 'Run the QC Council on an image',
    permissions: ['qc.run'],
    mutating: false,
  },
  {
    name: 'github.repository.read',
    description: 'Read repository metadata and file content',
    permissions: ['github.repository.read'],
    mutating: false,
  },
  {
    name: 'builder.project.read',
    description: 'Read builder project state',
    permissions: ['builder.project.read'],
    mutating: false,
  },
  {
    name: 'deployment.preview',
    description: 'Render and plan a deployment without publishing it',
    permissions: ['deployment.preview'],
    mutating: false,
  },
  {
    name: 'deployment.publish',
    description: 'Publish a deployment',
    permissions: ['deployment.preview', 'deployment.publish'],
    mutating: true,
  },
  {
    name: 'github.repository.write',
    description: 'Write repository content',
    permissions: ['github.repository.read', 'github.repository.write'],
    mutating: true,
  },
  {
    name: 'builder.project.write',
    description: 'Change builder project state',
    permissions: ['builder.project.read', 'builder.project.write'],
    mutating: true,
  },
  {
    name: 'research.web',
    description: 'Collect external research results',
    permissions: ['research.read'],
    mutating: false,
  },
];

function githubToken() {
  return process.env.GITHUB_TOKEN || process.env.GITHUB_API_TOKEN || '';
}

async function readRepository({ owner, repo, path = '' }) {
  const token = githubToken();

  if (!token) {
    throw new Error('GITHUB_TOKEN is not configured');
  }

  if (!owner || !repo) {
    throw new Error('owner and repo are required');
  }

  const url = path
    ? `https://api.github.com/repos/${owner}/${repo}/contents/${path}`
    : `https://api.github.com/repos/${owner}/${repo}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'zes-agent-hub',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status}`);
  }

  return response.json();
}

export function createToolRegistry({ logger = () => {} } = {}) {
  const enabled = new Set(
    TOOL_DEFINITIONS.filter((tool) => {
      if (!tool.mutating) {
        return true;
      }

      return process.env.AGORA_ENABLE_MUTATING_TOOLS === 'true';
    }).map((tool) => tool.name),
  );

  const implementations = {
    'qc.check': async ({ parameters }) => {
      const verdict = await qcCheck(parameters.imageUrl, { prompt: parameters.prompt });
      return verdict;
    },
    'github.repository.read': async ({ parameters }) => {
      const repository = await readRepository(parameters);
      return {
        name: repository.full_name,
        defaultBranch: repository.default_branch,
        stars: repository.stargazers_count,
        description: repository.description,
        license: repository.license?.spdx_id || null,
        htmlUrl: repository.html_url,
      };
    },
    'builder.project.read': async ({ parameters }) => {
      throw new Error(`builder.project.read is not available for project ${parameters.projectId || 'unknown'}`);
    },
    'deployment.preview': async ({ parameters, logger: log }) => {
      const result = await runFreeTier({
        title: parameters.title || 'ZES preview',
        niche: parameters.niche || 'general',
        templateId: parameters.templateId,
        dryRun: true,
        logger: log,
      });

      return { planned: true, ...result };
    },
  };

  async function execute({ toolName, jobId, taskId, parameters = {}, idempotencyKey }) {
    const definition = TOOL_DEFINITIONS.find((tool) => tool.name === toolName);

    if (!definition) {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    if (!enabled.has(toolName)) {
      throw new Error(`Tool ${toolName} is not enabled`);
    }

    const implementation = implementations[toolName];

    if (!implementation) {
      throw new Error(`Tool ${toolName} has no implementation`);
    }

    logger(`[tools] ${toolName} job=${jobId} task=${taskId} key=${idempotencyKey}`);

    return implementation({ parameters, jobId, taskId, idempotencyKey, logger });
  }

  return {
    execute,
    list: () =>
      TOOL_DEFINITIONS.map((tool) => ({
        ...tool,
        enabled: enabled.has(tool.name),
      })),
    isEnabled: (toolName) => enabled.has(toolName),
  };
}
