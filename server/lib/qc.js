// zes-agent-hub — QC Council
// Parallel vision review of a generated image. Every reviewer returns JSON
// {score, issues}; the average decides pass/fail.

import { getProvider } from './providers/registry.js';
import { loadSeatConfig } from './council.js';

const DEFAULT_REVIEWERS = ['nvidia/nemotron-3-nano-omni-30b-a3b-reasoning'];
const PASS_SCORE = 60;

function parseVerdict(content) {
  const match = content.match(/\{[\s\S]*\}/);

  if (!match) {
    return null;
  }

  try {
    const parsed = JSON.parse(match[0]);
    const score = Number(parsed.score);

    if (!Number.isFinite(score)) {
      return null;
    }

    return {
      score: Math.max(0, Math.min(100, Math.round(score))),
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
    };
  } catch {
    return null;
  }
}

export async function qcCheck(imageUrl, options = {}) {
  if (!imageUrl) {
    throw new Error('imageUrl is required');
  }

  const config = options.config || loadSeatConfig();

  const qcConfig = config.qc || {};
  const reviewerProvider = options.provider || qcConfig.provider || 'newapi';
  const reviewers = options.models || qcConfig.reviewers || DEFAULT_REVIEWERS;
  const models = reviewers.length > 0 ? reviewers : DEFAULT_REVIEWERS;
  const provider = getProvider(reviewerProvider);

  const results = await Promise.all(
    models.map(async (model) => {
      try {
        const response = await provider.genChat(
          model,
          [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text:
                    'You are an image QC reviewer. Inspect the image for artifacts, watermarks, ' +
                    'unreadable text, and whether it matches the described intent.\n' +
                    `Intent: ${options.prompt || 'unspecified'}\n` +
                    'Respond with JSON only: {"score": <0-100>, "issues": ["..."]}',
                },
                { type: 'image_url', image_url: { url: imageUrl } },
              ],
            },
          ],
          { maxTokens: qcConfig.maxTokens || 800, temperature: 0.1 },
        );

        const verdict = parseVerdict(response.content);

        return verdict
          ? { model, ...verdict }
          : { model, score: null, issues: ['Unparseable verdict'] };
      } catch (error) {
        return { model, score: null, issues: [error.message] };
      }
    }),
  );

  const scored = results.filter((r) => typeof r.score === 'number');
  const averageScore = scored.length
    ? Math.round(scored.reduce((sum, r) => sum + r.score, 0) / scored.length)
    : 0;

  return {
    passed: scored.length > 0 && averageScore >= PASS_SCORE,
    averageScore,
    recommendation:
      scored.length === 0
        ? 'qc-unavailable'
        : averageScore >= PASS_SCORE
          ? 'accept'
          : 'regenerate',
    models: results,
  };
}

export function passScore() {
  return PASS_SCORE;
}
