# Phase 5 監査: ナビゲーションとフィードバック

作成日: 2026-07-11 / 担当クラスタ: IA・ページ階層 / loading.tsx 被覆 / error boundary と retry / empty 3流派 / ErrorState variant 偏り / toast 第一エラー表現 / false-empty 残存 / URL state 欠落。
全 finding は本日時点の実コードで検証済み（file:line 根拠付き）。修正は行っていない。規範は `docs/ui-ux-design-guidelines.md`（以下「SSOT」、行番号は本日時点）。

phase3/phase4 記載からの更新検出: `tasks-content.tsx` のフィルタは既に `useSyncedSearchParams` で URL 双方向化済み（`tasks-content.tsx:252,837-903`）。conferences / my-day / schedules/conflicts / emergency-route / route-compare も採用済み。phase4 §3.2 の「tasks フィルタ = useState のみ」は stale。本監査は残存箇所のみを finding 化した。

---

## NF-01: 患者編集画面が取得失敗を「患者情報が見つかりません」に畳み込む（retry なし・誤認誘発）

- **Target**: `/patients/[id]/edit`（`src/app/(dashboard)/patients/[id]/edit/patient-edit-content.tsx`）
- **Reproduction**: `patientQuery`（`['patient-overview', patientId, orgId]`）の fetch が失敗する（サーバー 5xx、一時的ネットワーク断、セッション失効等）。`patient-edit-content.tsx:228` の分岐 `patientQuery.error instanceof Error || !patientQuery.data` が true になる。
- **Current behavior**: エラーと「データ不在」を同一の `EmptyState`（icon=FileQuestion、title「患者情報が見つかりません」）に畳み込んで表示（:230-239）。再試行ボタンなし。`refetchOnReconnect: false / refetchOnWindowFocus: false`（:220-221）のため、通信復帰しても自動回復せずリロード以外の復帰手段がない。
- **Expected behavior**: SSOT L548「取得失敗(error)は共通 ErrorState（再試行導線つき）」/ L576「原因+次の行動」/ L578「再試行可能な失敗には再試行導線を必ず付ける」。同一患者の詳細画面（card-workspace）は既に正しい実装を持つ: error 時は retry 付き ErrorState、error なしでデータ不在の場合のみ not-found（`card-workspace.tsx:5340-5356`、コメントで「取得失敗を『患者が見つかりません』に潰さない」と明記）。edit も同じ分岐にすべき。
- **User impact**: 一時的な障害なのに「患者が存在しない」と表示され、スタッフが患者レコードの消失・削除と誤認する。復帰導線がないため編集業務が停止する。
- **Patient safety・operational impact**: 「患者情報が見つかりません」は医療現場では患者取り違え/登録漏れを疑わせる重大メッセージ。誤認したスタッフが新規患者登録を重複作成する二次事故（同一患者の二重カルテ）につながり得る。
- **Root cause**: error 分岐と not-found 分岐の未分離（`!patientQuery.data` と `error instanceof Error` の OR 畳み込み）。兄弟画面の修正（card-workspace）が edit に横展開されていない。
- **Affected screens**: `/patients/[id]/edit` の 1 画面（同型パターンの横断 grep は NF-06 参照）。
- **Proposed control**: screen 層（patient-edit-content.tsx の分岐分離: error→ErrorState variant=server + onRetry=refetch、data なし＆error なし→EmptyState/not-found）。pattern 層で「error/not-found 分岐分離」を SSOT §6.3 の必須チェックとして明文化。
- **Priority**: **P1**（重大誤認 + 主要業務阻害。データ自体は失われないため P0 ではない）
- **Verification**: `patient-edit-content.fetch.test.tsx` に「fetch 500 時に『見つかりません』を出さず再試行ボタンを描画する」ケースを追加し red→green を確認。route-mock E2E で /overview を 500 にして表示文言を確認。
- **Evidence**: `src/app/(dashboard)/patients/[id]/edit/patient-edit-content.tsx:228-240`（畳み込み分岐）、:220-221（refetch 無効化）。対比正解: `src/app/(dashboard)/patients/[id]/card-workspace.tsx:5340-5356`。規範: `docs/ui-ux-design-guidelines.md:548,576,578`。
- **Resolution (2026-07-11, `TBD` commit)**: errorかつdataなしは固定の原因+次行動+再試行を持つ `ErrorState`、dataなし/errorなしだけはnot-foundに分離。生server errorを表示せず、cached dataがあるbackground error時はformを維持する。focused 3 files / 12 tests、typecheck、client PHI-log、frontend-contract、format、diff-checkは通過。route-mocked E2Eとfull buildは `NOT_EXECUTED`。

