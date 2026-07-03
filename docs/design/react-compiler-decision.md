# React Compiler 方針決定（W1-14）

- 目的: React Compiler（旧 babel-plugin-react-compiler、Next 16 では `reactCompiler` として安定化）を本プロジェクトで有効化するかどうかの方針を確定する。現状把握・有効化手順・撤去 vs 容認の比較・推奨案・検証手順をまとめる。
- スコープ: **本ドキュメントはコード変更を含まない**。有効化する場合の実装は別スライスで行う。

---

## 1. 現状（2026-07-03 時点、repo 実測）

| 項目                                | 状態                                                                                                                                                |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `next.config.ts` の `reactCompiler` | **未設定**（`src/../next.config.ts` に `reactCompiler` キーなし。`experimental` にも同等の記載なし）                                                |
| `babel-plugin-react-compiler` 依存  | **未導入**。`pnpm-lock.yaml` 上は `next@16.2.9` の **optional peerDependency** として名前が出るのみで、`package.json` の実 devDependencies には無い |
| `react` / `react-dom`               | `19.2.7`（React Compiler が要求する 19 系を満たす）                                                                                                 |
| `next`                              | `16.2.9`（`reactCompiler` が `experimental` から stable に昇格した版）                                                                              |
| ビルドツールチェーン                | `dev` = `next dev --turbopack` / `build` = `next build --webpack`（明示的に webpack 固定。理由はコメントなし、Sentry/Serwist 併用起因の可能性）     |
| 手動 `useMemo` 使用                 | **68 ファイル**（`grep -rl "useMemo(" src` 実測。CLAUDE.md 記載の 62 は先行スナップショットで、現在は増加）                                         |
| 手動 `useCallback` 使用             | **48 ファイル**（同上。CLAUDE.md 記載の 33 から増加）                                                                                               |
| `React.memo` 使用                   | 1 箇所のみ                                                                                                                                          |
| class component                     | 1 箇所のみ（Error Boundary 用途と推定。React Compiler は class を素通しするため対象外）                                                             |
| `forwardRef` 使用                   | 2 箇所                                                                                                                                              |
| ESLint react-hooks プラグイン       | `eslint-plugin-react-hooks@7.1.1`（`eslint-config-next@16.2.9` 経由、`core-web-vitals` の `recommended` プリセットに含まれる）                      |

### 1.1 重要な既知事実: コンパイラ診断 lint は「既にオン」

`eslint-config-next` が束ねる `eslint-plugin-react-hooks@7.1.1` の `recommended` 設定は、React Compiler 本体を有効化していなくても以下を **常時 error/warn で強制**している（`next.config.ts` の `reactCompiler` フラグとは独立に動作するスタティック解析ルール）。

```json
{
  "react-hooks/rules-of-hooks": "error",
  "react-hooks/exhaustive-deps": "warn",
  "react-hooks/static-components": "error",
  "react-hooks/use-memo": "error",
  "react-hooks/preserve-manual-memoization": "error",
  "react-hooks/incompatible-library": "warn",
  "react-hooks/immutability": "error",
  "react-hooks/globals": "error",
  "react-hooks/refs": "error",
  "react-hooks/set-state-in-effect": "error",
  "react-hooks/error-boundaries": "error",
  "react-hooks/purity": "error",
  "react-hooks/set-state-in-render": "error",
  "react-hooks/unsupported-syntax": "warn",
  "react-hooks/config": "error",
  "react-hooks/gating": "error"
}
```

`grep -rn "eslint-disable.*react-hooks/(preserve-manual-memoization|purity|immutability|set-state-in-(effect|render)|static-components|use-memo|refs|globals)"` は **0 件**。つまり現行コードはこれら compiler-readiness 系ルールの抑制なしで `pnpm lint` を通過している（＝コンパイラが嫌う典型パターン — render 中の副作用、mutable なグローバル参照、render 中の setState、条件付き early-return 後の hooks 呼び出し等 — が既に静的にゼロであることが、コード変更前から一定担保されている）。これは「有効化リスクが低い」ことの実測エビデンスであり、CLAUDE.md の既存メモ（React Compiler 採用前提、手動 useMemo は `preserve-manual-memoization` lint 対象）とも整合する。

