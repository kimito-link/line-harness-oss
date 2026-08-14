/**
 * 友だち追加直後のあいさつ + 用件を選んでもらうクイックリプライ。
 *
 * 【なぜ必要か】
 * この LINE 公式アカウントは (1) NFCグッズ販売 と (2) kimito.link（リンクツリーSNS）の
 * 「グレードアップ」相談の2つの窓口を兼ねている。follow イベント単体では
 * どちらの導線から来たか判別できない（LINE Messaging API の仕様上、経路情報は
 * source に乗らない）ため、最初にクイックリプライで自己申告してもらう。
 *
 * 【経緯】2026-08-15
 * 元々この応答は PHP 側 (kimito-link/src/api/line/webhook.php の send_greeting) に
 * 実装されていたが、Webhook URL が Worker に移行した際に取り残され、
 * **友だち追加しても何も返らない = 課金導線が切れている** 状態が続いていた。
 * PHP を正本として Worker に移植したのがこのモジュール。
 *
 * 【★replyToken を使わない理由 — 触る人は必ず読むこと】
 * follow ハンドラは、friend_add シナリオの step1 が「遅延0」で組まれている場合
 * **既に replyMessage で replyToken を使い切っている**（webhook.ts の即時配信ブロック）。
 * ここで reply を使うと、シナリオがある環境で
 * 「二重送信」または「どちらかが無言で失敗」になる。
 * そのため、このあいさつは **必ず pushMessage で送る**。
 * push は replyToken を消費しないので、シナリオの有無に関係なく安全に共存する。
 */

import type { LineClient } from '@line-crm/line-sdk';

/** あいさつ本文（PHP の send_greeting と同一文言） */
const GREETING_TEXT =
  'はじめまして、Kimito-Link（君斗りんく）です。🌸\n\n' +
  '数ある中から、私たちを見つけてくださり本当にありがとうございます。\n\n' +
  'この場所が、あなたにとってあたたかく、心地よいものになりますように。' +
  'これからどうぞ、よろしくお願いいたします。✨';

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

/** あいさつ + メニューの2通を組み立てる（送信はしない。テストから検証しやすくするため分離） */
export function buildFollowGreetingMessages() {
  return [
    { type: 'text' as const, text: GREETING_TEXT },
    buildMenuSelectionMessage(),
  ];
}

/**
 * あいさつを送る。
 *
 * ★必ず push で送る（理由はファイル冒頭のコメント参照）。
 * 送信失敗は握りつぶしてログのみ残す — あいさつが送れなくても
 * 友だち登録やシナリオ配信は続行させたいため（follow 全体を落とさない）。
 */
export async function sendFollowGreeting(
  lineClient: LineClient,
  userId: string,
): Promise<void> {
  try {
    await lineClient.pushMessage(userId, buildFollowGreetingMessages());
    console.log(`[follow] greeting sent userId=${userId}`);
  } catch (err) {
    console.error('[follow] greeting failed', err instanceof Error ? err.stack : String(err));
  }
}