## NF-02: admin/performance「今すぐ見る要対応シグナル」帯の false-zero（偽 all-clear）残存

- **Target**: `/admin/performance` 最上段のシグナル帯（`src/app/(dashboard)/admin/performance/page.tsx`）
- **Reproduction**: `workflowQuery` / `schedulesQuery` / `proposalsQuery` / `runtimeQuery` のいずれかが loading 中またはエラーの状態でページを表示する。
- **Current behavior**: シグナル帯（:380-428）は query 状態に関係なく常時描画され、「変更承認待ち」「緊急影響」は失敗時に空配列から計算した 0（`performance.pendingOverrides` / `emergencyItems`、:325-331）、「API P95」「閾値超過 route」「報告待ち」は `?? 0`（:408,416,423）で 0 を表示する。直下の業務 KPI セクションは `metricsError` 時に ErrorState+再読み込みへ切り替える正しい実装を持ち（:430-437、コメント「false-zero を出さず」:431）、runtime 系も :505 でゲートされるが、**最上段の帯だけがどちらのゲートの外にある**。
- **Expected behavior**: SSOT L127「取得失敗と真正の空を同じ表示に畳み込まない」/ L554「isError 分岐の欠落（false-empty）を作らない」/ L578「取得失敗を 0 件に見せない」。エラー/ロード中は「—」+ 明示バナー（SSOT L578 のサマリー系規範）にする。
- **User impact**: 管理者が「緊急影響 0 / 承認待ち 0」を見て問題なしと判断し、実際には取得失敗で見えていないだけの緊急案件・承認待ちを放置する。
- **Patient safety・operational impact**: 「緊急影響」は割込・緊急訪問の件数。false-zero はまさに critical 状態の見落としを直接引き起こす（帯の名称が「今すぐ見る要対応シグナル」であるだけに偽 all-clear の害が大きい）。
- **Root cause**: false-zero 対策（:316,431 のコメント）を KPI セクションに適用した際、上段シグナル帯が適用範囲から漏れた。帯は `metricsError` 定義（:317）より前から存在する描画ブロックでゲート追加が及んでいない。
- **Affected screens**: `/admin/performance` の 1 画面（phase3 inv-04 で既知の残存として記録済み。本監査でコード上の残存を再確認）。
- **Proposed control**: screen 層（シグナル帯を `metricsError` / `runtimeQuery.isError` / isLoading でゲートし、数値の代わりに「—」+ SegmentError）。pattern 層で「サマリー数値は `?? 0` 禁止・『—』表示」を SSOT §6.3 の lint 可能規則（`?? 0` を JSX 数値表示に使う箇所の grep ガード）へ。
- **Priority**: **P1**（critical 状態（緊急影響）の見落としを直接誘発）
- **Verification**: page.test で 3 query を error にし、帯に「0」でなく「—」/エラー表示が出ることをアサート。既存の KPI セクション error テストと同型で追加可能。
- **Evidence**: `src/app/(dashboard)/admin/performance/page.tsx:380-428`（ゲート外の帯）、:394,401（空配列由来の 0）、:408,416,423（`?? 0`）、:430-437（対比: 正しくゲートされた直下セクション）、:316-317（false-zero 方針コメントと metricsError 定義）。規範: `docs/ui-ux-design-guidelines.md:127,554,578`。
- **Resolution (2026-07-11, `TBD` commit)**: source未取得/loading/error時の5シグナル値を `—` とし、実0件と区別。既存query、集計、ErrorState/retry、API契約は不変。focused 1 file / 8 tests、typecheck、frontend-contract、format、diff-checkは通過。E2E/full buildは `NOT_EXECUTED`。

## NF-03: タブ・フィルタ・ページングの URL 非同期化残存（ブラウザバック/共有/リロードで状態喪失）

- **Target**: 患者詳細タブ、スケジュール提案タブ、admin/settings・data-explorer タブ、communications/inbound フィルタ、DataTable 採用 43 画面の page/sort
- **Reproduction**: 各画面でタブ切替・フィルタ変更・ページ送りを行った後、(a) リロード、(b) ブラウザバック→フォワード、(c) URL コピーで共有、のいずれかを行う。
- **Current behavior**（各々コードで確認）:
  - 患者詳細タブ: hash からの**読み取りは**初期化+hashchange で対応するが（`card-workspace.tsx:4811-4824`）、タブクリック（`activateDetailTab`、:4803-4808）は hash を**書き戻さない**片方向。クリック後のリロードで 'command' タブへ戻る（:4781）。
  - スケジュール提案: `activeTab` は useState（`schedule-proposals-content.tsx:737`）。URL `initialStatus` の受信のみで、タブ変更（:2003）の書き戻しなし。
  - admin/settings: `<Tabs defaultValue="system">` の非制御（`settings-content.tsx:475`）。data-explorer: 同（`data-explorer-content.tsx:435`）。URL 連携なし。
  - communications/inbound: channel/priority/status フィルタが全て useState（`inbound-content.tsx:883-886`）。URL 読み書きゼロ（同ファイルに useSearchParams/router.replace なし）。
  - DataTable: sorting/pagination/columnFilters が全て内部 useState（`data-table.tsx:197-205`）。採用 43 ファイル（非テスト実測）で page/sort を URL に出す画面 0。
