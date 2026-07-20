# 引き継ぎプロンプト — 2026-07-20 セッション終了時点

次のチャットの冒頭にこのファイルの内容をそのまま貼るか、「`_docs/HANDOFF-RESUME-2026-07-20.md`を読んで続きから」と伝えてください。

---

## リポジトリ構成（最重要・毎回混同しやすい）

作業ディレクトリ `line-bot` には3つのリモートがある。**用途を取り違えると誤ったところにpushする事故になる**（今回のセッションでも一度、第三者のOSS原作者リポジトリに誤PRを送る事故が発生し、原因究明・撤回に手間取った）。

| リモート名 | 実体 | 用途 |
|---|---|---|
| `fork` | `kimito-link/line-harness-oss` | **本物の本番デプロイ元**。Cloudflare Workers用GitHub Secrets（`CLOUDFLARE_API_TOKEN`等）がここに設定済み。Bot本体のコード変更（`apps/worker/**`, `bot.config.json`等）はここにpushしてから`gh workflow run deploy-cloudflare-worker.yml --repo kimito-link/line-harness-oss --ref main`でデプロイする |
| `origin` | `kimito-link/linebot` | LP（`apps/lp/`）専用の作業リポジトリ。Vercelにこちらをデプロイしている。LP関連の変更はここにpush |
| `shudesu` | `Shudesu/line-harness-oss` | **第三者（野田修一さん）が公開しているOSS原作者のリポジトリ**。今回のBotはこれをベースに構築したが、**ここには一切pushしない・PRも送らない**。過去に誤って送った事故があり、既にクローズ済み |

デプロイ手順（Bot本体を直す場合）:
```bash
git push fork main:main
gh workflow run deploy-cloudflare-worker.yml --repo kimito-link/line-harness-oss --ref main
# 完了待ち: gh run list --repo kimito-link/line-harness-oss --workflow=deploy-cloudflare-worker.yml --limit 3
```

デプロイ手順（LPを直す場合）:
```bash
git push origin main
cd apps/lp && npx --yes vercel --prod --yes
```

本番URL:
- りんくBot Worker: `https://kimitolink-line.info-a40.workers.dev`
- LP: `https://lp-eight-dusky.vercel.app/`

---

## 直近のセッションで起きたこと（時系列）

1. LP「君斗りんくの人格トーク」を新規制作・複数回改修（ブランド名変更、ロゴ変更、3者対話パネル化、OGP画像、AI直球コピーの言い換え等）
2. 「動画に反応しない」報告 → 調査の結果、動画・音声認識機能一式がローカルに実装済みのままpushされていなかったと判明 → `fork`にpushしてデプロイ、実機確認OK
3. 音声デモの長尺化を依頼され、VOICEVOXで31秒の音声を生成しBotに送信 → **無反応**という問題が発生
4. 原因調査で「15秒→28秒への延長が逆効果だった」ことが判明（`media-describe.ts`の`remaining >= timeoutMs + POST_DESCRIBE_MARGIN_MS(15秒)`というガード条件により、45秒の締め切りに対して余裕が無くなっていた）。22秒に戻して解決・実機確認OK
5. この過程で誤って`Shudesu/line-harness-oss`（第三者のOSS原作者リポジトリ）にPRを送ってしまう事故が発生。原因は`kimito-link/line-harness-oss`という自分のリポジトリと混同したこと。誤PRはクローズ済み、正しい`fork`リモートに直接pushして解決済み
6. LP埋め込み動画の要望 → キャラクター静止画（りんく・こん太・たぬ姉）を`ffmpeg`でKen Burns風ズーム動画化しLPの6箇所（ヒーロー3体+MORE THAN TEXTセクション3体）に埋め込み
7. 「動画がいまいち」「もっと良いものがいい」という評価で作り直しを依頼される
8. council-fableスキルで3段構え設計を実施。会議ハーネス→Fable設計→`_docs/CHARACTER-VIDEO-DESIGN.md`と`_docs/CHARACTER-VIDEO-IMPLEMENTATION-HANDOFF.md`を保存（コミット・push済み）

## 今ここ（次にやること）

**`_docs/CHARACTER-VIDEO-IMPLEMENTATION-HANDOFF.md`を読んで、そこに書かれた手順で実装に着手する。**

設計の要点だけ先に書くと:
- 前回の動画（単純ズームのみ、`apps/lp/assets/video/{link,konta,tanunee}-loop.mp4`）は「カメラだけが動きキャラは死んだ静止画」だったのが不評の原因
- 新設計は「キャラ自身（まばたき・口パク・表情変化・呼吸）を動かす」方式。ハードカット/周期カット/αフェードを動きの種類ごとに使い分け、キャラ別のストーリーボード（秒単位）で振り付ける
- LP用（8秒/480×480/crf22+maxrate800k）とLINE Bot送信テスト用（6秒/12fps/350kbps+無音AAC、Geminiのタイムアウト対策で軽量化）の2種類を作る
- Bot送信テスト用動画を実際にLINE公式アカウントに送り、Botが「自分自身の動画」に対して人格を保った自然な反応をするか確認する設計（自己外見カード方式）も含まれる
- 素材は`kimito-link/src/images/yukkuri-charactore-english/{link,konta,tanunee}/`の表情差分PNG（1500×1500、実在確認済み）
- **地雷**: こん太だけ命名が特殊（`kitsune-yukkuri-normal.png`が口開き相当、`kitsune-yukkuri-mouth-closed.png`が口閉じ相当）。Windows環境なのでffmpegの`filter_complex`は`-filter_complex_script`でファイル外出しし、Git Bashで実行する（PowerShellに複雑なfilter文字列を渡さない）。`bot.config.json`の`llm.video.timeoutMs`（22秒）は絶対に変更しない

## 実行環境の注意点（今回判明した制約）

- **OBS Studioは画面が見つからず起動確認できなかった**（複数モニター環境、Computer Useのdisplay切り替えでも発見できず）。動画埋め込みの実機動作確認は静止画スクリーンショット＋JS経由の`readyState`/`play()`チェックで代替した。実際のブラウザでの目視確認はできていない
- LINEデスクトップアプリはメッセージ送信時に**Alt+Enterで送信**（通常のEnterは改行になる設定になっている）
- ファイル添付ダイアログはExplorer扱いでcomputer-useの許可外エラーになることがあるが、ダイアログ内のファイル名欄への直接パス入力・ダブルクリック選択は動作する
- `curl --data-urlencode`で日本語テキストをVOICEVOX APIに渡すとGit Bash環境で文字化けすることがあった。Pythonで`urllib.parse.urlencode`を使う方が確実（`PYTHONIOENCODING=utf-8`環境変数を付与）

## 保留・未完了事項

- 新しい動画は**まだ1本も生成されていない**（設計のみ完了、実装はゼロから）
- Bot本体のプロンプトに「自己外見カード」を追加するかどうかは、まずBot版動画を送って現状の反応を見てから判断する（設計書C-1参照、恒久プロンプト変更は今回のスコープ外）
