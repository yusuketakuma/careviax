# Phase 5 監査: 密度と視覚言語（Density & Visual Language）

監査日: 2026-07-11 / 担当クラスタ: DataTable/一覧の密度・列設計・数値整列・単位、typography（sub-12px 残存）、アイコン意味分裂、全彩度 `bg-state-*`、ローカル MetricCard 重複、`*_LABELS` 散在・ラベル揺れ、薬剤名/識別情報の切り詰め。
方法: 静的コード読解（read-only、実ブラウザ未使用）。全 finding は実コードで file:line まで検証済み。規範は `docs/ui-ux-design-guidelines.md`（以下 guidelines）。
既知の意図的仕様（ConfirmDialog autoFocus / org-wide access / WorkflowPageHeader HelpPopover / React Compiler / ExpiryBadge floor 等）は対象外として報告しない。

件数実測の注記: 本監査の grep 実測値は phase3 `ssot-discovery.md` の値と若干異なる（例: `*_LABELS` 散在 113→124 ファイル、AlertTriangle 43→62 ファイル）。計測パターン差によるもので、オーダーはいずれも一致。本書の数値は本日の再実測値。

---

## DV-01: DataTable に数値列契約（整列・tabular-nums・単位）が無く、画面ごとに三様

- **ID**: DV-01
- **Target**: `src/components/ui/data-table.tsx` と全 45 消費画面の数値列
- **Reproduction**: `DataTableColumnMeta` の型定義（`data-table.tsx:65-71`）に align / numeric 系フィールドが存在せず、`<th>` は `text-left` がハードコード（`data-table.tsx:542`）。数値の書式は各画面の `cell` 実装任せ。
- **Current behavior**: 同じ「数値列」が画面により三様:
  1. 右揃え + tabular-nums（`visits/[id]/visit-record-detail.tsx:110-121` 残数/余剰日数、`billing/partner-cooperation/partner-cooperation-billing-content.tsx:537-543,801-806` 金額 — ただしヘッダは常に左揃えでセルと不整合）
  2. tabular-nums のみで左揃え（`admin/drug-masters/drug-master-content-columns.tsx:148-156` 薬価、`:166-170` 最大日数）
  3. 何も無し（`patients/[id]/card-workspace.tsx:503-507` 処方明細の数量列は `accessorFn` 素通しで tabular-nums も揃えも無し）
     さらに数量フォーマッタ `formatQuantityLabel`（`card-workspace.tsx:475-483`）は `unit` が null のとき単位を無言で落とし、「30錠」と裸の「30」が同一列に混在し得る。
- **Expected behavior**: guidelines §7.4「数値列に tabular-nums 必須。操作列は末尾」・§3.8「用量・薬価・残数・金額・件数など縦に並ぶ数値すべてに tabular-nums 明示」。数値列は右揃え（ヘッダ含む）+ tabular-nums + 単位明示が全一覧で同一に適用されるべき。
- **User impact**: 桁の縦ずれで数量・金額・残数の大小比較が遅く誤りやすい。ヘッダとセルの揃え不一致は列の走査を妨げる。単位欠落行は「30」が錠か包か日分か判別できない。
- **Patient safety・operational impact**: 数量・残数の誤読は調剤量/残薬調整の判断に直結（§3.8 は「数字の縦揃えで用量誤読を防ぐ」を明記）。請求金額の桁誤読は算定ミスに直結。
- **Root cause**: DataTable が列の意味型（テキスト/数値/日付）を持たず、書式責務が 45 画面へ分散したまま規範だけが §7.4/§3.8 に存在する（executable でない）。
- **Affected screens**: DataTable 採用 45 画面のうち数値列を持つもの（patients/[id] 処方明細、admin/drug-masters、billing 系、visits/[id]、admin/inventory-forecast ほか）。
- **Proposed control**: **component 層**。`DataTableColumnMeta` に `align?: 'right'` / `numeric?: true` を追加し、numeric 指定でセル+ヘッダの右揃えと `tabular-nums` を DataTable 側が一元付与。単位は `unit` フォールバック禁止（null 時は「30（単位未登録）」等の明示）を共通フォーマッタで担保。
- **Priority**: P2
- **Verification**: numeric meta 指定列の `<th>`/`<td>` クラスに `text-right tabular-nums` が付くことの unit test + 代表 3 画面（card-workspace 数量 / drug-masters 薬価 / billing 金額）のスナップショット比較。
- **Evidence**: `src/components/ui/data-table.tsx:65-71,542` / `src/app/(dashboard)/patients/[id]/card-workspace.tsx:475-483,503-507` / `src/app/(dashboard)/admin/drug-masters/drug-master-content-columns.tsx:148-156` / `src/app/(dashboard)/visits/[id]/visit-record-detail.tsx:110-121` / `src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.tsx:537-543,801-813`

