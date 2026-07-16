import { describe, expect, it, vi, beforeEach } from 'vitest';

// getBotConfig().llm.chain をテストごとに差し替えられるようモック化する。
const chainMock = vi.fn();
vi.mock('./groq-config.js', () => ({
  getBotConfig: () => ({ llm: { chain: chainMock() } }),
}));

const callGroqMock = vi.fn();
const callGeminiMock = vi.fn();
const callWorkersAiMock = vi.fn();
vi.mock('./llm-providers.js', () => ({
  callGroq: (...args: unknown[]) => callGroqMock(...args),
  callGemini: (...args: unknown[]) => callGeminiMock(...args),
  callWorkersAi: (...args: unknown[]) => callWorkersAiMock(...args),
}));

const { generateLlmReplyWithFallback } = await import('./llm-chain.js');

const baseParams = {
  systemPrompt: 'test',
  messages: [],
  incomingText: 'hello',
};

describe('generateLlmReplyWithFallback', () => {
  beforeEach(() => {
    callGroqMock.mockReset();
    callGeminiMock.mockReset();
    callWorkersAiMock.mockReset();
    chainMock.mockReset();
    chainMock.mockReturnValue([
      { provider: 'groq', model: 'llama-3.3-70b-versatile', timeoutMs: 8000 },
      { provider: 'gemini', model: 'gemini-2.5-flash-lite', timeoutMs: 10000 },
      { provider: 'workers-ai', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', timeoutMs: 8000 },
    ]);
  });

  it('1番手(Groq)が成功したら他の段は呼ばない', async () => {
    callGroqMock.mockResolvedValue({ kind: 'reply', text: 'Groq応答' });

    const result = await generateLlmReplyWithFallback({
      ...baseParams,
      receivedAt: Date.now(),
      groqApiKey: 'gsk-test',
      geminiApiKey: 'gemini-test',
      workersAi: {} as Ai,
    });

    expect(result).toEqual({ kind: 'reply', text: 'Groq応答' });
    expect(callGroqMock).toHaveBeenCalledTimes(1);
    expect(callGeminiMock).not.toHaveBeenCalled();
    expect(callWorkersAiMock).not.toHaveBeenCalled();
  });

  it('1番手がfail_closedなら2番手(Gemini)を試す', async () => {
    callGroqMock.mockResolvedValue({ kind: 'fail_closed' });
    callGeminiMock.mockResolvedValue({ kind: 'reply', text: 'Gemini応答' });

    const result = await generateLlmReplyWithFallback({
      ...baseParams,
      receivedAt: Date.now(),
      groqApiKey: 'gsk-test',
      geminiApiKey: 'gemini-test',
      workersAi: {} as Ai,
    });

    expect(result).toEqual({ kind: 'reply', text: 'Gemini応答' });
    expect(callGroqMock).toHaveBeenCalledTimes(1);
    expect(callGeminiMock).toHaveBeenCalledTimes(1);
    expect(callWorkersAiMock).not.toHaveBeenCalled();
  });

  it('全段fail_closedならfail_closedを返す', async () => {
    callGroqMock.mockResolvedValue({ kind: 'fail_closed' });
    callGeminiMock.mockResolvedValue({ kind: 'fail_closed' });
    callWorkersAiMock.mockResolvedValue({ kind: 'fail_closed' });

    const result = await generateLlmReplyWithFallback({
      ...baseParams,
      receivedAt: Date.now(),
      groqApiKey: 'gsk-test',
      geminiApiKey: 'gemini-test',
      workersAi: {} as Ai,
    });

    expect(result).toEqual({ kind: 'fail_closed' });
    expect(callGroqMock).toHaveBeenCalledTimes(1);
    expect(callGeminiMock).toHaveBeenCalledTimes(1);
    expect(callWorkersAiMock).toHaveBeenCalledTimes(1);
  });

  it('APIキー/バインディングが無い段は静かにスキップする', async () => {
    callGeminiMock.mockResolvedValue({ kind: 'reply', text: 'Gemini応答' });

    const result = await generateLlmReplyWithFallback({
      ...baseParams,
      receivedAt: Date.now(),
      groqApiKey: undefined, // Groqキー無し → 1番手スキップ
      geminiApiKey: 'gemini-test',
      workersAi: {} as Ai,
    });

    expect(result).toEqual({ kind: 'reply', text: 'Gemini応答' });
    expect(callGroqMock).not.toHaveBeenCalled();
    expect(callGeminiMock).toHaveBeenCalledTimes(1);
  });

  it('残り時間が次の段のtimeoutMsより短い場合はその段をスキップする', async () => {
    callGroqMock.mockResolvedValue({ kind: 'fail_closed' });
    // デッドラインは 60000-15000=45000ms。経過20000msなら残り25000msで
    // Gemini(10000ms)は通るが、続くworkers-ai(8000ms)は残り15000ms...となり通る。
    // Gemini自体をスキップさせるには「groqのtimeoutMs(8000)は通るが
    // gemini(10000)は残り不足」という経過時間(残り9000ms=経過36000ms)にする。
    callGeminiMock.mockResolvedValue({ kind: 'reply', text: 'Gemini応答（本来は来ないはず）' });
    callWorkersAiMock.mockResolvedValue({ kind: 'reply', text: 'WorkersAI応答' });

    const receivedAt = Date.now() - 36_000; // 残り9000ms: groq(8000)は通るがgemini(10000)は不足
    const result = await generateLlmReplyWithFallback({
      ...baseParams,
      receivedAt,
      groqApiKey: 'gsk-test',
      geminiApiKey: 'gemini-test',
      workersAi: {} as Ai,
    });

    expect(callGroqMock).toHaveBeenCalledTimes(1);
    expect(callGeminiMock).not.toHaveBeenCalled();
    expect(callWorkersAiMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ kind: 'reply', text: 'WorkersAI応答' });
  });
});
