# 手動アップデートガイド

LINE Harness を手動で最新版に更新する手順です。

自動アップデート（管理画面のバナー / `create-line-harness update`）は、**公式リリースと構成が一致するインストール**（vanilla ビルド）でのみ利用できます。以下のような場合は自動更新の対象外になり、このガイドの手動手順で更新します:

- コードをカスタマイズしている（フォーク運用）
- 自前の CI/CD（GitHub Actions 等）でデプロイしている
- ビルドにバージョン情報が埋め込まれていない（`v0.0.0-dev` 表示）

> カスタマイズ版であること自体は問題ではありません。自動更新が「勝手にあなたの変更を上書きしない」ための安全装置として無効になるだけです。

## 方法 1: create-line-harness でインストールした場合

```bash
npx create-line-harness@latest update
```

vanilla ビルドであれば、バックアップ（ロールバック用スナップショット）付きで自動更新されます。

## 方法 2: git クローンして運用している場合

```bash
# 1. 最新を取得
git pull origin main

# 2. 依存を更新
pnpm install

# 3. DB マイグレーションを適用（未適用分のみ）
cd apps/worker
npx wrangler d1 migrations apply <your-database> --remote

# 4. デプロイ
npx wrangler deploy                      # Worker
pnpm --filter web build                  # 管理画面（Pages にデプロイ）
```

自前の CI/CD がある場合は main を pull / merge して push すれば通常のデプロイフローで反映されます。

## 方法 3: フォークして独自変更がある場合

1. upstream を remote に追加して取り込みます:

```bash
git remote add upstream https://github.com/Shudesu/line-harness-oss.git
git fetch upstream
git merge upstream/main   # コンフリクトがあれば解消
```

2. その後は方法 2 の手順 2〜4 と同じです。

## リリース情報

- 最新リリースと変更内容: [GitHub Releases](https://github.com/Shudesu/line-harness-oss/releases)
- リリースノート: [Release-Notes](Release-Notes.md)
