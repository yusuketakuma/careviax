# Verification Evidence — 検証証跡（Phase 9）

更新: 2026-07-11
状態: **Phase 9 のfull browser/E2E/manual a11y/専門家評価は未実施。DV-02のtargeted route-mock browser evidence（desktop / 375px mobile / 768×1024 tablet）、限定Axe検査、forced-colors keyboard smoke、200%-equivalent viewport smokeとPhase 7/8のfocused static evidenceは取得済み。**

## 1. 現在の証跡境界

Phase 0〜6 は調査・設計文書であり、実画面の a11y、レスポンシブ、offline、同期、認証、upload、visual regression を実施済みとは扱わない。Phase 5/6 文書にある既存unit testや静的根拠は、現在の挙動の調査証拠であって、将来の実装後検証の代替ではない。

2026-07-11 の Phase 7 registry adapter では、`visual-status-registry.test.ts`、`sync-state-badge.test.tsx`、`offline-sync-content.test.tsx` の3 files / 15 tests、ESLint、Prettier、typecheck、raw-state-color、frontend-contract、module-boundary、diff-checkが通過した。これは既存同期5状態の表示メタデータ不変性の証拠であり、offline/PWA実機、conflict、upload、a11y、E2E、build/standaloneの実行証拠ではない。

2026-07-11 の DV-02 slice では、初期148件のbrowser-only sub-12px typography debtを全て解消し、`pnpm typography:check` はallowlist 0件・drift 0を検出した。`right-pane.test.tsx`、`prescription-grid.test.tsx`、`medication-calendar-grid.test.tsx`、`use-workbench-view.test.ts`、保留/工程/比較ダイアログ、route比較、残薬chart、checker unit testのfocused 10 files / 68 testsが通過した。右ペインの10操作とカレンダーフッタの3操作はcomponent単位で44px targetを宣言し、calendar viewはISO date keyを状態キーから分離して年跨ぎのヘッダ・期間・対象・差戻し・保留を完全和式日付で固定する。これはフォント下限・DOM契約・表示viewの証拠であり、実画面bounding box、長文折返し、320/375px、200% zoom、forced-colorsの代替ではない。

同日、`pnpm dev:e2e:local` をローカル `ph_os_e2e` に接続して起動し、Playwright route-mock でワークベンチの限定ブラウザ検証を実施した。ローカル認証はデモユーザー解決の `SELECT` のみで、患者・workbench・calendar読取と調剤完了POSTはPlaywrightが固定fixtureとして応答した。desktopでは調剤の数量確認→患者確認ダイアログ→payload送信、セットの麻薬分類チップと完全和式日付を通過した。mobileでは375 CSS pxで調剤の完全和式日付・比較ダイアログ・数量入力/確認、およびセット監査セルの選択と監査OK/NG controlsの到達性を、送信なしで通過した。同じ375 CSS pxで長い合成患者氏名が折返され、省略表示・横方向のページ溢れなしで選択状態を保つことも確認した。768×1024 CSS pxのtablet相当viewportでは、調剤の患者コンテキスト、完全和式日付、比較ダイアログ、実数量入力・確認を非送信で確認した。比較ダイアログは開いたら閉じる操作へfocusし、Tab/Shift+Tabを内部に留め、Escape閉鎖後は起点の比較ボタンへfocusを戻すよう是正した。保留理由モーダルではラジオにfocusがある実ブラウザ状態でEscapeが効かない不具合を検出し、document captureで閉鎖を受け、起点の保留ボタンへfocusを戻すよう是正した。`main` を対象にしたAxeBuilderは通常配色の6実行ケースでcritical/serious 0となり、検査で検出した冷所タグ/工程進捗のコントラストと右ペインのスクロール領域フォーカスを是正した。forced-colorsではChromiumの媒体適用、名前付き領域へのキーボードフォーカス、主要比較操作を通過した。1536×1024 desktopの200%時に相当する768×512 CSS viewportでも、完全和式日付・比較操作・患者備考領域をscroll/focusして到達できた。これは限定されたroute-mockの動作・自動a11y・layout proxy証拠であり、実DB書込、full E2E、手動ブラウザ200% zoom、手動/スクリーンリーダー検証、visual regressionの代替ではない。

