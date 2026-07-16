import { describe, expect, it } from 'vitest';
import { getGroqReplyConfig } from './groq-reply.js';

function fakeDb(settings: Array<{ value: string }> = []): D1Database {
  return {
    prepare(sql: string) {
      const isSettings = sql.includes('account_settings');
      return {
        bind(..._args: unknown[]) {
          return this;
        },
        async first<T>(): Promise<T | null> {
          if (isSettings) return (settings[0] as T) ?? null;
          return null;
        },
        async all<T>(): Promise<{ results: T[] }> {
          return { results: [] };
        },
        async run(): Promise<unknown> {
          return { success: true };
        },
      };
    },
  } as unknown as D1Database;
}

describe('getGroqReplyConfig', () => {
  it('returns disabled without lineAccountId', async () => {
    const config = await getGroqReplyConfig(fakeDb(), null);
    expect(config.enabled).toBe(false);
  });

  it('returns enabled when groq_reply_enabled=true', async () => {
    const db = fakeDb([{ value: 'true' }]);
    const config = await getGroqReplyConfig(db, 'acc1');
    expect(config.enabled).toBe(true);
  });
});

// Groq本体へのHTTP呼び出しテストは llm-providers.test.ts に移設済み
// （2026-07-17: generateGroqReply を llm-providers.ts の callGroq() に統合したため）。