---

## DV-02: sub-12px タイポグラフィ残存 81 箇所 — 服薬カレンダーの薬剤名 10px・印刷 9px を含む

- **ID**: DV-02
- **Target**: `text-[9px]`/`text-[10px]`/`text-[11px]` クラス 61 箇所（35 ファイル）+ inline `fontSize: '10px'/'11px'` 18 箇所 + CSS `font-size: 10/11px` 2 箇所（いずれも本日 grep 実測、.test 除外）
- **Reproduction**: `grep -rn "text-\[9px\]\|text-\[10px\]\|text-\[11px\]" src`（61 行）、`grep -rn "fontSize: '1[01]px'" src`（18 行）。
- **Current behavior**: 最重要例 — 服薬カレンダーのスロットセルが**薬剤名を text-[10px] で描画**（`medication-calendar-content.tsx:164`）、同テーブルは印刷時 `print:text-[9px]`（`:375`）。ほか QR ドラフト詳細の差分注記バッジ 10px（`qr-drafts/[id]/page.tsx:341,350,929,936`）、調剤ワークベンチ患者キューのメタ行 inline 10px（`patient-list-panel.tsx:185-190`）、スケジュール日ビューのタグ 10px（`schedule-day-view.sections.tsx:230`）、MFA セットアップ注記 11px（`mfa/setup/page.tsx:278`）、タスクボード/共有ビューア/オフラインパネル等の 11px バッジ多数。
- **Expected behavior**: guidelines §3.4「`text-[9px]`/`text-[10px]`/`text-[11px]` は廃し、最小 `text-xs`(12px)。密度はブロック高・余白で調整」。§2.4 原則4「高密度画面でも本文 14px 以上」。薬剤名は §7.8 の安全表示対象。
- **User impact**: 高齢の患者家族・訪問先の薄暗い環境・モバイルでの判読性低下。11px の StateBadge 縮小（`className="text-[11px]"` を StateBadge に直渡し）は状態把握を遅らせる。
- **Patient safety・operational impact**: **薬剤名の 10px/印刷 9px は類似名薬（アマリール/アルマール型、§7.8）の誤読リスクを直接高める**。服薬カレンダーは患者・家族へ渡り得る帳票であり、最も判読性が要る面で最小サイズが使われている。
- **Root cause**: §3.4 の禁止が lint/ガード（`colors:check` 相当）で executable 化されておらず、密度調整の手段としてフォント縮小が使われ続けている。StateBadge が className 直渡しでサイズ上書き可能な点も逃げ道になっている。
- **Affected screens**: patients/[id]/medication-calendar（最重要）、prescriptions/qr-drafts/[id]、dispense workbench 患者キュー、schedules（day view / offline panel / proposals）、tasks、shared/[token]、mfa/setup、admin 系（capacity / operating-hours / operations-insights / master-hub）ほか 35 ファイル。
- **Proposed control**: **token + pattern 層**。① ESLint/カスタムガードで `text-[9-11px]` と inline sub-12px を ratchet 禁止（colors:check 方式）。② 薬剤名・臨床値を含むセルは最低 `text-xs`、印刷は A4 印刷契約（globals.css）側で最小サイズを定義。③ StateBadge へのサイズ縮小 className 直渡しを variant 化して下限を encode。
- **Priority**: P1（薬剤名 10px/9px が判読性の患者安全線を割る。純装飾の 11px 単独なら P2 相当）
- **Verification**: ガードスクリプトの 0 件到達（ratchet）+ medication-calendar の light/print スクリーンショットで薬剤名 12px 以上を確認。
- **Evidence**: `src/app/(dashboard)/patients/[id]/medication-calendar/medication-calendar-content.tsx:159,164,375` / `src/app/(dashboard)/prescriptions/qr-drafts/[id]/page.tsx:341,350` / `src/components/features/dispense-workbench/patient-list-panel.tsx:185-190` / `src/app/(auth)/mfa/setup/page.tsx:278` / `src/app/(dashboard)/tasks/task-health-board-panel.tsx:176-182`
- **Partial remediation (2026-07-11)**: 最重要経路の `patients/[id]/medication-calendar` は、desktop/月間とmobile/日次で共用する `SlotCell` の薬剤名を `text-xs leading-5` に変更し、空セルとtable印刷も `text-xs` 下限へ揃えた。合成薬剤名でcomponent test、1680px browser screenshot、print media screenshot を確認し、画面・印刷ともcomputed `font-size: 12px` / `line-height: 20px`、page/console error 0 件だった。調剤ワークベンチ患者キューも、患者数・並替え・開始/登録日・年齢・状態・凡例の全てを 12px 下限へ揃え、長名/選択契約を保つcomponent testと12px契約testで固定した。1680px・mock workbench の再スクリーンショットでは患者行高約55px、横スクロールなし、page/console error なし、書込みrequestなしを確認した。残る他画面のsub-12pxとratchet guardは別sliceであり、DV-02全体は未解決。

