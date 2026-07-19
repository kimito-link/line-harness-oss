/**
 * LINE Content APIから受信動画・音声バイナリを取得しR2に保存する
 * （2026-07-19動画・音声認識機能追加。incoming-image.tsと同じ設計）。
 */

const LINE_CONTENT_API_BASE = 'https://api-data.line.me/v2/bot/message';

const VIDEO_CONTENT_TYPE_TO_EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-msvideo': 'avi',
  'video/webm': 'webm',
  'video/3gpp': '3gp',
};

const AUDIO_CONTENT_TYPE_TO_EXT: Record<string, string> = {
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/mp3': 'mp3',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
};

export interface FetchAndStoreMediaOptions {
  r2: R2Bucket;
  /** workers 環境では globalThis.fetch を使う。テスト時に注入する。 */
  fetch?: typeof fetch;
  /** 公開 URL のベース (例: https://your-worker.your-subdomain.workers.dev) */
  workerUrl: string;
  channelAccessToken: string;
  accountId: string;
  messageId: string;
  /** LINE Content APIはmessage.typeを返さないため、拡張子解決テーブルの選択に呼び出し側から渡す。 */
  kind: 'video' | 'audio';
}

export interface IncomingMediaRefs {
  originalContentUrl: string;
  /** describe用にR2二度読みを避けるため、取得済みバイナリをそのまま返す。 */
  bytes: ArrayBuffer;
  contentType: string;
}

/**
 * LINE Content API から incoming 動画/音声バイナリを取得し R2 に保存して URL を返す。
 * 失敗時は null を返し、呼び出し元は `[動画]`/`[音声]` ラベルフォールバックを使う。
 */
export async function fetchAndStoreIncomingMedia(
  opts: FetchAndStoreMediaOptions,
): Promise<IncomingMediaRefs | null> {
  const fetcher = opts.fetch ?? fetch;
  const extTable = opts.kind === 'video' ? VIDEO_CONTENT_TYPE_TO_EXT : AUDIO_CONTENT_TYPE_TO_EXT;

  let res: Response;
  try {
    res = await fetcher(`${LINE_CONTENT_API_BASE}/${opts.messageId}/content`, {
      headers: { Authorization: `Bearer ${opts.channelAccessToken}` },
    });
  } catch (err) {
    console.error('incoming-media: fetch failed', { err, messageId: opts.messageId, accountId: opts.accountId, kind: opts.kind });
    return null;
  }

  if (!res.ok) {
    console.error('incoming-media: non-200', { status: res.status, messageId: opts.messageId, accountId: opts.accountId, kind: opts.kind });
    return null;
  }

  const contentType = res.headers.get('Content-Type')?.split(';')[0].trim() ?? 'application/octet-stream';
  const ext = extTable[contentType];
  if (!ext) {
    console.error('incoming-media: unsupported content-type', { contentType, messageId: opts.messageId, accountId: opts.accountId, kind: opts.kind });
    return null;
  }
  const safeAccountId = opts.accountId.replace(/[^a-zA-Z0-9-]/g, '_');
  const safeMessageId = opts.messageId.replace(/[^a-zA-Z0-9-]/g, '_');
  const key = `incoming-${safeAccountId}-${safeMessageId}.${ext}`;

  let data: ArrayBuffer;
  try {
    data = await res.arrayBuffer();
  } catch (err) {
    console.error('incoming-media: arrayBuffer failed', { err, messageId: opts.messageId, accountId: opts.accountId, kind: opts.kind });
    return null;
  }

  try {
    await opts.r2.put(key, data, { httpMetadata: { contentType } });
  } catch (err) {
    console.error('incoming-media: R2 put failed', { err, messageId: opts.messageId, accountId: opts.accountId, kind: opts.kind });
    return null;
  }

  const base = opts.workerUrl.replace(/\/$/, '');
  const url = `${base}/images/${key}`;
  return { originalContentUrl: url, bytes: data, contentType };
}
