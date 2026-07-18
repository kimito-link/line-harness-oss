import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { diag } from './diag.js';

function setupApp() {
  const app = new Hono();
  app.route('/', diag);
  return app;
}

// ルート側は Date.now() を直接使うため、テストの基準時刻もそこから相対計算する
// （固定タイムスタンプだとテスト実行時刻とのズレでagoMs計算が崩れる）。
const NOW = { getTime: () => Date.now(), toISOString: () => new Date().toISOString() };

function makeDb(opts: {
  humanStuckRows?: Array<{ id: string; line_user_id: string; display_name: string | null; updated_at: string }>;
  candidateRows?: Array<{
    id: string;
    line_user_id: string;
    display_name: string | null;
    ai_reply_mode: string | null;
    last_incoming: string | null;
    last_outgoing: string | null;
  }>;
  throwOnQuery?: boolean;
}) {
  const { humanStuckRows = [], candidateRows = [], throwOnQuery = false } = opts;
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn().mockReturnThis(),
      all: vi.fn(async () => {
        if (throwOnQuery) throw new Error('D1 connection failed');
        if (sql.includes("ai_reply_mode = 'human'")) return { results: humanStuckRows };
        return { results: candidateRows };
      }),
    })),
  } as unknown as D1Database;
}

describe('GET /shindan', () => {
  it('serves the self-contained diagnostic viewer HTML without requiring auth', async () => {
    const app = setupApp();
    const res = await app.request('/shindan', {}, { DB: makeDb({}) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('りんくBot 状態診断');
    expect(html).toContain('/api/diag/bot-health');
  });
});

describe('GET /api/diag/bot-health', () => {
  it('returns 503 when DIAG_VIEW_PASSWORD is not configured (fail-closed)', async () => {
    const app = setupApp();
    const res = await app.request('/api/diag/bot-health', { headers: { 'x-diag-password': 'anything' } }, {
      DB: makeDb({}),
    });
    expect(res.status).toBe(503);
  });

  it('returns 401 when the password header is missing or wrong', async () => {
    const app = setupApp();
    const env = { DB: makeDb({}), DIAG_VIEW_PASSWORD: 'correct-horse' };

    const resMissing = await app.request('/api/diag/bot-health', {}, env);
    expect(resMissing.status).toBe(401);

    const resWrong = await app.request('/api/diag/bot-health', { headers: { 'x-diag-password': 'wrong' } }, env);
    expect(resWrong.status).toBe(401);
  });

  it('reports humanStuck friends past the threshold, excluding fresh ones', async () => {
    const stuckAt = new Date(NOW.getTime() - 90 * 60_000).toISOString(); // 90分前
    const freshAt = new Date(NOW.getTime() - 5 * 60_000).toISOString(); // 5分前
    const app = setupApp();
    const res = await app.request(
      '/api/diag/bot-health',
      { headers: { 'x-diag-password': 'correct-horse' } },
      {
        DB: makeDb({
          humanStuckRows: [
            { id: 'f1', line_user_id: 'U1', display_name: '放置太郎', updated_at: stuckAt },
            { id: 'f2', line_user_id: 'U2', display_name: '新規花子', updated_at: freshAt },
          ],
        }),
        DIAG_VIEW_PASSWORD: 'correct-horse',
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.data.humanStuck).toHaveLength(1);
    expect(body.data.humanStuck[0].id).toBe('f1');
    expect(body.data.queryError).toBeNull();
  });

  it('reports silentFriends whose incoming has no following outgoing', async () => {
    const oldIncoming = new Date(NOW.getTime() - 30 * 60_000).toISOString();
    const olderOutgoing = new Date(NOW.getTime() - 60 * 60_000).toISOString();
    const app = setupApp();
    const res = await app.request(
      '/api/diag/bot-health',
      { headers: { 'x-diag-password': 'correct-horse' } },
      {
        DB: makeDb({
          candidateRows: [
            {
              id: 'f3',
              line_user_id: 'U3',
              display_name: '無応答次郎',
              ai_reply_mode: 'bot',
              last_incoming: oldIncoming,
              last_outgoing: olderOutgoing, // incomingより古い = 未応答
            },
            {
              id: 'f4',
              line_user_id: 'U4',
              display_name: '正常花子',
              ai_reply_mode: 'bot',
              last_incoming: oldIncoming,
              last_outgoing: NOW.toISOString(), // incomingより新しい = 応答済み
            },
          ],
        }),
        DIAG_VIEW_PASSWORD: 'correct-horse',
      },
    );
    const body = (await res.json()) as any;
    expect(body.data.silentFriends).toHaveLength(1);
    expect(body.data.silentFriends[0].id).toBe('f3');
  });

  it('excludes friends already in human mode from silentFriends (avoid double-reporting)', async () => {
    const oldIncoming = new Date(NOW.getTime() - 30 * 60_000).toISOString();
    const app = setupApp();
    const res = await app.request(
      '/api/diag/bot-health',
      { headers: { 'x-diag-password': 'correct-horse' } },
      {
        DB: makeDb({
          candidateRows: [
            {
              id: 'f5',
              line_user_id: 'U5',
              display_name: 'エスカレ済み',
              ai_reply_mode: 'human',
              last_incoming: oldIncoming,
              last_outgoing: null,
            },
          ],
        }),
        DIAG_VIEW_PASSWORD: 'correct-horse',
      },
    );
    const body = (await res.json()) as any;
    expect(body.data.silentFriends).toHaveLength(0);
  });

  it('is fail-closed on D1 query failure: reports queryError instead of silently returning empty results', async () => {
    const app = setupApp();
    const res = await app.request(
      '/api/diag/bot-health',
      { headers: { 'x-diag-password': 'correct-horse' } },
      { DB: makeDb({ throwOnQuery: true }), DIAG_VIEW_PASSWORD: 'correct-horse' },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.queryError).toContain('D1 connection failed');
    expect(body.data.humanStuck).toEqual([]);
    expect(body.data.silentFriends).toEqual([]);
  });
});