---

## DV-03: アイコンの意味分裂 — 同一グリフの別名 2 組、Eye 3 義、Clock 2 義、Play が「開始」と「完了」を兼務

- **ID**: DV-03
- **Target**: lucide-react アイコンの意味⇔グリフ対応（role 正本: `src/lib/constants/status-tokens.ts:2`）
- **Reproduction**: 非テストファイル数の grep 実測: `AlertTriangle` 62 ファイル vs 正本側 `TriangleAlert` 12 ファイル（同一グリフの別名 import が分裂）。`CheckCircle2` 38 vs 正本側 `CircleCheck` 3。`Eye` は ① readonly role 正本（`status-tokens.ts:55`）② パスワード/PHI 表示切替（`(auth)/login`・`password/*`・`first-login` 4 画面 + `src/components/ui/phi-mask-field.tsx`）③ SOAP-O 識別アイコン（`visit-record-form.tsx:2606-2607`、`soap-step-wizard.tsx`）の 3 義。`Clock` は ① waiting role 正本（`status-tokens.ts:48`）② 単なる時刻見出し（`visit-record-detail.tsx:1253`「訪問実施時刻」）の 2 義（§3.10 の登録上は「期限=Clock」でさらに 3 義目）。加えて `visit-card-mobile.tsx:271,283` では**訪問「開始」ボタンと「完了」ボタンが同じ Play アイコン**。
- **Current behavior**: 同一画面系（訪問記録詳細）で Eye が「閲覧のみ」バッジと「SOAP-O 客観情報」の両方を意味し、Clock が「他者確認待ち」状態と「時刻表示」の両方に現れる。コード上は同一グリフが 2 つの import 名に割れ、正本アイコンの grep 監査が半分しかヒットしない。
- **Expected behavior**: guidelines §3.10「同一意味＝同一アイコンを全画面で固定。対応を増やす場合はこの節に登録してから使う（勝手な一回限りの選択は禁止）」。完了アクションのアイコンは done 系（CircleCheck）であるべきで、開始と完了が同一アイコンであってはならない。
- **User impact**: アイコンによるスキャン（§3.10 の目的）が機能しない。「Eye=閲覧のみ」を学習したユーザーが SOAP-O 見出しを誤読する。訪問カードで開始/完了ボタンがアイコンでは区別できず、ラベル読解に依存する。
- **Patient safety・operational impact**: 訪問完了の誤タップ（開始のつもりで完了）は訪問記録ワークフローの状態を誤らせる。CVD ユーザー（§3.9）はアイコン形状差に依存するため、意味分裂の影響がより大きい。
- **Root cause**: lucide の alias（AlertTriangle/TriangleAlert 等）を許容したまま正本側だけ新名称に統一したこと、§3.10 の登録簿に「role 正本アイコンを role 以外の意味で使う可否」が非明文なこと（ssot-discovery §4.6 と一致）。
- **Affected screens**: 全画面横断。特に visits/[id]（Eye/Clock 混在）、visit-card-mobile（Play 2 義）、auth 4 画面（Eye）。
- **Proposed control**: **pattern + component 層**。① ESLint `no-restricted-imports` で `AlertTriangle`/`CheckCircle2` 等の旧 alias を禁止し正本名へ寄せる。② §3.10 の登録簿に「role 正本 7 アイコン（Ban/CircleCheck/TriangleAlert/Clock/Eye/ShieldAlert/Info）の非 role 用途」の可否を明文化（Eye のパスワード切替は業界慣習として例外登録、SOAP-O は別アイコンへ）。③ visit-card-mobile の完了ボタンを CircleCheck に変更。
- **Priority**: P2
- **Verification**: alias 禁止 lint の 0 違反 + visit-card-mobile の開始/完了ボタンのアイコン差分をスナップショットで確認。
- **Evidence**: `src/lib/constants/status-tokens.ts:2,48,55` / `src/components/features/visits/visit-card-mobile.tsx:271,283` / `src/app/(dashboard)/visits/[id]/record/visit-record-form.tsx:2606-2607` / `src/app/(dashboard)/visits/[id]/visit-record-detail.tsx:1253` / `src/components/ui/phi-mask-field.tsx`
- **Partial remediation (2026-07-11, `TBD` commit)**: 訪問カードの完了操作だけを `Play` から `CircleCheck` へ変更し、開始（Play）と完了（CircleCheck）を形状でも区別した。ラベル、タップ、左スワイプ、callback ID、状態遷移は不変で、focused testは開始/完了双方の操作契約とicon classを確認する。Eye/Clockの多義性、Lucide alias横断統一、SOAP-Oなど他画面の意味分裂は未解決のまま残す。