375×812 CSS pxの専用モバイル不可逆ケースでは、固定下部ナビが「表示中をすべて調剤済」を覆ってpointer eventを奪う実UI不具合を検出した。workbenchは固定のヘッダ/ナビ高ではなく、`PageScaffold` 経由でAppShellの実効残余コンテンツ高を継承し、モバイルではsafe area分だけを局所控除する。ボタン下端が固定ナビ上端より上にあることを座標で固定し、修正後は行完了・実数量確認・患者確認ダイアログ・mocked `/api/dispense-results` payloadが通過した。これはroute interceptionだけを用いるため、実DB書込の証拠ではない。

さらに、ネットワーク切断バナーの可変高で同じ重なりが再発することを確認した。workbenchは固定ヘッダ値ではなく、AppShellの残余flex高を継承し、モバイルではsafe area分だけを局所控除する構成へ変更した。375×812のoffline route-mockでバナー表示中もbulk完了操作が固定ナビより上にあることを確認した。オフライン時の実保存・復旧・競合解消はこの証跡に含まれない。

## 2. リポジトリで確認できた実行コマンド

| 検証領域           | 実コマンド                                           | UI/UX Refreshでの状態                                                                                                                                                                                                                                                                                                             |
| ------------------ | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format             | `pnpm format:check`                                  | DV-02 changed pathsで実行済み。full repo再確認はPhase 9へ                                                                                                                                                                                                                                                                         |
| Lint               | `pnpm lint`                                          | DV-02 slice後に実行済み                                                                                                                                                                                                                                                                                                           |
| Typecheck          | `pnpm typecheck` / `pnpm typecheck:no-unused`        | DV-02 slice後に実行済み                                                                                                                                                                                                                                                                                                           |
| Module boundary    | `pnpm boundaries:check`                              | DV-02 slice後に実行済み                                                                                                                                                                                                                                                                                                           |
| UI contract        | `pnpm frontend-contract:check` / `pnpm colors:check` | DV-02 slice後に実行済み                                                                                                                                                                                                                                                                                                           |
| PHI client logging | `pnpm client-phi-log:check`                          | DV-02 slice後に実行済み                                                                                                                                                                                                                                                                                                           |
| Unit/component     | `pnpm vitest run <target>`                           | DV-02 focused 10 files / 68 testsを実行済み                                                                                                                                                                                                                                                                                       |
| Full test          | `pnpm test`                                          | EXECUTED 2026-07-11: 15301 tests pass / 13 skipped（既存 StageTimeline label test を 959929859 で現行ラベルへ整合後、全 green）                                                                                                                                                                                                   |
| E2E                | `pnpm test:e2e` / `pnpm test:e2e:local`              | PARTIAL: `dev:e2e:local` + route-mock のdesktop/375px mobile調剤送信・長い患者識別、768×1024 tablet調剤control、desktop/mobileセット日付、375px mobileセット監査、offline banner layout smoke、通常配色Axe（critical/serious 0）、forced-colors keyboard smoke、200%-equivalent viewport smokeはPASS。full E2E/real-writeは未実行 |
| Build / standalone | `pnpm build`                                         | ATTEMPTED 2026-07-11: OOM kill（exit 137）。16GB 共有環境（空き ~30%）で ~8GB heap の webpack build がメモリ枯渇（ollama/openclaw/dev-server と競合）。コード起因ではなく環境制約で typecheck は pass。clean-env/CI で再実行して確認する                                                                                          |

## 3. 必須シナリオと証跡