- **Expected behavior**: 共有・復帰が業務上意味を持つ一覧/タブは URL 双方向同期。実装規範は既に存在し採用が進んでいる: `useSyncedSearchParams`（`src/lib/navigation/use-synced-search-params.ts`、SSOT L831 で startTransition 採用と明記）を tasks（`tasks-content.tsx:837-903`）・my-day・conferences・schedules 3 画面が使用中。残存画面は同ホックの横展開で足りる。
- **User impact**: 「詳細を見て戻るとフィルタ/タブが消える」「同僚に『この患者の連携タブ見て』と URL を送れない」「リロードで作業位置を失う」— 訪問先モバイルでの再読み込みが多い運用で反復コストになる。
- **Patient safety・operational impact**: 直接の安全影響は小さいが、inbound（受信トリアージ）でフィルタ喪失→未対応シグナルの見直し漏れ、患者詳細でタブ喪失→確認済みと誤認する間接リスク。
- **Root cause**: URL 同期基盤（useSyncedSearchParams）導入前に作られた画面への横展開が未完。DataTable は設計上 state を内包し URL 連携の口が無い。
- **Affected screens**: `/patients/[id]`（タブ）、`/schedules/proposals`、`/admin/settings`、`/admin/data-explorer`、`/communications/inbound`、DataTable 採用 43 画面（page/sort）。
- **Proposed control**: component 層（DataTable に controlled pagination/sorting props を追加し URL 接続をオプトイン可能に）+ screen 層（上記 5 画面へ useSyncedSearchParams 適用。患者詳細は既存 hash 語彙 `PATIENT_DETAIL_HASH_TABS` への書き戻しで完結）。pattern 層で「タブ/フィルタは URL 双方向」を SSOT §4 に追記。
- **Priority**: **P2**（一貫性・効率を継続的に損なう横断問題）
- **Verification**: 各画面の content.test に「タブ/フィルタ変更で URL が更新される」「URL 初期値が反映される」の対を追加。E2E（ui-major-screens）でバック/リロード後の状態保持をアサート。
- **Evidence**: `src/app/(dashboard)/patients/[id]/card-workspace.tsx:4781,4803-4824`、`src/app/(dashboard)/schedules/proposals/schedule-proposals-content.tsx:737,2003`、`src/app/(dashboard)/admin/settings/settings-content.tsx:475`、`src/app/(dashboard)/admin/data-explorer/data-explorer-content.tsx:435`、`src/app/(dashboard)/communications/inbound/inbound-content.tsx:883-886`、`src/components/ui/data-table.tsx:197-205`。模範: `src/app/(dashboard)/tasks/tasks-content.tsx:252,837-903`。

## NF-04: loading.tsx 被覆 60/128（68 ルート欠落）と形状不一致スケルトン

