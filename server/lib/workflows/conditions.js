// zes-agent-hub — safe condition expressions
// Conditions are evaluated by the hub, never by a model and never with eval().
// The grammar is deliberately small: comparisons and boolean operators over
// literal values and read-only context paths.

const PATH_PREFIXES = new Set(['inputs', 'nodes', 'job']);

export class ConditionEvaluationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConditionEvaluationError';
  }
}

function splitTopLevel(expression, separator) {
  const parts = [];
  let current = '';
  let quote = null;
  let depth = 0;

  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];

    if (quote) {
      current += char;

      if (char === quote && expression[index - 1] !== '\\') {
        quote = null;
      }

      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }

    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
    }

    if (depth === 0 && expression.startsWith(separator, index)) {
      parts.push(current);
      current = '';
      index += separator.length - 1;
      continue;
    }

    current += char;
  }

  parts.push(current);
  return parts;
}

function unwrapParentheses(expression) {
  let value = expression.trim();

  while (value.startsWith('(') && value.endsWith(')')) {
    const inner = value.slice(1, -1);
    let depth = 0;
    let balanced = true;

    for (const char of inner) {
      if (char === '(') {
        depth += 1;
      } else if (char === ')') {
        depth -= 1;

        if (depth < 0) {
          balanced = false;
          break;
        }
      }
    }

    if (!balanced || depth !== 0) {
      break;
    }

    value = inner.trim();
  }

  return value;
}

function resolvePath(path, context) {
  const segments = path.split('.');
  const [prefix] = segments;

  if (!PATH_PREFIXES.has(prefix)) {
    throw new ConditionEvaluationError(`Unknown context prefix "${prefix}" in "${path}"`);
  }

  let value = context[prefix];

  for (const segment of segments.slice(1)) {
    if (value === null || value === undefined || typeof value !== 'object') {
      return undefined;
    }

    value = value[segment];
  }

  return value;
}

function parseOperand(token, context) {
  const trimmed = token.trim();

  if (!trimmed) {
    throw new ConditionEvaluationError('Missing operand');
  }

  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1);
  }

  if (trimmed === 'true') {
    return true;
  }

  if (trimmed === 'false') {
    return false;
  }

  if (trimmed === 'null') {
    return null;
  }

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  if (!/^[A-Za-z_][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)*$/.test(trimmed)) {
    throw new ConditionEvaluationError(`Unsupported operand "${trimmed}"`);
  }

  const resolved = resolvePath(trimmed, context);
  return resolved === undefined ? null : resolved;
}

const COMPARISON = /^(.+?)\s*(===|!==|==|!=|>=|<=|>|<)\s*(.+)$/;

function compare(left, operator, right) {
  switch (operator) {
    case '===':
      return left === right;
    case '!==':
      return left !== right;
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    case '>':
      return Number(left) > Number(right);
    case '<':
      return Number(left) < Number(right);
    case '>=':
      return Number(left) >= Number(right);
    case '<=':
      return Number(left) <= Number(right);
    default:
      throw new ConditionEvaluationError(`Unsupported operator "${operator}"`);
  }
}

function evaluateClause(clause, context) {
  const value = unwrapParentheses(clause);

  if (value.includes('||')) {
    return splitTopLevel(value, '||').some((part) => evaluateClause(part, context));
  }

  if (value.includes('&&')) {
    return splitTopLevel(value, '&&').every((part) => evaluateClause(part, context));
  }

  const comparison = value.match(COMPARISON);

  if (comparison) {
    const [, leftToken, operator, rightToken] = comparison;
    return compare(parseOperand(leftToken, context), operator, parseOperand(rightToken, context));
  }

  if (value.startsWith('!')) {
    return !parseOperand(value.slice(1), context);
  }

  return Boolean(parseOperand(value, context));
}

/**
 * Evaluate a condition expression against a read-only context. Returns a
 * boolean; throws ConditionEvaluationError on an unsupported expression.
 */
export function evaluateCondition(expression, context = {}) {
  if (typeof expression !== 'string' || !expression.trim()) {
    throw new ConditionEvaluationError('Condition expression is empty');
  }

  return evaluateClause(expression, context);
}

/**
 * Build a condition context from the job and the results of already-run tasks.
 */
export function conditionContext({ job, tasks = [] }) {
  const inputs = {};
  const nodes = {};

  for (const task of tasks) {
    const entry = {
      status: task.status,
      taskType: task.task_type,
      agentId: task.assigned_agent,
      result: task.result || null,
    };

    if (task.node_id) {
      nodes[task.node_id] = entry;
    }

    if (task.result && typeof task.result === 'object' && !Array.isArray(task.result)) {
      Object.assign(inputs, task.result);
    }
  }

  return {
    inputs,
    nodes,
    job: {
      id: job?.id ?? null,
      status: job?.status ?? null,
      title: job?.title ?? null,
      objective: job?.objective ?? null,
    },
  };
}
