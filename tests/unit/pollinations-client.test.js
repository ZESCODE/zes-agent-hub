import { describe, expect, it } from 'vitest';

import { pollinationsGenChat } from '../../server/pollinations-client.js';

const hasKey = Boolean(process.env.POLLINATIONS_API_KEY);

describe.skipIf(!hasKey)('pollinations client', () => {
  it('falls back to the free classic model when the account has no credits', async () => {
    const result = await pollinationsGenChat('openai/gpt-5.4-nano', [{ role: 'user', content: 'hello' }], {
      maxTokens: 50,
    });

    expect(result.content.length).toBeGreaterThan(0);
    expect(result.fallback).toBe(true);
  });
});
