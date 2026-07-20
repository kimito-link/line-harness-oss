-- Bot送信済み動画のSHA-256完全一致レジストリ（自己言及Tier 0、2026-07-20）。
-- ユーザーが送り返した動画がここに登録済みのハッシュと一致すれば、Geminiの
-- 客観描写を経由せず決定的に「自分自身の動画」と判定できる（表現ゆれの問題を回避）。
CREATE TABLE IF NOT EXISTS bot_media_assets (
  sha256 TEXT PRIMARY KEY,
  character TEXT NOT NULL,
  kind TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  registered_at TEXT NOT NULL DEFAULT (datetime('now'))
);
