/**
 * 友だち追加直後に「今日はどちらのご用件か」を選んでもらうクイックリプライ。
 *
 * 【なぜ必要か】
 * この LINE 公式アカウントは (1) NFCグッズ販売 と (2) kimito.link（リンクツリーSNS）の
 * 「グレードアップ」相談の2つの窓口を兼ねている。follow イベント単体では
 * どちらの導線から来たか判別できない（LINE Messaging API の仕様上、経路情報は
 * source に乗らない）ため、クイックリプライで自己申告してもらう。
 *
 * 【経緯】2026-08-15
 * 元は PHP (kimito-link/src/api/line/webhook.php の send_greeting) に
 * 「あいさつ本文 + 2択クイックリプライ」の2通が実装されていた。
 * Webhook URL が Worker へ移行した際、この応答が移植されず
 * 「グレードアップしたい人がLINEに来ても案内が出ない」状態になっていた。
 *
 * 【★あいさつ本文はここでは送らない — 最重要】
 * 本番DBを実測したところ（2026-08-15）、friend_add シナリオ
 * 「Kimito-Link ウェルカム」(b0713a01-…) の step1 に
 * **PHP と同一のあいさつ本文が delay_minutes=0 で既に登録済み**だった。
 * つまり本番で欠けているのは **2択のクイックリプライだけ**。
 * ここで本文を再送すると **同じあいさつが2通届く**。
 * だからこのモジュールは「用件を選ぶ1通」だけを送る。
 * ★シナリオ側の step1 を消す/変える場合は、ここも一緒に見直すこと。
 *
 * 【★replyToken を使わない理由】
 * 上記シナリオ step1 は delay 0 のため、follow ハンドラが
 * **replyMessage で replyToken を使い切る**（webhook.ts の即時配信ブロック）。
 * ここで reply を使うと二重送信かどちらかの無言失敗になる。
 * そのため **必ず pushMessage で送る**（push は replyToken を消費しない）。
 */

import type { LineClient } from '@line-crm/line-sdk';

/** 用件の選択肢。ラベルと送信テキストは既存の応答定義と一致させること */
const MENU_PROMPT_TEXT = 'まず教えてください。今日はどちらのご用件でしょうか？';

/**
 * クイックリプライの選択肢。
 * ★ここの text を変えると、応答側（auto_replies / PHP のFAQ）とのマッチが外れる。
 * 変更するときは応答側も必ず一緒に直すこと。
 */
const MENU_ITEMS = [
  'NFCグッズのご相談',
  'kimito.linkのご相談',
] as const;

/** LINE の quickReply 形式に整形したメニューメッセージを組み立てる */
export function buildMenuSelectionMessage() {
  return {
    type: 'text' as const,
    text: MENU_PROMPT_TEXT,
    quickReply: {
      items: MENU_ITEMS.map((label) => ({
        type: 'action' as const,
        action: { type: 'message' as const, label, text: label },
      })),
    },
  };
}

/**
 * 送信するメッセージ一式。
 * ★あいさつ本文は含めない（シナリオ step1 が既に送っているため。冒頭コメント参照）。
 */
export function buildFollowGreetingMessages() {
  return [buildMenuSelectionMessage()];
}

/**
 * 用件選択のクイックリプライを送る。
 *
 * ★必ず push で送る（理由はファイル冒頭のコメント参照）。
 * 送信失敗は握りつぶしてログのみ残す — これが送れなくても
 * 友だち登録やシナリオ配信は続行させたいため（follow 全体を落とさない）。
 */
export async function sendFollowGreeting(
  lineClient: LineClient,
  userId: string,
): Promise<void> {
  try {
    await lineClient.pushMessage(userId, buildFollowGreetingMessages());
    console.log(`[follow] menu sent userId=${userId}`);
  } catch (err) {
    console.error('[follow] menu failed', err instanceof Error ? err.stack : String(err));
  }
}