- **Target**: colocated `loading.tsx` を持たない 68 ルート（実測: page.tsx 128 / loading.tsx 60。`find src/app -name page.tsx|loading.tsx` 本日再実測）
- **Reproduction**: (a) `/platform` `/platform/tenants/[orgId]`、`(auth)` 7 画面、`(legal)` 2 画面へ遷移する — セグメント内に loading.tsx が 1 つも無い（find 実測 0 件）。(b) `/prescriptions/intake` へ遷移する — intake ディレクトリに loading.tsx が無く（ls 実測）、親 `prescriptions/loading.tsx` を継承する。
- **Current behavior**: (a) platform/(auth)/(legal) はナビゲーション中の即時フィードバックが無い（root に loading.tsx なし）。(b) intake（トリアージ画面）遷移時に親のワークベンチ型スケルトン（status bar + フィルタチップ 8 個 + master-detail、`prescriptions/loading.tsx:1-30`）が表示され、実コンテンツと形状が一致しない。
- **Expected behavior**: SSOT L781「全ルートセグメント（リダイレクト専用を除く）に loading.tsx（実形状スケルトン）を必置」/ L564「loading.tsx と本体のシェル差・形状差をなくす。スケルトンは実コンテンツと同寸法で CLS 0.1 以下」。
- **User impact**: 遷移が「反応していない」ように見える（特に platform の重い tenant 一覧）。intake では別画面のスケルトン→実画面へのレイアウトシフトが発生し、押下位置ずれの誤クリック要因になる。
- **Patient safety・operational impact**: platform は break-glass（テナント横断アクセス）という高緊張の操作文脈で、無応答に見える UI は誤った再クリック・二重操作を誘発する。intake は処方受付トリアージであり誤クリックの業務影響がある。
- **Root cause**: loading.tsx の整備が (dashboard) 主要セクション優先で進み、platform/(auth)/(legal) セグメントと後発サブルートが未着手。形状不一致は親継承の仕様（Next.js の最近傍 boundary）を考慮しない配置。
- **Affected screens**: platform 2、(auth) 7、(legal) 2、/offline、/dashboard-preview、/shared/[token]、(dashboard) 内の欠落約 50（admin 8・patients 6・prescriptions/intake・search/views/clerk-support 等 — phase3 §3.1 の列挙と本日実測 68 件が整合）。
- **Proposed control**: screen 層（欠落セグメントへ実形状 loading.tsx を追加。優先: platform → intake の形状不一致 → 高頻度動線）。pattern 層で「新規ルート追加時は loading.tsx 同時作成」を PR チェックリスト/ガードスクリプト化。
- **Priority**: **P2**（応答性・誤操作防止の横断欠落。動作はする）
- **Verification**: `find src/app -name loading.tsx | wc -l` の増加を追跡。intake は E2E で遷移時スクリーンショット比較（CLS 計測は ui-visual-regression で代替）。
- **Evidence**: 実測: page.tsx 128 / loading.tsx 60（find）。`src/app/platform/` 配下 loading.tsx/error.tsx 0 件（find 実測）。`src/app/(dashboard)/prescriptions/loading.tsx:1-30`（ワークベンチ型形状）と `src/app/(dashboard)/prescriptions/intake/`（loading.tsx なし、ls 実測）。規範: `docs/ui-ux-design-guidelines.md:781,564`。

## NF-05: platform に error boundary なし + root 境界の復帰 CTA が「ダッシュボードへ戻る」固定

- **Target**: `/platform` 配下（break-glass コンソール含む）と全 error.tsx の共通ファクトリ
- **Reproduction**: platform 配下（例: `/platform/tenants/[orgId]` の break-glass パネル）で描画例外を発生させる。platform に error.tsx が無いため（find 実測 0 件）root `src/app/error.tsx` が受ける。
- **Current behavior**: 全 22 の error.tsx は `createRouteErrorBoundary` で統一されており retry（reset）付きで品質は高い（`route-error-boundary.tsx:20-28`）。ただし secondaryAction が **無条件に「ダッシュボードへ戻る」→ `/dashboard`**（:27）。platform（運営者コンソール、テナント文脈外）や (auth)（未認証）でエラーが起きた場合も、文脈外のテナント業務画面へ誘導する。platform operator が /dashboard へ飛ぶと org 解決に依存して forbidden になり得る（`(dashboard)/layout.tsx` の org ゲート）。
- **Expected behavior**: エラー境界の復帰導線は当該セグメントの安全な起点へ戻す（platform → `/platform`、auth → `/login`）。SSOT L576 の「次の行動」は文脈上実行可能な行動であること。platform には専用 error.tsx（+ loading.tsx、NF-04）を colocate し、admin 側の 2 層構え（root+セクション）と対称にする。
- **User impact**: 運営者が break-glass 作業中のエラーからワンクリックで監査対象コンソール外へ出てしまい、再度 platform ゲートを通り直す。未認証画面では CTA が実質デッドリンク（login へリダイレクトされ意図不明の遷移になる）。
- **Patient safety・operational impact**: break-glass はテナント横断 PHI アクセスの高リスク動線。エラー時の導線が文脈を破壊すると、作業の中断・再入で監査ログ上のセッションが分断され、追跡性が下がる。
- **Root cause**: `createRouteErrorBoundary(tag)` が tag をログ用にしか使わず、復帰先を引数化していない。error.tsx の配置が (dashboard) 系に偏り platform が漏れた。
- **Affected screens**: `/platform`、`/platform/tenants/[orgId]`（直接）。CTA 固定の影響は (auth)/(legal)/offline/shared にも及ぶ（root error.tsx 経由）。
- **Proposed control**: component 層（createRouteErrorBoundary に homeHref/homeLabel 引数を追加）+ screen 層（`src/app/platform/error.tsx` と loading.tsx を新設し `/platform` へ戻す CTA を指定）。
- **Priority**: **P2**（高リスク動線の回復導線不整合。エラー表示自体は機能する）
- **Verification**: platform 配下に error.tsx を置いた上で、break-glass パネルの unit test に throw ケースを追加し boundary 文言と CTA href をアサート。
- **Evidence**: `src/components/ui/route-error-boundary.tsx:27`（`/dashboard` 固定）、`src/app/error.tsx:5`（root がこのファクトリを使用）、`src/app/platform/` に error.tsx/loading.tsx 0 件（find 実測）、`src/app/platform/layout.tsx:18-36`（PlatformOperator ゲート = テナント文脈と別世界であることの根拠）。