---

## 2. Next 16.2 / React 19.2 での有効化手順

Next.js 16 では `reactCompiler` は `experimental` から **stable な top-level キー**に昇格済み（`next build --webpack` / `next dev --turbopack` の双方で動作する Babel ベースの変換）。

```ts
// next.config.ts
const nextConfig: NextConfig = {
  reactCompiler: true, // または { compilationMode: 'annotation' | 'infer' | 'all', panicThreshold: 'none' | 'critical_errors' | 'all_errors' }
  // ...既存設定
};
```

1. `pnpm add -D babel-plugin-react-compiler` — Next 16 で Babel ベースのコンパイラを使う場合は**必須**（Next のドキュメントで明記。webpack ビルドではこの経路のみが選択肢）。
2. `next.config.ts` に `reactCompiler: true` を追加。段階導入したい場合は `{ compilationMode: 'annotation' }` にして `"use memo"` ディレクティブを付けたコンポーネントのみ最適化対象にすることも可能（全面適用は `'infer'`、デフォルト相当）。
3. **`experimental.turbopackRustReactCompiler` は使わない**。この Rust 版コンパイラは **Turbopack 専用**で、`webpack` と併用するとビルドエラーになる（Next 公式ドキュメントで明記）。本プロジェクトは `pnpm build` が `next build --webpack` を明示指定しているため、Rust 版を選ぶと本番ビルドが壊れる。Babel 版（`reactCompiler: true` のみ、`turbopackRustReactCompiler` 未指定）であれば `--webpack` と `--turbopack`（dev）の両方で動作するため、こちらが唯一の整合する選択肢。
4. ESLint 側は追加設定不要（`eslint-plugin-react-hooks@7.1.1` の `recommended` は既に compiler-readiness ルール一式を含んでいる。§1.1 参照）。
5. 有効化後、手動 `useMemo`/`useCallback`/`React.memo` は**削除しなくても動作する**（コンパイラは既存の手動メモ化を「正しければ」尊重し、`preserve-manual-memoization` ルールが「壊れた手動メモ化」を継続的に検知する）。段階撤去は任意のタイミングで実施可能で、有効化自体とは独立したスライスにできる。

---

## 3. 互換リスク

| リスク                                                                                        | 深刻度 | 根拠・緩和                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| webpack ビルド (`pnpm build`) と turbopack dev (`pnpm dev`) でコンパイラの適用経路が異なる    | 中     | Babel 版 (`reactCompiler: true`、Rust 版フラグなし) を使えば両方とも同じ Babel トランスフォームが通る想定だが、**dev(turbopack)とbuild(webpack)の両方で実機確認が必須**（§4 検証手順）                                                                                              |
| Sentry の `webpack.reactComponentAnnotation.enabled: true` との相互作用                       | 低〜中 | Sentry の component annotation は babel/webpack loader レベルでコンポーネント名を注入する機能。React Compiler の Babel plugin も同じ webpack パイプラインに挟まるため、**プラグイン適用順序**でビルド時間増加・稀に変換の二重適用が起きうる。ビルド成功可否とバンドルサイズで確認要 |
| render 中の副作用・mutable ref 読み取り等、コンパイラが誤検知/誤最適化しうるコードパターン    | 低     | §1.1 の通り `purity`/`immutability`/`refs`/`globals`/`set-state-in-render` 系ルールが lint で常時 error になっており、違反ゼロを実測済み。ただし lint はヒューリスティックであり compiler 本体の判定と100%一致する保証はない（`panicThreshold`調整で緩和可）                        |
| E2E/unit テストがコンポーネントの再レンダー回数・参照同一性 (`toBe`) に依存している場合の破綻 | 低〜中 | 未調査（テスト実装の悉皆確認は本ドキュメントの範囲外）。有効化スライスの検証手順で `pnpm test` full run を含めて確認する                                                                                                                                                            |
| PWA/Service Worker (`@serwist/next`) 側のビルド出力への影響                                   | 低     | Serwist は `sw.ts` を別途 `tsconfig.sw.json` でビルドしており、`reactCompiler` は React コンポーネントの変換のみが対象。SW 側コードパスへの影響は原理上なし                                                                                                                         |
| ビルド時間増加                                                                                | 低〜中 | Babel 変換パスが1本増えるため増加は不可避。Next 16 のドキュメントでも「ビルドパフォーマンスのデータ収集継続中のためデフォルト無効」と明記されている（stable 昇格済みだがデフォルト ON ではない）                                                                                    |