---

## DV-04: 全彩度 `bg-state-*`/`bg-tag-*` 62 行 — うち mutation ボタンの緑/青ベタ塗り 7 箇所は §5.1 明文違反

- **ID**: DV-04
- **Target**: 状態色トークンの全彩度背景利用（/opacity なし）
- **Reproduction**: `grep -rn "bg-(state|tag)-[a-z]*" src --include="*.tsx"` で /10 等の opacity なし 62 行（本日実測。phase3 計測では 76 箇所 — パターン差、オーダー一致）。うち **`bg-state-done text-white` の操作ボタン 6 箇所**: `handoff/handoff-workspace.tsx:889`（対応済み確定ボタン）、`schedules/proposal-human-decision-flow.tsx:26`、`schedules/schedule-team-board.tsx:292`（completed セル）、`communications/requests/requests-content.tsx:400`（回答を記録して完了ボタン）、`src/components/features/visits/visit-card-mobile.tsx:279`（訪問完了ボタン）、`src/components/features/visits/facility-visit-record-switcher.tsx:220`。加えて `handoff-workspace.tsx:893` は `bg-tag-info text-white` のボタン塗り。
- **Current behavior**: 完了系 mutation の主操作ボタンが done 緑でベタ塗りされ、「完了済み状態の表示」と「完了させる操作」が同じ視覚になる。requests-content の緑ボタンはその画面の実質的主操作。
- **Expected behavior**: guidelines §5.1「**主操作色に done（緑）を使わない（完了の意味と衝突）。完了アクションも Primary（--primary）とし、done 緑はステータス表示に限定する**」「3.1 の info はバッジ・状態表示用（ボタン塗りには使わない）」。§3.2 状態色は点・線・ラベルで、塗り面積最小。
- **User impact**: 緑=「もう完了している」と読んだユーザーが押し漏らす／逆に状態バッジをボタンと誤認する。画面間でボタン階層（Primary=ネイビー）の学習が壊れる。
- **Patient safety・operational impact**: 訪問完了・ハンドオフ確定は記録ワークフローの状態遷移であり、押し漏れは報告書生成（J-08）や次工程着手の遅延につながる。緑面積の増加は本物の done 状態表示のシグナル価値を薄める（§3.2 の趣旨）。
- **Root cause**: 「完了操作だから緑」という素朴なマッピングが 6 箇所で独立に再発明された（Button variant に success が無いことは正しいが、className 逃げ道が開いている）。
- **Affected screens**: handoff、schedules（proposals/team board）、communications/requests、visits（モバイルカード・施設切替）。
- **Proposed control**: **component + screen 層**。6+1 箇所を `variant="default"`（--primary）へ置換。あわせて `colors:check` 系ガードに「Button/クリッカブル要素への `bg-state-*`/`bg-tag-*` 全彩度クラス」検知を追加して再発防止。残る全彩度 55 行は dot/meter/progress の正当用途と逸脱の仕分けを別途実施（ssot-discovery 未確認事項の解消）。
- **Priority**: P2
- **Verification**: 7 箇所の before/after スクリーンショット + ガード 0 違反 + 該当画面の既存 unit test（schedule-team-board 等は test-lock の可能性があるため先に test 確認）。
- **Evidence**: `src/app/(dashboard)/handoff/handoff-workspace.tsx:889,893` / `src/app/(dashboard)/communications/requests/requests-content.tsx:400` / `src/components/features/visits/visit-card-mobile.tsx:279` / `src/app/(dashboard)/schedules/proposal-human-decision-flow.tsx:26` / `src/app/(dashboard)/schedules/schedule-team-board.tsx:292` / `src/components/features/visits/facility-visit-record-switcher.tsx:220`
- **Partial remediation (2026-07-11, `TBD` commit)**: `visit-card-mobile` の「訪問完了」と `communications/requests` の「対応済みにする」から `bg-state-done` を除去し、既定のPrimary操作色へ戻した。done緑は状態表示に限定し、操作ラベル・callback・スワイプ・mutation payloadは不変。再調査で `proposal-human-decision-flow` と `schedule-team-board` は状態アイコン/ガント帯、`facility-visit-record-switcher` はBadgeであり、mutation buttonではないと分類訂正した。残る実操作候補は `handoff-workspace` の3解決操作で、action hierarchyを独立に確認する必要がある。再発防止ガードは未実施。

