import { Hono } from 'hono';
import type { Env } from '../index.js';

const diag = new Hono<Env>();

// /shindan/ 診断ページ（2026-07-18追加）が叩くエンドポイント。scripts/check-bot-silence.mjs
// と同じD1クエリ・同じ判定ロジックをWorker内エンドポイントとして移植したもの
// （ローカルからwrangler経由でしか実行できないCLIスクリプトの代わりに、ブラウザから
// パスワードだけで見られるようにする。実装は二重化せず、両者は独立に同じロジックを持つ）。
//
// fail-closed: D1取得自体が失敗したらqueryErrorとして返し、沈黙を「異常なし」と誤読させない。

const SILENCE_HUMAN_MINUTES_DEFAULT = 60;
const SILENCE_REPLY_MINUTES_DEFAULT = 10;

function minutesAgo(isoString: string): number {
  const then = new Date(isoString).getTime();
  return (Date.now() - then) / 60000;
}

interface HumanStuckRow {
  id: string;
  line_user_id: string;
  display_name: string | null;
  updated_at: string;
}

interface SilenceCandidateRow {
  id: string;
  line_user_id: string;
  display_name: string | null;
  ai_reply_mode: string | null;
  last_incoming: string | null;
  last_outgoing: string | null;
}

diag.get('/api/diag/bot-health', async (c) => {
  const configuredPassword = c.env.DIAG_VIEW_PASSWORD;
  if (!configuredPassword) {
    // 未設定時はfail-closed（誰でも見られる状態を既定にしない）。
    return c.json({ success: false, error: 'not_configured' }, 503);
  }
  const providedPassword = c.req.header('x-diag-password');
  if (!providedPassword || providedPassword !== configuredPassword) {
    return c.json({ success: false, error: 'unauthorized' }, 401);
  }

  const db = c.env.DB;
  const silenceHumanMinutes = Number(c.req.query('humanMinutes')) || SILENCE_HUMAN_MINUTES_DEFAULT;
  const silenceReplyMinutes = Number(c.req.query('replyMinutes')) || SILENCE_REPLY_MINUTES_DEFAULT;

  try {
    const humanStuckRows = await db
      .prepare(`SELECT id, line_user_id, display_name, updated_at FROM friends WHERE ai_reply_mode = 'human'`)
      .all<HumanStuckRow>();
    const humanStuck = humanStuckRows.results
      .filter((f) => minutesAgo(f.updated_at) >= silenceHumanMinutes)
      .map((f) => ({
        id: f.id,
        displayName: f.display_name,
        lineUserId: f.line_user_id,
        minutesStuck: Math.round(minutesAgo(f.updated_at)),
      }));

    const candidateRows = await db
      .prepare(
        `SELECT
          f.id, f.line_user_id, f.display_name, f.ai_reply_mode,
          (SELECT MAX(created_at) FROM messages_log WHERE friend_id = f.id AND direction = 'incoming') AS last_incoming,
          (SELECT MAX(created_at) FROM messages_log WHERE friend_id = f.id AND direction = 'outgoing') AS last_outgoing
         FROM friends f
         WHERE f.is_following = 1`,
      )
      .all<SilenceCandidateRow>();

    const silentFriends = candidateRows.results
      .filter((r) => {
        if (!r.last_incoming) return false; // 一度も話しかけられていない友だちは対象外
        if (r.ai_reply_mode === 'human') return false; // 上のhumanStuckで別途検知済み（二重報告しない）
        const incomingAge = minutesAgo(r.last_incoming);
        if (incomingAge < silenceReplyMinutes) return false; // まだ返信猶予内
        if (!r.last_outgoing) return true;
        return new Date(r.last_outgoing).getTime() < new Date(r.last_incoming).getTime();
      })
      .map((r) => ({
        id: r.id,
        displayName: r.display_name,
        lineUserId: r.line_user_id,
        lastIncoming: r.last_incoming,
        lastOutgoing: r.last_outgoing,
      }));

    return c.json({
      success: true,
      data: {
        checkedAt: new Date().toISOString(),
        config: { silenceHumanMinutes, silenceReplyMinutes },
        humanStuck,
        silentFriends,
        queryError: null,
      },
    });
  } catch (err) {
    console.error('[diag] bot-health query failed', err instanceof Error ? err.stack : String(err));
    return c.json({
      success: true,
      data: {
        checkedAt: new Date().toISOString(),
        config: { silenceHumanMinutes, silenceReplyMinutes },
        humanStuck: [],
        silentFriends: [],
        queryError: err instanceof Error ? err.message : String(err),
      },
    });
  }
});