---

## 4. 比較: 有効化+段階撤去 vs 方針撤回（手動 memo 容認）

| 観点                       | A. 有効化 + 手動 memo 段階撤去                                                                                                    | B. 方針撤回（手動 memo 容認、コンパイラ非導入）                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 実装コスト                 | 低（`next.config.ts` 1行 + devDependency 1つ）。撤去自体は任意タイミングで段階的に実施可能、有効化とは独立                        | ゼロ（現状維持）                                                                                               |
| 既存コードへの影響         | 手動 memo は動作継続（`preserve-manual-memoization` が保護）。撤去しない限りコード変更不要                                        | 影響なし                                                                                                       |
| リスクの実測状況           | §1.1 の通り compiler-readiness lint ルール一式が既に error 設定・違反ゼロ。実質的な有効化リスクは低いことが repo 実測で裏付け済み | N/A                                                                                                            |
| 今後の新規コードの一貫性   | 新規コードで手動 memo が不要になり、`useMemo`/`useCallback` の依存配列ミス（exhaustive-deps 系バグ）が構造的に減る                | 現状通り 68+48 ファイルの手動 memo が今後も増え続け、依存配列の保守負荷・レビュー負荷は継続                    |
| ロールバック容易性         | `reactCompiler` を `false`/削除すれば即座に無効化可能（Babel plugin を外すだけ）                                                  | N/A（そもそも変更しない）                                                                                      |
| CLAUDE.md 既存前提との整合 | 整合（"React Compiler採用、手動useMemoはpreserve-manual-memoization lint" というプロジェクト既存前提と一致）                      | **既存前提と矛盾**。CLAUDE.md/gbrain には既に「React Compiler 採用」の記述があり、撤回は文書の巻き戻しを要する |
| 検証コスト                 | 中（§5 の検証手順一式が必要。1回のスライスで完結）                                                                                | ゼロ                                                                                                           |

---

## 5. 推奨案

**A. 有効化する（Babel 版 `reactCompiler: true`、`turbopackRustReactCompiler` は使わない）。撤去は必須ではなく任意の後続スライス。**

根拠:

1. `next@16.2.9` + `react@19.2.7` は要件を満たし、Next 側でも `reactCompiler` が stable 化済みで導入障壁が低い（config 1行 + devDependency 1つ）。
2. 最大の懸念であった「既存コードのコンパイラ非互換パターン」は、`eslint-plugin-react-hooks@7.1.1` の compiler-readiness ルール一式（`purity`/`immutability`/`set-state-in-render`/`set-state-in-effect`/`refs`/`globals`/`static-components`/`preserve-manual-memoization` 等）が**既に error 設定で有効**であり、抑制コメントが0件であることを実測確認済み。つまりコンパイラ有効化前から repo は「コンパイラフレンドリーな書き方」を lint gate で強制されている状態にあり、有効化の実効リスクは既に相当程度小さくなっている。
3. class component は1件のみ（Error Boundary 想定で対象外が自然）、`React.memo`/`forwardRef` の使用も僅少で、大規模な互換性の作り直しは想定されない。
4. 手動 `useMemo`/`useCallback` を**即座に全撤去する必要はない**。`preserve-manual-memoization` により「壊れた手動メモ化」は既存 lint で継続検知されるため、有効化と撤去を別スライスに分離してリスクを段階的に取れる。CLAUDE.md の既存規約（新規の手動 useMemo/useCallback 追加禁止）は据え置きでよく、有効化によって新規コードでの手動メモ化がそもそも不要になる方向で整合する。
5. **唯一の設定上の注意点**は Rust 版 (`experimental.turbopackRustReactCompiler`) を選ばないこと。これは Turbopack 専用で `pnpm build`（`--webpack` 固定）と併用不可のため、選択を誤ると本番ビルドが壊れる。Babel 版のみを選べば dev(turbopack)/build(webpack) 双方で動作する想定。

