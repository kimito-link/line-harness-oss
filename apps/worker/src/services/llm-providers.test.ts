import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { callGroq } from './llm-providers.js';
import { ESCALATION_MARKER } from './groq-reply.js';

const baseParams = {
  systemPrompt: 'test',
  messages: [],
  incomingText: 'hello',
  maxOutputTokens: 500,
  timeoutMs: 8000,
};

describe('callGroq', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns reply on success', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'STEP 3 の手順です' } }],
      }),
    });

    const result = await callGroq('gsk-test', 'llama-3.3-70b-versatile', {
      ...baseParams,
      incomingText: 'Google接続',
    });

    expect(result.kind).toBe('reply');
    expect(result.text).toBe('STEP 3 の手順です');
  });

  it('returns escalate and strips marker', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: `担当者確認します。${ESCALATION_MARKER}` } }],
      }),
    });

    const result = await callGroq('gsk-test', 'llama-3.3-70b-versatile', {
      ...baseParams,
      incomingText: '契約変更',
    });

    expect(result.kind).toBe('escalate');
    expect(result.text).toBe('担当者確認します。');
  });

  it('returns fail_closed on 429', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    });

    const result = await callGroq('gsk-test', 'llama-3.3-70b-versatile', baseParams);

    expect(result.kind).toBe('fail_closed');
  });

  it('returns fail_closed on network error', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('timeout'));

    const result = await callGroq('gsk-test', 'llama-3.3-70b-versatile', baseParams);

    expect(result.kind).toBe('fail_closed');
  });

  it('returns fail_closed on empty content', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '' } }] }),
    });

    const result = await callGroq('gsk-test', 'llama-3.3-70b-versatile', baseParams);

    expect(result.kind).toBe('fail_closed');
  });
});
