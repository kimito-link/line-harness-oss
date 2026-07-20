-- Bot送信済み動画6本（LP版/Bot送信テスト版 × 3キャラ）のSHA-256を登録する。
-- INSERT OR REPLACEなので、動画を再エンコードして再実行しても安全（sha256はPRIMARY KEY）。
INSERT OR REPLACE INTO bot_media_assets (sha256, character, kind, byte_length) VALUES
  ('6dec82a478847a79907b0e8a788a3361a089ab812548f204dfe54b655c33ab2d', 'りんく', 'bot-test', 204126),
  ('2c0b31a1ae0f5ae57ae3d5a2db34de654f44c59f12e45646339b70fd98b1e23c', 'こん太', 'bot-test', 190620),
  ('b5eb29177e69b76d332206fc9fcf9dced7ff25c62e74506844044b147b02a068', 'たぬ姉', 'bot-test', 207326),
  ('9e393a320a64e2513ca35de07f3285d90cd6c2461943868fc9fbec3fb7f0b3cc', 'りんく', 'lp-hero', 167982),
  ('229e336bb25f612fbad9dcc3a14a48f89f526cb1ebd8d65b75954d84b89a945e', 'こん太', 'lp-hero', 124753),
  ('84001dc2539640c31d692237147aaa72f0e318bfad1300d21d96f7757dc4ac13', 'たぬ姉', 'lp-hero', 140214);