// GET /shindan — 診断ビューア（2026-07-18追加）。soushin-suggest.link/shindan/index.html の
// 思想（人間は色とカード、AIはボタン1つで判定+生JSONを受け取る）を踏襲。差異: あちらはクライアント
// アプリのカウンターをコピー&ペーストする方式だが、こちらは診断対象(friends/messages_log)が
// 既にサーバー(D1)側にあるため、貼り付けではなくfetch(/api/diag/bot-health)で完結させる。
// パスワードはメモリ内(sessionStorage含め保存しない)のみ保持し、毎回入力させる。
diag.get('/shindan', (c) => c.html(SHINDAN_HTML));

const SHINDAN_HTML = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; base-uri 'none'">
<meta name="robots" content="noindex">
<title>りんくBot 診断ビューア</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  body {
    font-family: "Meiryo UI", "Hiragino Kaku Gothic ProN", sans-serif;
    max-width: 900px;
    margin: 0 auto;
    padding: 16px;
    line-height: 1.6;
    background: #f5f7fa;
    color: #1a1a1a;
  }
  header { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
  header h1 { font-size: 20px; margin: 0; }
  #verMeta { color: #666; font-size: 13px; }
  .card { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 12px 16px; margin-bottom: 12px; }
  .card.intro { background: #eef6ff; border-color: #bcdcff; font-size: 14px; }
  #pwGate { margin-bottom: 12px; }
  #pwInput { padding: 8px 10px; font-size: 14px; border: 1px solid #99a; border-radius: 6px; margin-right: 8px; }
  #btnPw { padding: 8px 16px; border: none; border-radius: 6px; background: #4a6fd1; color: #fff; cursor: pointer; font-size: 14px; }
  .verdict { font-size: 15px; font-weight: bold; padding: 14px 16px; border-radius: 8px; margin-bottom: 8px; }
  .verdict.red { background: #ffe3e3; color: #a80000; border: 1px solid #f5a3a3; }
  .verdict.yellow { background: #fff6d8; color: #7a5c00; border: 1px solid #f0d878; }
  .verdict.green { background: #e2f7e6; color: #146c2e; border: 1px solid #a7e3b3; }
  .verdict.gray { background: #eee; color: #555; border: 1px solid #ccc; }
  .verdict-note { font-size: 13px; color: #666; margin: -4px 0 12px; }
  .share {
    display: block; width: 100%; padding: 12px; margin-bottom: 20px; border: none; border-radius: 8px;
    background: linear-gradient(90deg, #ff7a59, #ff5c8a); color: #fff; font-weight: bold; font-size: 14px; cursor: pointer;
  }
  main section { margin-bottom: 20px; }
  main h2 { font-size: 15px; margin: 0 0 8px; color: #333; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; }
  .kcard { border-radius: 8px; padding: 10px 12px; border: 1px solid #ddd; background: #fafafa; }
  .kcard .label { font-size: 12px; color: #555; }
  .kcard .value { font-size: 18px; font-weight: bold; margin: 2px 0; }
  .kcard .msg { font-size: 12px; color: #444; margin-top: 4px; }
  .kcard.red { background: #ffe3e3; border-color: #f5a3a3; }
  .kcard.yellow { background: #fff6d8; border-color: #f0d878; }
  .kcard.green { background: #e2f7e6; border-color: #a7e3b3; }
  .kcard.gray { background: #f0f0f0; border-color: #ddd; color: #888; }
  .kcard.gray .value { color: #aaa; }
  #privacy { font-size: 13px; color: #444; }
  #privacy b { color: #111; }
  #privacy ul { margin: 6px 0; padding-left: 20px; }
  #refreshBtn {
    padding: 6px 14px; border: 1px solid #99a; border-radius: 6px; background: #fff; cursor: pointer; font-size: 13px;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #14161a; color: #e6e6e6; }
    .card { background: #1e2127; border-color: #333; }
    .card.intro { background: #17263a; border-color: #2a4a6e; }
    .kcard { background: #1a1c20; border-color: #333; }
    .kcard.gray { background: #22252b; color: #888; }
    .kcard.red { background: #3a1414; border-color: #6e2626; }
    .kcard.red .value, .kcard.red .label, .kcard.red .msg { color: #ff9d9d; }
    .kcard.yellow { background: #3a3012; border-color: #6e5a20; }
    .kcard.yellow .value, .kcard.yellow .label, .kcard.yellow .msg { color: #f5d878; }
    .kcard.green { background: #123a1e; border-color: #1f6e3a; }
    .kcard.green .value, .kcard.green .label, .kcard.green .msg { color: #7de3a0; }
    .verdict.red { background: #3a1414; color: #ff9d9d; border-color: #6e2626; }
    .verdict.yellow { background: #3a3012; color: #f5d878; border-color: #6e5a20; }
    .verdict.green { background: #123a1e; color: #7de3a0; border-color: #1f6e3a; }
    .verdict.gray { background: #2a2d33; color: #ccc; border-color: #444; }
    .verdict-note { color: #999; }
    #privacy { color: #ccc; }
    #privacy b { color: #fff; }
    #verMeta { color: #999; }
    main h2 { color: #ccc; }
    #refreshBtn { background: #1a1c20; color: #e6e6e6; border-color: #556; }
  }
</style>
</head>
<body>
  <header>
    <h1>りんくBot 状態診断</h1>
    <span id="verMeta">— パスワードを入力すると最新状態が表示されます —</span>
  </header>

  <section id="intro" class="card intro">
    <p>🔒 パスワードを入力すると、このWorkerのD1データ（無応答検知の判定結果のみ）を取得して表示します。会話内容・個人情報は取得しません。</p>
  </section>

  <section id="pwGate" class="card">
    <p>🔑 パスワードを入力してください。</p>
    <input id="pwInput" type="password" placeholder="パスワード" autocomplete="off">
    <button id="btnPw">表示する</button>
    <p id="pwError" class="verdict-note" hidden>パスワードが違います。</p>
  </section>

  <div id="verdict" class="verdict gray">まだ取得していません</div>
  <p id="verdictNote" class="verdict-note" hidden></p>
  <button id="btnShare" class="share" hidden>この結果をコピーしてAIに相談（原因が全部わかる1枚）</button>
  <button id="refreshBtn" hidden>再取得</button>

  <main id="cards" hidden>
    <section data-sec="humanStuck"><h2>human モードのまま放置（要: bot に戻すか確認）</h2><div class="grid"></div></section>
    <section data-sec="silentFriends"><h2>直近メッセージに未応答（要: 原因調査）</h2><div class="grid"></div></section>
  </main>

  <section id="privacy" class="card">
    <b>🔒 プライバシー</b>
    <ul>
      <li>このページはパスワード入力時のみ <code>/api/diag/bot-health</code> にfetchします。取得するのは friend の id・表示名・ai_reply_mode・最終メッセージ日時のみで、メッセージ本文は含まれません。</li>
      <li>パスワードはこのページのメモリ内でのみ保持され、保存しません（ページを閉じれば消えます。Cookie・localStorage不使用）。</li>
    </ul>
  </section>

<script>
(function () {
  'use strict';

  var $pwGate = document.getElementById('pwGate');
  var $pwInput = document.getElementById('pwInput');
  var $pwError = document.getElementById('pwError');
  var $btnPw = document.getElementById('btnPw');
  var $verdict = document.getElementById('verdict');
  var $verdictNote = document.getElementById('verdictNote');
  var $btnShare = document.getElementById('btnShare');
  var $refreshBtn = document.getElementById('refreshBtn');
  var $cards = document.getElementById('cards');
  var $verMeta = document.getElementById('verMeta');

  var diagPassword = null; // メモリのみ保持。保存しない(毎回入力する設計)。
  var lastData = null;

  function renderCard(sectionEl, item) {
    var div = document.createElement('div');
    div.className = 'kcard red';
    var label = document.createElement('div');
    label.className = 'label';
    label.textContent = item.displayName || item.lineUserId;
    var value = document.createElement('div');
    value.className = 'value';
    value.textContent = item.value;
    var msg = document.createElement('div');
    msg.className = 'msg';
    msg.textContent = item.message;
    div.appendChild(label);
    div.appendChild(value);
    div.appendChild(msg);
    sectionEl.appendChild(div);
  }

  function emptyCard(sectionEl, text) {
    var div = document.createElement('div');
    div.className = 'kcard green';
    var value = document.createElement('div');
    value.className = 'value';
    value.textContent = text;
    div.appendChild(value);
    sectionEl.appendChild(div);
  }

  function render(data) {
    lastData = data;
    $verMeta.textContent = '取得時刻: ' + data.checkedAt +
      '（human判定しきい値' + data.config.silenceHumanMinutes + '分・未応答判定しきい値' + data.config.silenceReplyMinutes + '分）';

    var humanSec = document.querySelector('section[data-sec="humanStuck"] .grid');
    var silentSec = document.querySelector('section[data-sec="silentFriends"] .grid');
    humanSec.innerHTML = '';
    silentSec.innerHTML = '';

    if (data.queryError) {
      $verdict.className = 'verdict red';
      $verdict.textContent = '⚠ D1取得に失敗（＝「問題なし」ではなく確認不能）: ' + data.queryError;
      $verdictNote.hidden = true;
      $cards.hidden = true;
      $btnShare.hidden = false;
      $refreshBtn.hidden = false;
      return;
    }

    data.humanStuck.forEach(function (f) {
      renderCard(humanSec, {
        displayName: f.displayName, lineUserId: f.lineUserId,
        value: f.minutesStuck + '分放置',
        message: 'ai_reply_mode=human のまま' + f.minutesStuck + '分放置されています。botに戻すべきか確認してください。'
      });
    });
    if (!data.humanStuck.length) emptyCard(humanSec, 'なし');

    data.silentFriends.forEach(function (f) {
      renderCard(silentSec, {
        displayName: f.displayName, lineUserId: f.lineUserId,
        value: '未応答',
        message: '最終incoming: ' + f.lastIncoming + '、最終outgoing: ' + (f.lastOutgoing || '(一度も無し)')
      });
    });
    if (!data.silentFriends.length) emptyCard(silentSec, 'なし');

    $cards.hidden = false;
    $btnShare.hidden = false;
    $refreshBtn.hidden = false;

    if (data.humanStuck.length || data.silentFriends.length) {
      $verdict.className = 'verdict red';
      var parts = [];
      if (data.humanStuck.length) parts.push('humanモード放置 ' + data.humanStuck.length + '件');
      if (data.silentFriends.length) parts.push('未応答 ' + data.silentFriends.length + '件');
      $verdict.textContent = '異常の証拠あり: ' + parts.join('・');
      $verdictNote.hidden = true;
    } else {
      $verdict.className = 'verdict green';
      $verdict.textContent = '異常の証拠なし';
      $verdictNote.hidden = true;
    }
  }

  function fetchHealth() {
    fetch('/api/diag/bot-health', { cache: 'no-store', headers: { 'X-Diag-Password': diagPassword || '' } })
      .then(function (res) {
        if (res.status === 401) {
          $pwGate.hidden = false;
          $pwError.hidden = false;
          diagPassword = null;
          return null;
        }
        if (res.status === 503) {
          $verdict.className = 'verdict red';
          $verdict.textContent = 'サーバー側でDIAG_VIEW_PASSWORDが未設定です（管理者に確認してください）。';
          return null;
        }
        if (!res.ok) throw new Error('http ' + res.status);
        $pwGate.hidden = true;
        return res.json();
      })
      .then(function (body) {
        if (!body) return;
        if (!body.success) {
          $verdict.className = 'verdict red';
          $verdict.textContent = '取得に失敗しました: ' + (body.error || 'unknown');
          return;
        }
        render(body.data);
      })
      .catch(function () {
        $verdict.className = 'verdict red';
        $verdict.textContent = '診断データの取得に失敗しました。ページを再読み込みしてください。';
      });
  }

  $btnPw.addEventListener('click', function () {
    diagPassword = $pwInput.value;
    fetchHealth();
  });
  $pwInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') $btnPw.click();
  });
  $refreshBtn.addEventListener('click', fetchHealth);

  $btnShare.addEventListener('click', function () {
    if (!lastData) return;
    var lines = [];
    lines.push('[りんくBot診断 / 取得時刻 ' + lastData.checkedAt + ']');
    lines.push('総合判定: ' + $verdict.textContent);
    lines.push('--- 生データ ---');
    lines.push(JSON.stringify(lastData));
    var text = lines.join('\\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        $btnShare.textContent = 'コピーしました！AIチャットに貼り付けてください';
        setTimeout(function () { $btnShare.textContent = 'この結果をコピーしてAIに相談（原因が全部わかる1枚）'; }, 2000);
      }).catch(function () {
        $btnShare.textContent = 'コピーに失敗しました。手動で選択してコピーしてください';
      });
    }
  });
})();
</script>
</body>
</html>`;

export { diag };