## NF-06: 取得エラーの retry なし・素テキスト逸脱と手組みエラー表示の残存

- **Target**: `/views`（保存ビュー）ほか、共通部品（ErrorState/SegmentError/DataTable errorMessage）外の手組みエラー表示
- **Reproduction**: `/views` で保存ビュー一覧 API を失敗させる（`viewsQuery.isError`）。または設定（preferences）API を失敗させる。
- **Current behavior**:
  - `viewsQuery.isError` → 素の `<p>` 1 行「保存ビューを取得できませんでした。」のみ。再試行導線なし・原因/次の行動なし・role=alert なし（`saved-views-content.tsx:392-393`）。
  - `preferencesQuery.isError` → muted 1 行「…初期条件を表示しています」で静かに初期条件へフォールバック（:170-174）。復帰導線なし。
  - 共通部品外の手組み destructive box が残存: `mcs-content.tsx:1127-1138`（retry はあるが独自マークアップ）、`reports/[id]/print/page.tsx:644`（インライン destructive 帯）。なお SegmentError は ErrorState の薄い wrapper であり（`segment-state.tsx:113-137` が ErrorState へ委譲）系統分裂には当たらない — 分裂の実体は「共通部品 3 種（ErrorState/SegmentError/DataTable）+ 手組み box + 素テキスト」の後者 2 つ。
- **Expected behavior**: SSOT L548「取得失敗は共通 ErrorState（再試行導線つき、role="alert"）。素の `<p className="text-destructive">` 1 行で済ませない」/ L578「再試行導線を必ず付ける」/ L576「原因+次の行動」。
- **User impact**: /views は保存した業務フィルタの入口。取得失敗時に再試行できず、リロード以外の回復手段がない。preferences の静かなフォールバックは「自分の保存条件が消えた」ように見える。
- **Patient safety・operational impact**: 直接の臨床影響は小。ただし保存ビューは「気になる患者」等の追跡リストとして使われるため、失敗の静かな握り潰しは確認漏れの間接要因。
- **Root cause**: ErrorState 整備前に書かれた画面の残存 + 「セグメント内の小さいエラーは軽く出したい」という局所判断が SSOT L548 と衝突したまま。
- **Affected screens**: `/views`（2 箇所）、`/patients/[id]/mcs`、`/reports/[id]/print`（手組み box）。
- **Proposed control**: screen 層（views 2 箇所を SegmentError（size 小、onRetry=refetch）へ置換。mcs/print の手組み box を ErrorState size="inline" へ寄せる）。pattern 層で「`text-destructive` を含む手組みエラー div」の grep ガード（colors:check と同型の ratchet）を検討。
- **Priority**: **P2**（SSOT 明文違反 + 回復導線欠落。対象画面は補助的）
- **Verification**: `saved-views-content.test.tsx` に isError→再試行ボタン描画のアサートを追加。grep `rounded.*destructive` で手組み box の残数を ratchet 計測。
- **Evidence**: `src/app/(dashboard)/views/saved-views-content.tsx:392-393,170-174`、`src/app/(dashboard)/patients/[id]/mcs/mcs-content.tsx:1127-1138`、`src/app/(dashboard)/reports/[id]/print/page.tsx:644`、`src/components/ui/segment-state.tsx:113-137`（SegmentError=ErrorState wrapper の根拠）。規範: `docs/ui-ux-design-guidelines.md:548,576,578`。

## NF-07: fetch 層がステータス非分別で、権限/認証/オフライン失敗が全て「サーバーエラー」に化ける（ErrorState variant 偏りの根因）