| Scenario                         | Unit / contract                              | Browser / E2E                                                                                                                                                                                                          | A11y / visual                                              | 状態         |
| -------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------ |
| 同姓同名の患者切替・高リスク確定 | patient context assertion、旧draft/query除去 | 切替→確定確認                                                                                                                                                                                                          | desktop/mobile、keyboard、200% zoom                        | NOT_EXECUTED |
| 処方差分・critical alert         | change DTO、alert floor、ack/override        | 差分表示→blocking/override                                                                                                                                                                                             | color-independent、screen reader                           | NOT_EXECUTED |
| local/server/sync/conflict       | queue state、409、partial upload             | offline→restore→conflict resolution                                                                                                                                                                                    | persistent label、reduced-motion                           | NOT_EXECUTED |
| error / empty / stale / partial  | false-empty/false-zero tests                 | retry、background refetch、no-results                                                                                                                                                                                  | live region、focus return                                  | NOT_EXECUTED |
| permission / session / read-only | 401/403、permissions envelope                | role UI、session expiry、read-only                                                                                                                                                                                     | disabled reason、focus                                     | NOT_EXECUTED |
| upload / rate limit              | per-file retry、429 retry policy             | upload failure、Retry-After                                                                                                                                                                                            | error persistence                                          | NOT_EXECUTED |
| responsive / forced colors       | component layout tests                       | 375px mobile調剤/長い患者識別/セット監査 route-mock PASS、768×1024 tablet調剤control PASS、desktop Chromium forced-colors keyboard smoke・768×512 200%-equivalent viewport smoke PASS、390/1440・手動200% zoomは未実施 | 通常配色Axe critical/serious 0、visible focus、target size | PARTIAL      |

## 4. Visual evidence protocol

画面実装sliceでは、PHIを含まないfixtureを用い、一覧・詳細・作成編集・患者context・処方差分・clinical alert・draft/finalized・offline/sync/conflict・errorの before/after screenshotを保存する。desktop/mobileと、可能な場合forced-colorsの代替状態を含める。意図した差分と回帰を分離し、実画像や認証情報を文書・外部生成promptへ含めない。

## 5. 実施時の記録形式

各実行について、日時、commit、対象、コマンド、結果、failed/skipped理由、スクリーンショットまたはtest path、残存リスクを記録する。専門家評価・薬剤師シナリオは、参加者、課題、完了率、state認識時間、critical見落とし、誤操作、復旧成功、所見を匿名化して記録し、未実施なら `NOT_EXECUTED` とする。

## 6. 2026-07-11 targeted route-mock workbench E2E

- `route-mocked workbench preserves key controls and submits unit-aware quantities`（chromium）: PASS。患者リストBFFの`meta`、`representative_task_id`、詳細`data` envelopeを含む現行契約の固定fixtureで、数量確認、不可逆の調剤完了確認ダイアログ、`/api/dispense-results` payloadを検証。
- 同ケースで前回処方比較ダイアログのclose controlへの初期focus、Tab/Shift+Tabの内部trap、Escape閉鎖後の起点比較ボタンへのfocus復帰をPASS。component testもこのkeyboard lifecycleを固定する。
- `route-mocked set workbench shows narcotic classification review chip`（chromium / mobile-chromium）では、対象セルの保留理由モーダルを開き、最初の理由へのfocus、radio focus中のEscape閉鎖、起点の保留ボタンへのfocus復帰をPASS。これは固定fixtureのUI内ドラフト取消であり、保留の実保存は実行していない。
- `route-mocked set workbench shows narcotic classification review chip`（chromium / mobile-chromium）: PASS。`2026年6月17日（水）`の`time[dateTime]`と麻薬分類チップを確認。
- `mobile dispense keeps key controls reachable without submitting completion`（mobile-chromium、375×812 CSS px）: PASS。完全和式日付、前回処方比較ダイアログ、実数量入力と確認操作の到達性を、不可逆送信なしで確認。
- `mobile dispense keeps a long patient name readable without horizontal overflow`（mobile-chromium、375×812 CSS px）: PASS。長い合成氏名は選択状態を保ったまま折返され、実際の`overflow-wrap: anywhere`、非ellipsis、氏名要素と文書全体の横方向溢れなしを確認。実機固有の表示・手動読上げの証跡ではない。
- `mobile dispense preserves the irreversible confirmation and mocked payload`（mobile-chromium、375×812 CSS px）: PASS。固定下部ナビより上にあることを座標で確認したうえで、行完了・実数量確認・患者確認ダイアログ・mocked `/api/dispense-results` payloadを通過した。
- `mobile offline banner keeps workbench controls clear of navigation`（mobile-chromium、375×812 CSS px）: PASS。オフラインread-onlyバナー表示中もbulk完了操作が固定ナビの上にあることを座標で確認した。
- `mobile set-audit keeps audit controls reachable without submitting approval`（mobile-chromium、375×812 CSS px）: PASS。セル選択後の監査OK、NG分類、無効な差戻し操作を確認し、API送信は発火しない。
- 通常配色の上記5実行ケースで `AxeBuilder().include('main')` はcritical/serious 0。検出された冷所タグと工程進捗数値のコントラストはAA用ink tokenへ分離し、右ペインの5つのスクロール領域は名前付き・フォーカス可能にして可視focusを追加した。
- `route-mocked dispense keeps keyboard landmarks usable in forced colors`（chromium）: PASS。`(forced-colors: active)`、患者の備考・申し送り領域へのキーボードフォーカス、比較操作の可視性を確認した。Chromiumがauthor colorをsystem colorへ置換する媒体ではAxeの通常色コントラスト規則を適用せず、色コントラストは上記通常配色Axeで継続検査する。
- `route-mocked dispense keeps clinical controls reachable in a 200%-equivalent viewport`（chromium）: PASS。768×512 CSS viewportで完全和式日付、比較操作、患者備考領域をviewport内へscroll/focusできた。これは有効viewportのlayout proxyであり、実ブラウザの200% zoom証跡ではない。
- `route-mocked dispense preserves clinical controls on a tablet viewport`（chromium、768×1024 CSS px）: PASS。患者コンテキスト、完全和式日付、比較ダイアログ、実数量入力・確認を非送信で確認し、通常配色の`main` Axe critical/serious 0を維持した。これはtablet実機固有の挙動・手動読上げ・visual regressionの証跡ではない。
- 調剤の不可逆送信payloadはdesktopと375px mobileのroute-mockケースで確認済みであり、実DB writeは実行していない。手動200% zoom・forced-colors visual screenshotは残存証跡とする。