---

## DV-05: ローカル MetricCard/KpiCard 4 重複 — §7.2 の新規禁止・統合対象が残存し視覚仕様も乖離

- **ID**: DV-05
- **Target**: KPI カードの画面ローカル再実装 4 件
- **Reproduction**: `grep -rn "function MetricCard\|function KpiCard" src` → `admin/metrics/metrics-dashboard-content.tsx:75`、`admin/performance/page.tsx:205`、`admin/analytics/analytics-content.tsx:571`、`workflow/workflow-dashboard-view.tsx:1522`。
- **Current behavior**: 4 実装とも共通 `StatCard`（`src/components/ui/stat-card.tsx`）と乖離: 値サイズが `text-3xl`（StatCard は `text-2xl`、stat-card.tsx:105）、状態アクセントが `colorClass`/`tone` の生クラス文字列注入（StatCard は `StatusDot` role 経由、stat-card.tsx:94）。tabular-nums は各自実装済みだが偶然の一致であり契約でない。
- **Expected behavior**: guidelines §7.2「KPI・メトリクスカードは共通 StatCard を使う。画面ローカルの MetricCard / KpiCard 相当の再実装は統合対象であり、**新規追加を禁止する**」。
- **User impact**: admin 4 ダッシュボード間で KPI カードの数値サイズ・アクセント表現が微妙に異なり、画面遷移時の視覚的安定性（§7.9）を損なう。生クラス注入は 6 軸トークン外の色が入り込む穴。
- **Patient safety・operational impact**: 直接の臨床影響は小。ただし admin/performance は「要対応シグナル」帯（inv-04 の false-zero 指摘）と同居しており、KPI 表現の非統一は監視業務の読み違いを助長。
- **Root cause**: StatCard 統合前に各ダッシュボードが独自進化し、§7.2 制定後も移行バックログが消化されていない（ssot-discovery §4.3 で既知）。
- **Affected screens**: admin/metrics、admin/performance、admin/analytics、workflow ダッシュボード。
- **Proposed control**: **component 層**。4 実装を StatCard へ統合（不足 prop — progress bar / target line — は StatCard の variant として追加し、生クラス注入 prop は作らない）。
- **Priority**: P3
- **Verification**: 4 画面のスクリーンショット比較 + `grep "function MetricCard\|function KpiCard"` 0 件 + 既存 content.test の green。
- **Evidence**: `src/app/(dashboard)/admin/metrics/metrics-dashboard-content.tsx:75` / `src/app/(dashboard)/admin/performance/page.tsx:205` / `src/app/(dashboard)/admin/analytics/analytics-content.tsx:571` / `src/app/(dashboard)/workflow/workflow-dashboard-view.tsx:1522` / `src/components/ui/stat-card.tsx:94,105`

---

## DV-06: 状態ラベルの散在（constants 外 124 ファイル）と同一状態の表記揺れ — 同一工程が画面により「訪問完了/訪問済」「監査済/監査済み」