- **Target**: `src/lib/api/client-json.ts`（クライアント fetch の共通エラー化層）と ErrorState variant の実使用
- **Reproduction**: CSR 継続中にセッションが失効（またはサーバー側無効化）した状態、あるいは org ヘッダ不一致等で API が 401/403 を返す状態で任意の画面のクエリを発火させる。またはオフラインで fetch が TypeError になる。
- **Current behavior**: `readApiJson` は `response.ok` 以外を一律 `new Error(message ?? fallback)` に変換し、status code を捨てる（`client-json.ts:72-74`。401/403/404 の分岐なし — ファイル全体 96 行に status 参照ゼロ）。その結果、画面側は失敗種別を判別できず、ErrorState の variant 実使用は **server 122 / forbidden 5 / not-found 2 / unauthorized 1 / network 1（オフライン専用ページのみ）** に偏る（非テスト grep 実測）。セッション失効・権限不足・ネットワーク断が「サーバーエラーが発生しました。しばらく経ってからもう一度お試しください」（`error-state.tsx:54-58`）として表示され、再試行しても直らない。
- **Expected behavior**: SSOT L550「権限不足は ErrorState(forbidden) で理由提示」、L127「API は machine-readable code で再試行可否・権限不足を区別できる details を返し、UI は別表示にする」。401 は unauthorized variant（「再度ログインしてください」）へ、`navigator.onLine === false` / TypeError は network variant へマップすべき。
- **User impact**: 失効セッションで「しばらく待って再試行」を繰り返す無駄なリトライ誘導（正解は再ログイン）。オフライン時に「サーバーエラー」と誤診断し、サーバー障害と思い込んで問い合わせが発生する。※緩和: SessionTimeoutModal が期限 5 分前に警告し期限で自動 signOut するため（`session-timeout-modal.tsx:27,109-115,73`）、計画的失効は概ね防がれる。残るのはサーバー側無効化・端末時計ずれ・(dashboard) 外シェル。
- **Patient safety・operational impact**: 誤った復帰行動（待つ vs 再ログイン vs 通信確認）の選択ミスで業務中断が延びる。オフライン誤診断は「オフライン対応画面へ切り替える」判断を遅らせる。
- **Root cause**: 共通 fetch 層がエラーを message 文字列へ平坦化する設計で、種別が型として上流に伝わらない。ErrorState は 5 variant を持つが供給側に判別材料がない。
- **Affected screens**: readApiJson/useQuery 採用のほぼ全画面（横断）。
- **Proposed control**: API/lib 層（readApiJson が `status` を持つ typed error（例: ApiError extends Error { status, code }）を throw）+ component 層（ErrorState 呼出局所 or 共通ヘルパで status→variant マッピング）。SSOT §6.3 へ「401→unauthorized / 403→forbidden / offline→network」の写像表を追記。
- **Priority**: **P2**（横断的な誤診断誘発。SessionTimeoutModal による部分緩和あり）
- **Verification**: client-json.test に 401/403 で typed error を返すケースを追加。代表画面の content.test で 403 応答→forbidden variant 描画をアサート。
- **Evidence**: `src/lib/api/client-json.ts:72-74`（status 非分別）、variant 実測: server 122 / forbidden 5 / not-found 2 / unauthorized 1 / network 1（非テスト grep。network の 1 件は `src/app/offline/page.tsx:6`）、`src/components/ui/error-state.tsx:11,47-82`（5 variant 定義済み）、緩和根拠: `src/components/auth/session-timeout-modal.tsx:27,73,109-115`。規範: `docs/ui-ux-design-guidelines.md:127,550`。

## NF-08: mutation 失敗の通知が toast のみ（SSOT §4.2「失敗の唯一の通知手段」禁止に違反する残存群）

