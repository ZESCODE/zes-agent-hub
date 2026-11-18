// zes-agent-hub — image helpers

import { pollinationsGenText } from '../pollinations-client.js';

const IMAGE_BASE = process.env.POLLINATIONS_IMAGE_BASE_URL || 'https://image.pollinations.ai/prompt';

export function buildImageUrl(prompt, options = {}) {
  const width = options.width || 1024;
  const height = options.height || 1024;
  const seed = options.seed ?? Math.floor(Math.random() * 1_000_000);
  const model = options.model || 'flux-klein';
  const url = new URL(`${IMAGE_BASE}/${encodeURIComponent(prompt)}`);
  url.searchParams.set('width', String(width));
  url.searchParams.set('height', String(height));
  url.searchParams.set('seed', String(seed));
  url.searchParams.set('model', model);
  url.searchParams.set('nologo', 'true');

  if (process.env.POLLINATIONS_API_KEY) {
    url.searchParams.set('token', process.env.POLLINATIONS_API_KEY);
  }

  return { url: url.toString(), seed };
}

/**
 * Ask a seat to write a short hero headline for the site.
 */
export async function generateHeroCopy(seat, { title, niche }) {
  const response = await pollinationsGenText(
    seat.model,
    `Write one punchy hero headline (max 12 words) for a ${niche} business called "${title}".
Return only the headline, no quotes.`,
    { temperature: 0.8, maxTokens: 800 },
  );

  return response.content.trim().replace(/^["']|["']$/g, '');
}