- **ID**: DV-06
- **Target**: enum 値→日本語ラベルのマッピング定義の分散と揺れ
- **Reproduction**: `*_LABELS` 定義が `src/lib/constants` 外に **124 ファイル**（grep 実測、API route 内含む）。同一のサイクル状態 `visit_completed` のラベル定義が 3 箇所に重複: `src/lib/prescription/cycle-workspace.ts:198`（訪問完了）、`src/components/features/workflow/cycle-transition-query.ts:26`（訪問完了）、`src/app/(dashboard)/workflow/workflow-dashboard-view.tsx:66`（訪問完了）— 現在は偶然一致だが、同ファイル群で `audited` は「監査済」（cycle-workspace.ts:194）vs「監査済み」（workflow-dashboard-view.tsx:62）と**既に揺れている**。`completed:` 値のラベルは横断で「完了」11 /「訪問完了」3 /「訪問済」1 /「整備完了」1 と分散。狭幅 UI 用 `CYCLE_STATUS_SHORT_LABELS`（cycle-workspace.ts:205-221）では `audited` と `set_audited` が**同一ラベル「監査済」**になり判別不能、`dispensed` は 1 文字「済」で処方ワークスペースのフィルタチップに露出（`prescriptions/prescriptions-workspace.tsx:48`）。
- **Current behavior**: 同じサイクル状態が処方ワークスペースでは「済」（1 文字チップ）、ワークフローダッシュボードでは「調剤完了」、患者ワークスペースの動線イベントでは「調剤 完了」と 3 表記で現れる。監査系 2 状態は短縮形で同一表記。
- **Expected behavior**: guidelines §7.3「新 enum は 6 軸ロールへの写像表を拡張して共通定数化」・§5.3「同一 intent の文言を揺らさない」。同一状態は全画面で同一ラベル（短縮形を持つ場合も状態間で一意）であるべき。
- **User impact**: 工程状態の学習コストが増え、「監査済」チップがどちらの監査（調剤監査/セット監査）か判別できない。1 文字チップ「済」は何が済んだのか文脈依存。
- **Patient safety・operational impact**: 4 工程（dispense→audit→set→set-audit）の現在地誤認は、監査未了の処方を監査済みと読み違える方向に働き得る（短縮形の同一ラベルが直接の経路）。
- **Root cause**: ラベル SSOT（status-labels.ts）がロール写像中心で、工程系（cycle）や機能ローカルの enum が各所に独自マップを作る構造。API route 内のラベル定義（例: `api/care-reports/today-workspace/route.ts:278`）はサーバ/クライアント二重定義も生む。
- **Affected screens**: prescriptions ワークスペース、workflow ダッシュボード、patients/[id]（カードワークスペース動線）、admin/pca-pumps ほかラベル定義 124 ファイルの表示先全般。
- **Proposed control**: **token（定数）層**。① サイクル状態ラベル（full/short/event の 3 形）を `src/lib/prescription/cycle-workspace.ts` へ一本化し、workflow-dashboard-view / cycle-transition-query のローカルマップを import に置換。② short ラベルの状態間一意性を unit test で lock（`audited` ≠ `set_audited`、1 文字ラベル禁止）。③ `*_LABELS` の constants 外新設を boundaries:check 系 ratchet で抑制。
- **Priority**: P2
- **Verification**: ラベル一意性 unit test + 3 画面（prescriptions/workflow/patients/[id]）で同一状態の表記一致を目視/スナップショット確認。
- **Evidence**: `src/lib/prescription/cycle-workspace.ts:194,198,205-221` / `src/app/(dashboard)/workflow/workflow-dashboard-view.tsx:62,66` / `src/components/features/workflow/cycle-transition-query.ts:26` / `src/app/(dashboard)/prescriptions/prescriptions-workspace.tsx:43-49` / `src/modules/pharmacy/patient-workspace/workspace-read-model.ts:34-51` / `src/app/(dashboard)/admin/pca-pumps/pca-pumps-content.tsx:199`
- **Partial remediation (2026-07-11, `TBD` commit)**: `workflow-dashboard-view` のローカル状態ラベルを削除し、履歴クエリの `WORKFLOW_STATUS_LABELS` を `CYCLE_STATUS_LABELS` の互換aliasへ置換した。処方ワークスペースの短縮ラベルは「調剤済」「調剤監査待／済」「セット監査待／済」にして、一文字「済」と `audited`/`set_audited` の衝突を解消。状態名ではなく開始／完了イベントを表す患者ワークスペース履歴ラベルは別概念として変更していない。124ファイル横断の定数新設ratchet・他domainの表記揺れは未解決。

---

## DV-07: 患者識別要素（氏名・カナ）の復元手段なし truncate — 識別 SSOT ヘッダ自身が切り詰める