- **Target**: mutation onError → `toast.error` のみで画面内に永続失敗状態を残さないパターン（非テスト `toast.error` 334 箇所、grep 実測）
- **Reproduction**: 例1: `/select-mode` でモード選択ボタンを押し、`PATCH /api/me/preferences` を失敗させる。例2: `/views` で保存ビューの作成/名称変更/共有/削除を失敗させる。
- **Current behavior**: 失敗は 3〜5 秒で消える toast のみ（select-mode: `select-mode-content.tsx:89-91`、views: `saved-views-content.tsx:130-131,267-268,287-288,304-305,322-323`）。画面内に失敗状態・再試行導線は残らない。toast を見逃すと「押したのに何も起きない」だけが残る。
- **Expected behavior**: SSOT L312（§4.2 表）: toast は「操作結果の成功フィードバック」用で、「失敗は永続的な行内/インラインの失敗状態+再試行導線で示す」「判断・確認が必要な内容、失敗・エラーの唯一の通知手段」への使用は禁止（2026-07-02 rev④ で明文化、`ui-ux-design-guidelines.md:1219` 変更履歴）。
- **User impact**: toast 見逃し時に操作が成功したか失敗したか判別できない。select-mode は入口画面で、失敗に気づかず前のモードのまま業務を始める。医療現場は画面から目を離す時間が長く、時限 toast の見逃し率が高い。
- **Patient safety・operational impact**: 現状確認した箇所（モード選択・保存ビュー CRUD）は臨床操作でなく直接安全影響は小。ただしこのパターンは 334 箇所に広がっており、臨床系 mutation に同型があれば false-success（送れていないのに送れたつもり）へ直結するため、棚卸しの起点として記録する。
- **Root cause**: §4.2 の toast 制限が 2026-07-02 に規範化される前に書かれた実装が大量に残存。mutation の「インライン失敗状態」用の共通部品/パターンが未提供で、toast が最も安いため選ばれ続ける。
- **Affected screens**: 横断（toast.error 334 箇所）。検証済み具体例: `/select-mode`、`/views`。
- **Proposed control**: pattern 層が主戦場: 「mutation 失敗の標準形」（ボタン隣接のインラインエラー行 or フォームは FormErrorSummary、+ toast 併用可）を SSOT §6.6 に部品名込みで規定し、component 層で LoadingButton にエラー状態表示を内蔵する案を検討。全 334 箇所の一括改修でなく、臨床系 mutation（調剤/訪問記録/報告書/送付）から優先的に棚卸しする。
- **Priority**: **P2**（規範明文違反の横断残存。臨床系該当箇所の特定が先決）
- **Verification**: まず `grep -rn "onError" src --include='*.tsx' | grep -v test` と toast.error の突合で「toast のみ」箇所の台帳を作り、臨床系を優先ランク付け。代表画面の content.test に「失敗時にインライン失敗状態が残る」アサートを追加。
- **Evidence**: `src/app/(dashboard)/select-mode/select-mode-content.tsx:89-91`、`src/app/(dashboard)/views/saved-views-content.tsx:130-131,267-268,287-288,304-305,322-323`。件数: 非テスト toast.error 334（grep 実測）。規範: `docs/ui-ux-design-guidelines.md:312,524,1219`。

## NF-09: 空状態の 3 流派（EmptyState / DataTable emptyMessage / 素テキスト）が併存

- **Target**: 空状態表現の非統一（EmptyState 採用は非テスト 29 ファイル、grep 実測）
- **Reproduction**: `/communications/requests` で返信待ち依頼が 0 件の状態を表示する。
- **Current behavior**: 素の `<p>`（破線 border の手組み）で「返信待ちの依頼はありません。」のみ表示（`requests-content.tsx:320-322`）。次のアクション導線・状態区別（初回/フィルタ 0 件/対応完了）なし。一方、同一 repo 内に (a) `EmptyState` 部品（タイトル+本文+アクション、29 ファイル）、(b) DataTable 内蔵 emptyMessage、の確立した 2 系統が既にあり、3 流派が併存する。phase3 が同流派として挙げた dispense-audit-stats / performance / realtime / alert-rules / contact-profiles も同型（本監査では requests を代表検証）。
- **Expected behavior**: SSOT L586「EmptyState は『タイトル+本文+（必要時）次のアクション導線』の固定構造。初回利用/検索・フィルタ 0 件/データ削除済みを文言で区別し、次の一手を必ず提示」。L551「空(empty)は EmptyState。『まだありません』+次のアクション導線」。
- **User impact**: 画面ごとに空状態の見た目・情報量が異なり、「0 件=正常」か「0 件=何かすべき」かの判断コストが毎回発生する。次の一手（例: 依頼を作成する）への導線が無い画面では作業が途切れる。
- **Patient safety・operational impact**: 軽微。ただし NF-02 の false-zero と組み合わさると「素テキストの 0 件表示」は取得失敗との見分けがさらに難しくなる。
- **Root cause**: EmptyState 部品整備前の画面の残存 + 「リスト内の小さな空表示に page 級部品は大げさ」という局所判断（EmptyState に compact size がない）。
- **Affected screens**: `/communications/requests`（検証済み）ほか phase3 inv-03/04/10 列挙の素テキスト群。
- **Proposed control**: component 層（EmptyState に size="inline" 追加でリスト内利用の障壁を除去）+ pattern 層（素の「〜はありません」テキストの grep 台帳化と段階置換）。
- **Priority**: **P3**（一貫性・理解容易性の問題。誤動作はない）
- **Verification**: `grep -rn "ありません" src/app --include='*.tsx' | grep -v EmptyState` 型の棚卸しで残数を ratchet。置換画面の snapshot test 更新。
- **Evidence**: `src/app/(dashboard)/communications/requests/requests-content.tsx:320-322`（素テキスト）、EmptyState 採用 29 ファイル（非テスト grep 実測）。規範: `docs/ui-ux-design-guidelines.md:551,586`。
- **Resolution (2026-07-11, `TBD` commit)**: `EmptyState` に既定の画面級表示を変えない `size="inline"` を追加し、返信待ちリストの空状態へ適用。空時は listbox を出さず、0件が正常な状態であること、他の状態を表示条件で確認できること、再読み込み操作を明示する。取得失敗・初期読込・background refresh は既存の ErrorState/Skeleton のまま分離する。focused component/content tests 2 files / 19 tests、ESLint、Prettier、client PHI-log、frontend-contract、module-boundary、typecheck、diff-checkが通過。E2E、実機a11y/レスポンシブ、full buildは `NOT_EXECUTED`。

