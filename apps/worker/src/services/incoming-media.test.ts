import { describe, test, expect, vi } from 'vitest';
import { fetchAndStoreIncomingMedia } from './incoming-media.js';

function makeR2Stub() {
  const store = new Map<string, { data: ArrayBuffer; contentType: string }>();
  return {
    put: vi.fn(async (key: string, data: ArrayBuffer, opts: { httpMetadata?: { contentType?: string } }) => {
      store.set(key, { data, contentType: opts.httpMetadata?.contentType ?? '' });
      return null;
    }),
    _store: store,
  };
}

describe('fetchAndStoreIncomingMedia (video)', () => {
  test('Content API 成功時に R2 PUT して URL を返す', async () => {
    const r2 = makeR2Stub();
    const fetchMock = vi.fn(async () =>
      new Response(new ArrayBuffer(100), {
        status: 200,
        headers: { 'Content-Type': 'video/mp4' },
      }),
    );

    const result = await fetchAndStoreIncomingMedia({
      r2: r2 as unknown as R2Bucket,
      fetch: fetchMock,
      workerUrl: 'https://worker.example.com',
      channelAccessToken: 'token-abc',
      accountId: 'acc-1',
      messageId: 'msg-xyz',
      kind: 'video',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api-data.line.me/v2/bot/message/msg-xyz/content',
      expect.objectContaining({ headers: { Authorization: 'Bearer token-abc' } }),
    );
    expect(r2.put).toHaveBeenCalled();
    const [key, , opts] = r2.put.mock.calls[0];
    expect(key).toBe('incoming-acc-1-msg-xyz.mp4');
    expect(opts.httpMetadata?.contentType).toBe('video/mp4');
    expect(result?.originalContentUrl).toBe('https://worker.example.com/images/incoming-acc-1-msg-xyz.mp4');
    expect(result?.contentType).toBe('video/mp4');
    expect(result?.bytes.byteLength).toBe(100);
  });

  test('未対応のcontent-typeはnull', async () => {
    const r2 = makeR2Stub();
    const fetchMock = vi.fn(async () =>
      new Response(new ArrayBuffer(50), { status: 200, headers: { 'Content-Type': 'video/unknown' } }),
    );

    const result = await fetchAndStoreIncomingMedia({
      r2: r2 as unknown as R2Bucket,
      fetch: fetchMock,
      workerUrl: 'https://worker.example.com',
      channelAccessToken: 'token-abc',
      accountId: 'acc-1',
      messageId: 'msg-y',
      kind: 'video',
    });

    expect(result).toBeNull();
    expect(r2.put).not.toHaveBeenCalled();
  });
});

describe('fetchAndStoreIncomingMedia (audio)', () => {
  test('Content-Type から拡張子を判定 (m4a)', async () => {
    const r2 = makeR2Stub();
    const fetchMock = vi.fn(async () =>
      new Response(new ArrayBuffer(50), { status: 200, headers: { 'Content-Type': 'audio/mp4' } }),
    );

    const result = await fetchAndStoreIncomingMedia({
      r2: r2 as unknown as R2Bucket,
      fetch: fetchMock,
      workerUrl: 'https://worker.example.com',
      channelAccessToken: 'token-abc',
      accountId: 'a',
      messageId: 'm-m4a',
      kind: 'audio',
    });

    const [key] = r2.put.mock.calls[0];
    expect(key).toBe('incoming-a-m-m4a.m4a');
    expect(result?.contentType).toBe('audio/mp4');
  });

  test('Content API が非 200 を返したら null', async () => {
    const r2 = makeR2Stub();
    const fetchMock = vi.fn(async () => new Response(null, { status: 401 }));

    const result = await fetchAndStoreIncomingMedia({
      r2: r2 as unknown as R2Bucket,
      fetch: fetchMock,
      workerUrl: 'https://worker.example.com',
      channelAccessToken: 'token-bad',
      accountId: 'acc-1',
      messageId: 'msg-y',
      kind: 'audio',
    });

    expect(result).toBeNull();
    expect(r2.put).not.toHaveBeenCalled();
  });

  test('R2 PUT が throw したら null', async () => {
    const r2 = makeR2Stub();
    r2.put.mockRejectedValueOnce(new Error('R2 down'));
    const fetchMock = vi.fn(async () =>
      new Response(new ArrayBuffer(50), { status: 200, headers: { 'Content-Type': 'audio/wav' } }),
    );

    const result = await fetchAndStoreIncomingMedia({
      r2: r2 as unknown as R2Bucket,
      fetch: fetchMock,
      workerUrl: 'https://worker.example.com',
      channelAccessToken: 'token-abc',
      accountId: 'acc-1',
      messageId: 'msg-z',
      kind: 'audio',
    });

    expect(result).toBeNull();
  });
});