- **ID**: DV-07
- **Target**: 患者氏名・カナ・前後患者名の `truncate`/`text-overflow: ellipsis`（title/tooltip 等の復元手段なし）
- **Reproduction**: 患者識別の Pinned zone 正本 `src/components/ui/patient-pinned-header.tsx:114-115` が氏名と**カナ**の両方に `truncate`（title 属性・展開手段なし。カナは同姓同名判別の一次手掛かり）。同様に調剤ワークベンチ患者キューの氏名が inline `textOverflow: 'ellipsis'`・title なし（`src/components/features/dispense-workbench/patient-list-panel.tsx:172-183`）、患者ボードのカード名（`patients/patients-board.tsx:624`）、my-day の訪問行患者名（`my-day/my-day-content.tsx:633,669`）、施設一括記録の前/次患者名（`src/components/features/visits/facility-visit-record-switcher.tsx:268,281`）。
- **Current behavior**: 長い氏名・同一接頭辞の氏名（施設入居者の同姓など）が狭幅（mobile 390px、ワークベンチ左ペイン、安全タグと同一行での flex 圧縮）で末尾を失い、復元手段がない。カナが氏名より先に切れる（text-xs で同一行）。
- **Expected behavior**: guidelines §2.3「患者コンテキストを持つ画面は最上部に患者識別（氏名…）を常時固定表示」— 識別情報は切り詰めではなく折返しで全量表示するか、少なくとも focus/tap 到達可能な全文表示（§3.10 の Tooltip 制約）を備えるべき。§7.8 の名称単独表示回避の趣旨とも整合させる。
- **User impact**: 同姓・類似名患者の判別が氏名先頭数文字に依存する。ワークベンチキューでは患者選択そのものが名前クリックであり、切れた名前での選択を強いる。
- **Patient safety・operational impact**: **患者取り違え（J-03 の明記された最高リスク）に直結する経路**。特にワークベンチは調剤対象患者の選択面であり、施設一括訪問（前/次患者表示）は連続作業中の患者文脈スイッチ点。発生は「長い/類似の氏名 × 狭幅」の条件付きのため P1 とし P0 とはしない。
- **Root cause**: レイアウト崩れ防止の truncate が識別要素にも一律適用され、「識別情報は truncate 禁止（折返し）」という規範が guidelines に存在しない。
- **Affected screens**: PatientPinnedHeader 採用画面全て、dispense/audit/set/set-audit（患者キュー）、patients ボード、my-day、visits 施設一括記録。
- **Proposed control**: **component + pattern 層**。① PatientPinnedHeader の氏名/カナを `truncate` → 折返し（`break-words`）へ変更、または全文 title + focus 可能要素化。② ワークベンチ患者キューは 2 行折返しか全文 title を追加。③ guidelines §2.3 に「識別要素（氏名・カナ・生年月日）の truncate 禁止」を明文追加。
- **Priority**: P1
- **Verification**: 長名（10 文字姓名 + 長カナ）の fixture で mobile390/ワークベンチ左ペインのスクリーンショット確認 + patient-pinned-header の unit test に長名ケース追加。
- **Evidence**: `src/components/ui/patient-pinned-header.tsx:114-115` / `src/components/features/dispense-workbench/patient-list-panel.tsx:172-183` / `src/app/(dashboard)/patients/patients-board.tsx:624` / `src/app/(dashboard)/my-day/my-day-content.tsx:633,669` / `src/components/features/visits/facility-visit-record-switcher.tsx:268,281`
- **Partial remediation (2026-07-11)**: 共通 `PatientPinnedHeader` の氏名とカナを `truncate` から折返しへ変更し、モバイルでは患者識別クラスタを全幅に確保した。規範SSOTにも患者識別子をellipsisのみで隠さないルールを追加。長名・長カナのcomponent testでクラス契約とDOM内の全文を確認した。調剤ワークベンチ患者キューも氏名行を `overflowWrap: 'anywhere'` の折返しへ変更し、長名fixtureで省略スタイル不使用と既存の患者選択をcomponent testで確認した。`PLAYWRIGHT=1` + local `ph_os_e2e` の読取り専用デモセッション、mock workbench、1680px幅で合成長名を描画し、左ペインに全文が複数行で表示される screenshot と accessibility tree を確認した。患者ボードのリスト行も `truncate` を `break-words` へ変更し、合成長名が2行に折返され、患者詳細リンク・安全タグ・工程操作を保持する1680px screenshotとcomponent testで確認した。施設連続記録の横スクロール患者カード・前後切替リンクも `truncate` から折返しへ変更し、長名の全文・href・swipe契約をcomponent testで確認した。既存の390px E2EはDB fixture書込みを伴うため未実行。my-day の未完了／完了訪問行も患者名を折返しへ変更し、長名fixtureのcomponent testと、390px・合成APIのlocal browser mockで全文3行表示、既存の訪問記録href、状態・時刻、横スクロールなし、page/console errorなし、書込みrequestなしを確認した。DV-07 は実装経路を是正済みだが、施設切替の390px実画面/swipe、full E2E/build/a11y/200% zoom/clinical review は未実行のため Partial を維持する。