## 7. 2026-07-11 prescription intake triage readability / recovery slice

- `src/app/(dashboard)/prescriptions/intake/intake-triage-content.test.tsx`: PASS（1 file / 8 tests）。長い発行元・処方内容・Rx番号を、`truncate` / native titleに依存せず既存DataTable内で折返して全文到達できることを固定した。取込キューの失敗時はpoisoned server messageをDOMへ出さず、固定の再試行copyと静的`clientLog` contextだけを使うことも確認した。
- `src/app/(dashboard)/prescriptions/prescriptions-table.test.tsx` と `prescriptions-workspace.test.tsx`: PASS（2 files / 19 tests）。処方医名も同じ全文折返し契約へ収束し、処方一覧のquery errorはpoisoned server messageをテーブルへ渡さず、固定ErrorState + 静的`clientLog` contextになることを確認した。
- `src/app/(dashboard)/patients/patients-board.test.tsx`: PASS（1 file / 26 tests）。初回の患者ボード取得失敗と、cursorを使う追加ページの失敗のいずれもpoisoned server messageをDOMへ出さず、固定recovery copy + 静的`clientLog` contextとなり、患者カードを保持/再試行できることを確認した。
- 同じworking treeで `pnpm format:check`、`pnpm lint`（exit 0、既存`break-glass.test.ts`のunused warning 2件）、`pnpm typecheck`、`NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck:no-unused`、`pnpm boundaries:check`、`pnpm client-phi-log:check`、`pnpm client-json-schema:check`、`pnpm frontend-contract:check`、`pnpm colors:check`、`pnpm typography:check`、`pnpm api-response-shape:check`、`git diff --check` をPASSした。自己申告readerをstrict schemaへ移行した結果、client JSON schema allowlistの当該string fallbackは2→1に減らし、現在は110 schema-backed / 267 allowlisted schema-less calls / 0 new debtである。
- 最終 `pnpm test` は1,479 files / 15,301 testsがPASS、13 testsがskipした。jsdomの`Not implemented: navigation to another Document`は既存テスト環境メッセージで、test failureではない。
- このsliceのbrowser visual/E2E、実機、手動screen reader/200% zoom、forced-colors、visual regression、clinical/user reviewはNOT_EXECUTEDである。既存レイアウト内の折返しと固定error copyに限定したため、`gpt-image-2` design referenceは省略した。
