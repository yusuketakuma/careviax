# Verification Evidence — 検証証跡（Phase 9）

更新: 2026-07-11
状態: **計画のみ。UI/UX Refresh の実装変更に対する Phase 9 実行結果は未取得。**

## 1. 現在の証跡境界

Phase 0〜6 は調査・設計文書であり、実画面の a11y、レスポンシブ、offline、同期、認証、upload、visual regression を実施済みとは扱わない。Phase 5/6 文書にある既存unit testや静的根拠は、現在の挙動の調査証拠であって、将来の実装後検証の代替ではない。

2026-07-11 の Phase 7 registry adapter では、`visual-status-registry.test.ts`、`sync-state-badge.test.tsx`、`offline-sync-content.test.tsx` の3 files / 15 tests、ESLint、Prettier、typecheck、raw-state-color、frontend-contract、module-boundary、diff-checkが通過した。これは既存同期5状態の表示メタデータ不変性の証拠であり、offline/PWA実機、conflict、upload、a11y、E2E、build/standaloneの実行証拠ではない。

## 2. リポジトリで確認できた実行コマンド

| 検証領域           | 実コマンド                                           | UI/UX Refreshでの状態                                     |
| ------------------ | ---------------------------------------------------- | --------------------------------------------------------- |
| Format             | `pnpm format:check`                                  | 文書sliceは実行済み。実装sliceごとに再実行                |
| Lint               | `pnpm lint`                                          | NOT_EXECUTED（本刷新のproduction code未変更）             |
| Typecheck          | `pnpm typecheck` / `pnpm typecheck:no-unused`        | NOT_EXECUTED                                              |
| Module boundary    | `pnpm boundaries:check`                              | NOT_EXECUTED                                              |
| UI contract        | `pnpm frontend-contract:check` / `pnpm colors:check` | NOT_EXECUTED                                              |
| PHI client logging | `pnpm client-phi-log:check`                          | NOT_EXECUTED                                              |
| Unit/component     | `pnpm vitest run <target>`                           | NOT_EXECUTED（Phase 7 implementation後に対象suiteを追加） |
| Full test          | `pnpm test`                                          | NOT_EXECUTED                                              |
| E2E                | `pnpm test:e2e` / `pnpm test:e2e:local`              | NOT_EXECUTED。local E2E DBとserverが必要                  |
| Build / standalone | `pnpm build`                                         | NOT_EXECUTED。8GB heapを要するwebpack build               |

## 3. 必須シナリオと証跡

| Scenario                         | Unit / contract                              | Browser / E2E                         | A11y / visual                       | 状態         |
| -------------------------------- | -------------------------------------------- | ------------------------------------- | ----------------------------------- | ------------ |
| 同姓同名の患者切替・高リスク確定 | patient context assertion、旧draft/query除去 | 切替→確定確認                         | desktop/mobile、keyboard、200% zoom | NOT_EXECUTED |
| 処方差分・critical alert         | change DTO、alert floor、ack/override        | 差分表示→blocking/override            | color-independent、screen reader    | NOT_EXECUTED |
| local/server/sync/conflict       | queue state、409、partial upload             | offline→restore→conflict resolution   | persistent label、reduced-motion    | NOT_EXECUTED |
| error / empty / stale / partial  | false-empty/false-zero tests                 | retry、background refetch、no-results | live region、focus return           | NOT_EXECUTED |
| permission / session / read-only | 401/403、permissions envelope                | role UI、session expiry、read-only    | disabled reason、focus              | NOT_EXECUTED |
| upload / rate limit              | per-file retry、429 retry policy             | upload failure、Retry-After           | error persistence                   | NOT_EXECUTED |
| responsive / forced colors       | component layout tests                       | 390/768/1440、forced-colors           | visible focus、target size          | NOT_EXECUTED |

## 4. Visual evidence protocol

画面実装sliceでは、PHIを含まないfixtureを用い、一覧・詳細・作成編集・患者context・処方差分・clinical alert・draft/finalized・offline/sync/conflict・errorの before/after screenshotを保存する。desktop/mobileと、可能な場合forced-colorsの代替状態を含める。意図した差分と回帰を分離し、実画像や認証情報を文書・外部生成promptへ含めない。

## 5. 実施時の記録形式

各実行について、日時、commit、対象、コマンド、結果、failed/skipped理由、スクリーンショットまたはtest path、残存リスクを記録する。専門家評価・薬剤師シナリオは、参加者、課題、完了率、state認識時間、critical見落とし、誤操作、復旧成功、所見を匿名化して記録し、未実施なら `NOT_EXECUTED` とする。
