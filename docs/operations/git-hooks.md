# Git hooks（opt-in）

コミット前に **ステージ済みファイルのみ** を対象にした軽量チェックを行う pre-commit フックを `tools/git-hooks/pre-commit` に用意している。

- 対象: `git diff --cached` でステージされたファイルのみ（リポジトリ全体は対象外）
- 実行内容:
  - ステージされた `.ts` / `.tsx` / `.mjs` に対して `pnpm exec eslint --max-warnings=0`
  - ステージされた Prettier 対象拡張子（`.js` `.jsx` `.ts` `.tsx` `.mjs` `.cjs` `.json` `.md` `.yml` `.yaml` `.css`。`pnpm-lock.yaml` は除外）に対して `pnpm exec prettier --check`
- **含まない**: `typecheck` / `build` / 全量 `test` などの重い検証。これらは CI や `.agent-loop` の gate 側で行う（`.agent-loop/GATE_CONFIG.md` 参照）。

## 有効化（opt-in）

デフォルトでは無効。使いたい開発者だけが以下を実行する。

```bash
pnpm hooks:install
```

内部的には `git config core.hooksPath tools/git-hooks` を設定するだけ。リポジトリの `.git/config` はローカル設定のため、各自の環境で個別に実行する必要がある（自動では有効化されない）。

無効化して標準の `.git/hooks` に戻す場合:

```bash
git config --unset core.hooksPath
```

## 1回だけスキップする

```bash
SKIP_HOOKS=1 git commit -m "..."
```

## 注意

- フック本体（`tools/git-hooks/pre-commit`）は bash 3.2（macOS 標準）でも動くように書かれている（`mapfile` 等の bash4 専用機能は不使用）。
- ステージ後に作業ツリーから削除されたファイルはスキップする（存在チェック済み）。