## NF-10: リダイレクト専用ルートに loading.tsx が残存（SSOT 明文違反の死にファイル）

- **Target**: `src/app/(dashboard)/admin/professionals/`、`src/app/(dashboard)/patients/[id]/management-plan/`
- **Reproduction**: `/admin/professionals` または `/patients/[id]/management-plan` へ遷移する。page.tsx は即 `redirect()` する alias ルート（professionals→external-professionals、management-plan→患者詳細）だが、両ディレクトリに loading.tsx が同居している（ls 実測）。
- **Current behavior**: リダイレクト処理中に旧画面形状のスケルトンが一瞬表示され得る（行き先と無関係の形状）。コード上も「実画面がある」ように見え、IA の把握とルート棚卸しを誤らせる（phase3 でも死にファイルとして検出）。なお phase3 が同類に挙げた `visit-records` ルートは既に削除済み（find 実測で不存在 — 台帳側が stale）。
- **Expected behavior**: SSOT L390「リダイレクト専用ルートに loading.tsx を残さない」（明文規範）。L781 の loading.tsx 必置も「リダイレクト専用を除く」と明記。
- **User impact**: 一瞬の無関係スケルトン（軽微なちらつき）。主な害は開発側: ルート監査のノイズと、alias ルートを実画面と誤認した改修。
- **Patient safety・operational impact**: なし（軽微な視覚ノイズのみ）。
- **Root cause**: ルートを redirect スタブ化した際に loading.tsx の削除が漏れた。
- **Affected screens**: `/admin/professionals`、`/patients/[id]/management-plan`。
- **Proposed control**: screen 層（2 ファイル削除のみ）。pattern 層で「redirect() だけの page.tsx と同居する loading.tsx」を検出する軽量ガードを boundaries:check に追加検討。
- **Priority**: **P3**（軽微・即修可能）
- **Verification**: 削除後 `pnpm build` と該当遷移の E2E smoke（redirect 先到達）で確認。
- **Evidence**: `src/app/(dashboard)/admin/professionals/loading.tsx` + 同 `page.tsx:1-5`（redirect のみ）、`src/app/(dashboard)/patients/[id]/management-plan/loading.tsx` + 同 `page.tsx:1-11`（redirect のみ）。規範: `docs/ui-ux-design-guidelines.md:390,781`。
- **Resolution (2026-07-11, `TBD` commit)**: 両 `loading.tsx` を削除。`management-plan/page.test.ts`、`pnpm typecheck`、format、diff-checkは通過した。redirect先到達のE2E smokeとfull buildは Phase 9 まで `NOT_EXECUTED`。

---

## 監査メモ（finding 化しなかった検証結果）

- **error.tsx の「4 系統分裂」について**: 22 件の error.tsx は全て `createRouteErrorBoundary` ファクトリで統一済み・retry（reset）付きであり、route boundary 層に分裂は無い（`route-error-boundary.tsx:7-31`）。分裂は画面内クエリエラー表現の側（NF-06/NF-07）と CTA 固定（NF-05）に整理した。
- **SegmentError は独立系統ではない**: ErrorState への委譲 wrapper（`segment-state.tsx:113-137`）。
- **tasks / conferences / my-day / schedules 系の URL 同期は実装済み**（`useSyncedSearchParams` 採用、`tasks-content.tsx:837-903` 等）。phase4 §3.2 の該当行は stale。
- **card-workspace のルートクエリは error/not-found 分離済み**（`card-workspace.tsx:5340-5356`）— NF-01 の対比正解として引用。
- **requests-content の取得エラーは ErrorState 処理済み**（`requests-content.tsx:288-289`）— false-empty ではない。空状態のみ NF-09 対象。
- **select-mode の mutation 失敗**は画面残留+ボタン再押下で再試行可能なため「retry なし」ではなく、toast 唯一通知（NF-08）の例として整理した。
- **not-found.tsx が root 1 件のみ**である点は、患者詳細/編集が画面内で not-found を扱う設計（NF-01 の分岐分離が前提）のため単独 finding とはしなかった。