---

## DV-08: 処方受付トリアージ一覧の切り詰め — 発行元は復元不能、処方内容は hover 専用 title のみ

- **ID**: DV-08
- **Target**: `src/app/(dashboard)/prescriptions/intake/intake-triage-content.tsx` の IssuerCell / ContentCell
- **Reproduction**: `IssuerCell`（:111-116）は発行元（医療機関名）を固定 `w-32 max-w-32 truncate` で切り詰め、**title 属性も展開手段もない**。`ContentCell`（:119-130）は「患者名 様 — 処方内容 Rx番号」（`buildContentLabel` :86-88）を `max-w-[360px] truncate` し、復元手段は native `title` のみ。
- **Current behavior**: 長い医療機関名（「医療法人○○会△△クリニック」等）は 128px で切れ、どの発行元か一覧上で確定できない。処方内容+Rx 番号は 360px 超で切れ、hover できないタッチ端末・キーボード操作では全文に到達できない。
- **Expected behavior**: guidelines §3.10 Tooltip 制約「hover はタッチ端末で発火しないため、focus と tap/長押しでも同一詳細へ到達できること」。§2.4 原則 3（Counted list contract の趣旨: 切り詰めを暗黙にしない）。少なくとも title 付与（Issuer）と、focus/tap 可能な全文表示（Content）が必要。
- **User impact**: 受付トリアージは「どの処方から処理するか」を仕分ける画面。発行元・Rx 番号が読めないと行の同定に詳細画面への往復が必要になり、トリアージ効率が落ちる。
- **Patient safety・operational impact**: 類似の医療機関名・同名患者の処方の取り違え選択リスク（選択誤りは後続の調剤 4 工程全体を誤った処方で進める入口になる）。患者名はラベル先頭のため比較的保全されるが、Rx 番号は末尾で最初に切れる。
- **Root cause**: 一覧密度確保の手段として固定幅 truncate を採用し、復元導線（title / 展開 / 折返し）の要否が列単位で検討されていない。
- **Affected screens**: prescriptions/intake（受付トリアージ）。同型の truncate は prescriptions-table.tsx:158 にも存在（max-w-[100px]）。
- **Proposed control**: **screen 層（+pattern）**。① IssuerCell に最低限 `title` を付与、望ましくは幅を内容追従に。② ContentCell は Rx 番号を独立列に分離（切れない位置へ）し、全文は行クリックの詳細か focus 可能 tooltip で到達可能に。③ DataTable の共通「truncate 列」パターン（title 必須）を定義。
- **Priority**: P2
- **Verification**: 長い医療機関名 fixture での表示確認 + キーボード/タッチで全文到達可能なことの手動検証（axe/E2E スモークに追加）。
- **Evidence**: `src/app/(dashboard)/prescriptions/intake/intake-triage-content.tsx:86-88,111-116,119-130` / `src/app/(dashboard)/prescriptions/prescriptions-table.tsx:158`

---

## 監査対象としたが finding 化しなかった事項（記録）

- **ワークベンチの inline 13px 氏名・生 hex**: §2.4/§3.1 でレセコン風高密度が明示的に認可された領域。sub-12px（10px メタ行）のみ DV-02 に計上し、13px 本文と --wb- トークン体系は認可範囲と判断（トークン化は color-token-remediation-plan の既存スコープ）。
- **`discharged` の CASE/PATIENT_STATUS 二重意味**: `status-labels.ts:326-341` にコメントで意図明記済みの文書化された差（ssot-discovery §4.5）。報告しない。
- **cycle-workspace 内の full/short 2 系ラベル自体**: 狭幅 UI 用短縮形の存在は正当。問題は短縮形の状態間衝突と画面間揺れのみ（DV-06）。
- **薬価 `toFixed(1)` の末尾ゼロ**: §7.8 の末尾ゼロ禁止は用量表記が対象。薬価（¥8.0/錠）は価格表記であり違反とみなさない。