方針撤回（B）を推奨しない理由: CLAUDE.md/gbrain に既に「React Compiler 採用」という前提が記録されており、実測でも導入障壁・リスクが低いことが裏付けられた以上、撤回は文書の巻き戻しコストを生むだけで技術的合理性がない。

---

## 6. 有効化する場合の検証手順（実装スライスで実施）

1. **依存追加・設定変更**: `pnpm add -D babel-plugin-react-compiler` → `next.config.ts` に `reactCompiler: true` を追加（`turbopackRustReactCompiler` は追加しない）。
2. **lint**: `pnpm lint` — `eslint-plugin-react-hooks` の compiler 系ルールが継続してパスすることを確認（新規の抑制コメントが増えていないか diff で確認）。
3. **typecheck**: `pnpm typecheck` / `pnpm typecheck:no-unused` — Babel plugin は型に影響しないはずだが、`next typegen` の出力差分がないか確認。
4. **build（webpack, 本番想定）**: `pnpm build` — ビルド成功、ビルド時間の増減、`.next` バンドルサイズ（特に `optimizePackageImports` 対象の `lucide-react`/`date-fns`/`recharts` を含む画面）を有効化前後で比較。Sentry の `reactComponentAnnotation` との相互作用有無をビルドログで確認。
5. **dev（turbopack）**: `pnpm dev --turbopack` 相当（既定の `pnpm dev`）で開発時 HMR が壊れないこと、コンポーネントツリーの再レンダー挙動を主要画面（患者一覧・訪問スケジュール・調剤ワークベンチ等、useMemo/useCallback 密度が高い `src/app` 配下）で目視確認。
6. **unit test 全量**: `pnpm test` — 特に手動メモ化の参照同一性（`toBe`）に依存するテストが無いか失敗内容から特定し、あれば値の等価性 (`toEqual`) ベースへの修正を検討（本ドキュメントの範囲外、別スライスで対応）。
7. **E2E（対象を絞って）**: `pnpm test:e2e` のうち、useMemo/useCallback 密度が高い機能（`app` 配下 51ファイル中心）に対応する E2E スイートを優先実行。
8. **段階撤去（任意・別スライス）**: `preserve-manual-memoization` の警告/エラーが出ない手動 `useMemo`/`useCallback` から順に、1スライス1コミットで撤去。撤去中に挙動差分がないことを既存テストで担保。
9. **ロールバック手順の明記**: 問題発生時は `next.config.ts` の `reactCompiler` を削除（または `false`）し `babel-plugin-react-compiler` を外すだけで即時ロールバック可能である旨を実装 PR に明記する。

---

## 7. 参考

- Next.js 公式ドキュメント（Context7 経由、2026-07-03 時点キャッシュ）: `reactCompiler` は Next 16 で experimental → stable 昇格、デフォルト無効。`turbopackRustReactCompiler` は Turbopack 専用で webpack と併用不可。Babel 版利用時は `babel-plugin-react-compiler` の devDependency 追加が必須。
- `eslint-plugin-react-hooks@7.1.1`（`node_modules/.pnpm/eslint-plugin-react-hooks@7.1.1_.../configs.recommended`）の実際のルールセットを直接確認（本ドキュメント §1.1）。
- CLAUDE.md 由来の既存前提: 「React Compiler採用、手動useMemoはpreserve-manual-memoization lint＋early return後はrules-of-hooks違反、改善計画の"useMemo化"提案は無視」（gbrain memory: `careviax-react-compiler-no-manual-usememo`）— 本ドキュメントはこの前提を実測で裏付け、正式な決定文書として明文化するもの。
