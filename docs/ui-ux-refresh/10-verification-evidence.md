# Verification Evidence — 検証証跡（Phase 9）

更新: 2026-07-11
状態: **Phase 9 のfull browser/E2E/a11y/専門家評価は未実施。Phase 7/8 のfocused static evidenceは取得済み。**

## 1. 現在の証跡境界

Phase 0〜6 は調査・設計文書であり、実画面の a11y、レスポンシブ、offline、同期、認証、upload、visual regression を実施済みとは扱わない。Phase 5/6 文書にある既存unit testや静的根拠は、現在の挙動の調査証拠であって、将来の実装後検証の代替ではない。

2026-07-11 の Phase 7 registry adapter では、`visual-status-registry.test.ts`、`sync-state-badge.test.tsx`、`offline-sync-content.test.tsx` の3 files / 15 tests、ESLint、Prettier、typecheck、raw-state-color、frontend-contract、module-boundary、diff-checkが通過した。これは既存同期5状態の表示メタデータ不変性の証拠であり、offline/PWA実機、conflict、upload、a11y、E2E、build/standaloneの実行証拠ではない。

2026-07-11 の DV-02 slice では、初期148件のbrowser-only sub-12px typography debtを全て解消し、`pnpm typography:check` はallowlist 0件・drift 0を検出した。`right-pane.test.tsx`、`prescription-grid.test.tsx`、`medication-calendar-grid.test.tsx`、`use-workbench-view.test.ts`、保留/工程/比較ダイアログ、route比較、残薬chart、checker unit testのfocused 10 files / 68 testsが通過した。右ペインの10操作とカレンダーフッタの3操作はcomponent単位で44px targetを宣言し、calendar viewはISO date keyを状態キーから分離して年跨ぎのヘッダ・期間・対象・差戻し・保留を完全和式日付で固定する。これはフォント下限・DOM契約・表示viewの証拠であり、実画面bounding box、長文折返し、320/375px、200% zoom、forced-colorsの代替ではない。

## 2. リポジトリで確認できた実行コマンド

| 検証領域           | 実コマンド                                           | UI/UX Refreshでの状態                                                                                                                                                                                                                    |
| ------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format             | `pnpm format:check`                                  | DV-02 changed pathsで実行済み。full repo再確認はPhase 9へ                                                                                                                                                                                |
| Lint               | `pnpm lint`                                          | DV-02 slice後に実行済み                                                                                                                                                                                                                  |
| Typecheck          | `pnpm typecheck` / `pnpm typecheck:no-unused`        | DV-02 slice後に実行済み                                                                                                                                                                                                                  |
| Module boundary    | `pnpm boundaries:check`                              | DV-02 slice後に実行済み                                                                                                                                                                                                                  |
| UI contract        | `pnpm frontend-contract:check` / `pnpm colors:check` | DV-02 slice後に実行済み                                                                                                                                                                                                                  |
| PHI client logging | `pnpm client-phi-log:check`                          | DV-02 slice後に実行済み                                                                                                                                                                                                                  |
| Unit/component     | `pnpm vitest run <target>`                           | DV-02 focused 10 files / 68 testsを実行済み                                                                                                                                                                                              |
| Full test          | `pnpm test`                                          | EXECUTED 2026-07-11: 15298 tests pass（既存 StageTimeline label test を 959929859 で現行ラベルへ整合後、全 green）                                                                                                                       |
| E2E                | `pnpm test:e2e` / `pnpm test:e2e:local`              | NOT_EXECUTED。local E2E DBとserverが必要                                                                                                                                                                                                 |
| Build / standalone | `pnpm build`                                         | ATTEMPTED 2026-07-11: OOM kill（exit 137）。16GB 共有環境（空き ~30%）で ~8GB heap の webpack build がメモリ枯渇（ollama/openclaw/dev-server と競合）。コード起因ではなく環境制約で typecheck は pass。clean-env/CI で再実行して確認する |

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
