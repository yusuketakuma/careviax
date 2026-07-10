# Phase 3 画面棚卸し — inv-06: 処方・服薬系（15ルート）

作成日: 2026-07-11 / 作成: 画面棚卸しエージェント（read-only）
凡例: Audited = `.agent-loop/UI_AUDIT_MATRIX.md` に当該ルート名の明示記載があるか。
2026-06-20 の 114 画面 sweep は全画面対象だが per-screen 行は台帳外（workflow 出力保持）のため、
本列は「台帳本文に route 名が残っているか」のみを事実として記す。
権限: 本バケットの page/content いずれにも FE 側 role gating（useSession/canX 分岐）は確認できず
（grep 結果: `prescription.shared.ts` の `role === 'neutral'` は状態色 role であり権限ではない）。
org-wide access model（薬剤師フル/事務 read-all）に従う認証済みスタッフ想定。サーバ側の
per-route 認可強制は本棚卸しでは未確認。

## 画面台帳

| Route | Screen/Flow(日本語名) | User role | Patient context | Primary task | States | Audited | SSOT applied | Unit tested | E2E tested | A11y notes | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| (dashboard)/patients/[id]/management-plan | 管理計画（リダイレクトスタブ） | 認証済みスタッフ（FE gating なし） | 患者IDのみ（表示前に患者詳細へ redirect） | `buildPatientHref(id)` へ redirect | redirect のみ。loading.tsx あり（PageScaffold+Skeleton、redirect スタブには実質不要）。error.tsx なし（(dashboard)/error.tsx 継承） | 記載なし | PageScaffold/Skeleton（loading.tsx 内） | あり: page.test.ts 1件（redirect 検証） | なし（直接 spec 未確認） | loading.tsx に aria-label="管理計画を読み込み中" | src/app/(dashboard)/patients/[id]/management-plan/page.tsx, loading.tsx |
| (dashboard)/patients/[id]/management-plan/print | 訪問薬剤管理指導計画書 印刷ビュー | 同上 | あり（患者名を帳票テーブルに表示。PatientHeader 不使用） | 管理計画書のA4印刷（ready 後 150ms で自動 `window.print()`） | initial loading（role=status aria-live=polite の専用 Skeleton）/ error（固定文言+「戻る」リンク、patient/plan/case 3クエリいずれか失敗 or 患者–ケース紐付け不一致で fail-close）/ colocated loading.tsx・error.tsx なし（client 内蔵状態） | 記載なし | PrintPageToolbar / PrintLayout / Skeleton / buttonVariants。帳票本体は print 専用 raw gray/black 直書き | あり: print/page.test.tsx 6件 | あり: tools/tests/ui-major-screens.spec.ts:1916 (management-plan-print) | role=status + aria-live=polite + sr-only（loading）。エラーは色+文言 | src/app/(dashboard)/patients/[id]/management-plan/print/page.tsx |
| (dashboard)/patients/[id]/medication-calendar | 服薬カレンダー | 同上 | あり（backHref=患者詳細、印刷ヘッダに患者ID。PatientHeader 不使用） | 月間服薬スケジュールの確認・印刷・PDF | Suspense fallback=形状スケルトン（false-empty 回避コメント付き）/ client 内 isLoading Skeleton+sr-only / error=手組み role=alert 固定文言+再試行（min-h-11）/ empty=EmptyState(CalendarX) / 月ナビ / md: でテーブル(role=grid)⇔モバイル日次縦リスト切替 / print:専用ヘッダ。loading.tsx あり、error.tsx なし | 記載なし（matrix の medication-calendar-grid.tsx は dispense 系別物） | PageScaffold / WorkflowPageIntro / EmptyState / Skeleton / buttonVariants / --time-slot-* カテゴリ色トークン。**ErrorState 共通部品は不使用（手組み）** | あり: 3ファイル計9件（render 5 / logic 3 / page 1） | 未確認（tools/tests に medication-calendar への goto なし） | role=grid、DOW_LONG_LABELS、印刷ボタン aria-label、再試行 min-h-11、md:hidden/hidden md:block で a11y ツリーに片方のみ残す設計コメント | src/app/(dashboard)/patients/[id]/medication-calendar/page.tsx, medication-calendar-content.tsx |
| (dashboard)/patients/[id]/medications | 服薬管理 | 同上 | あり（WorkflowPageIntro backHref。PatientHeader 不使用） | 服薬中薬剤・薬学的課題・疑義照会・残薬の患者単位管理（追加/編集/お薬手帳QR出力） | Suspense fallback=セクション別形状スケルトン×3 / セクション毎に isLoading(role=status aria-live)+isError(ErrorState+onRetry)+empty(EmptyState) / エラー時カウントは「—」表示（false-zero 回避）/ Dialog: 薬剤追加・課題編集・QR出力 / mutation error role=alert aria-live=assertive。loading.tsx あり、error.tsx なし | 記載なし | PageScaffold / WorkflowPageIntro / DataTable / ErrorState / EmptyState / Dialog / buttonVariants(min-h-11) / clinicalActionSizeClass=min-h-[44px] sm:min-h-[44px] | あり: medications-content 19件 + page 3件 | あり: ui-major-screens.spec.ts:1885,3002 (patient-medications) | role=status/alert + aria-live、44px 明示クラス、アイコン aria-hidden | src/app/(dashboard)/patients/[id]/medications/page.tsx, medications-content.tsx (1483行) |
| (dashboard)/patients/[id]/medications/print | 薬歴・服薬一覧 印刷ビュー | 同上 | あり（患者名を帳票に表示） | 服薬一覧のA4印刷（自動 window.print、org 名を薬局名に反映） | initial loading（role=status aria-live=polite Skeleton）/ error（固定文言+戻る、org/patient/medication 3クエリ fail-close）/ colocated loading/error なし | 記載なし | PrintPageToolbar / PrintLayout / Skeleton | あり: print/page.test.tsx 4件 | あり: ui-major-screens.spec.ts:1925 (medications-print) | role=status + aria-live=polite | src/app/(dashboard)/patients/[id]/medications/print/page.tsx |
| (dashboard)/patients/[id]/prescriptions | 処方内容一覧（患者別処方履歴） | 同上 | あり（backHref=患者詳細。PatientHeader 不使用） | 患者の処方履歴・処方変更差分・薬剤マスタ照合の確認、印刷 | primary loading（role=status aria-label aria-live）/ primary error=ErrorState+onRetry / drug-master 部分エラー=非ブロッキング notice(role=status)+再試行（false-empty 回避コメント）/ 差分レビュー DataTable / StateBadge role 駆動(on_hold=confirm, cancelled=blocked) / window.print。loading.tsx あり、error.tsx なし | あり（matrix L141: 「primary ErrorState + retry、drug-master partial error…実装済み」） | PageScaffold / WorkflowPageIntro / StateBadge / DataTable / ErrorState / state-confirm・state-blocked 6軸トークン / min-h-11 フィルタ入力 | あり: content 26件 + page 2件 | あり: ui-major-screens.spec.ts:1888 (patient-prescription-history) | role=status/alert/list、aria-live、再試行ボタン min-h-11 | src/app/(dashboard)/patients/[id]/prescriptions/page.tsx, prescription-history-content.tsx (1971行) |
| (dashboard)/patients/[id]/visit-records | 訪問記録（リダイレクトスタブ） | 同上 | 患者IDのみ（患者詳細へ redirect） | `buildPatientHref(id)` へ redirect | redirect のみ。loading.tsx あり（redirect スタブには実質不要）。error.tsx なし | 記載なし | PageScaffold/SkeletonRows（loading.tsx 内） | あり: page.test.ts 1件 | なし（直接 spec 未確認） | loading.tsx に aria-label | src/app/(dashboard)/patients/[id]/visit-records/page.tsx, loading.tsx |
| (dashboard)/patients/[id]/visit-records/print | 訪問記録一覧 印刷ビュー | 同上 | あり（患者名を帳票に表示） | 期間指定（dateFrom/dateTo searchParams）の訪問記録A4印刷（自動 window.print） | initial loading（role=status aria-live=polite）/ error（固定文言+戻る、org/patient/records fail-close）/ colocated loading/error なし | 記載なし | PrintPageToolbar / PrintLayout / Skeleton / buttonVariants | あり: print/page.test.tsx 7件 | あり: ui-major-screens.spec.ts:1932 (visit-records-print) | role=status + aria-live=polite | src/app/(dashboard)/patients/[id]/visit-records/print/page.tsx |
| (dashboard)/prescriptions | 処方受付一覧（master-detail ワークスペース） | 同上 | 行単位（一覧行に患者名・カナ。PatientHeader 不使用） | 受付状況・疑義・調剤待ちの確認と対象処方の選択→詳細/新規受付導線 | loading.tsx あり（master-detail 形状スケルトン、h-[calc(100dvh-64px)]）/ error.tsx あり（createRouteErrorBoundary 共通）/ 一覧: isLoading Skeleton・isError&&空→ErrorState+onRetry・empty→EmptyState / useInfiniteQuery「さらに読み込む」+ useRealtimeInvalidation（realtime 再取得）/ 検索 role=search / lg: で左480pxリスト+右インライン詳細、モバイルは h-45dvh 縦積み | あり（L98/143 は new のみだが、T4 等に処方系記載。route 名そのものの行は new/qr-drafts/[id] のみ） | PageScaffold(variant=bare) / WorkflowPageHeader / MainWorkflowCompactNav / DataTable(mobileLabel meta) / ErrorState / EmptyState / FilterSummaryBar / ActionRail / useKeyboardShortcuts / STATUS_TOKENS 6軸（CYCLE_STATUS_CONFIG 経由） | あり: workspace 14 / table 4 / inline-detail 11 / typography contract 1 describe | あり: ui-workflow-flow.spec.ts:42他 / e2e-prescription-dispensing-flow.spec.ts:879,908,1073 / ui-mobile-layout.spec.ts:62,111 / ui-major-screens.spec.ts:26 | `!h-auto !min-h-[44px] sm:!min-h-[44px]` force 44px 多用、role=search/status、focus-visible ring | src/app/(dashboard)/prescriptions/page.tsx, prescriptions-workspace.tsx, prescriptions-table.tsx, prescription-inline-detail.tsx, loading.tsx, error.tsx |
| (dashboard)/prescriptions/[id] | 処方受付詳細 | 同上 | あり（タイトル=「{患者名} の処方受付」、患者詳細への Link。PatientHeader 不使用） | 受付内容・処方明細・疑義照会・リフィル/分割調剤情報の確認 | Suspense fallback=Loading スピナー（文言あり）+ loading.tsx あり（PageScaffold+SkeletonRows）/ client loading=role=status+sr-only / error=ErrorState+onRetry（旧インライン box を共通部品へ置換した旨コメント）/ 疑義照会 empty=「疑義照会はありません。」 | 記載なし | PageScaffold / WorkflowPageHeader / DataTable / ErrorState / PageShortcutLinks(調剤キュー・新規受付) | あり: page 2件 + content 7件 | 直接 goto の spec なし（/prescriptions 経由遷移は dispensing-flow にあり）— 直接到達は未確認 | role=status + aria-label + sr-only | src/app/(dashboard)/prescriptions/[id]/page.tsx, prescription-detail-content.tsx (673行), loading.tsx |
| (dashboard)/prescriptions/intake | 処方取込トリアージ（new_05_import） | 同上 | 行単位（取込キュー行。PatientHeader 不使用） | FAX/QR等の取込キューを分類し受付へ流す | Suspense fallback=Loading スピナー / loading=role=status Skeleton / isError or !data→ErrorState+refetch / role=alert 通知あり(L445) / colocated loading.tsx なし（親 prescriptions/loading.tsx の master-detail スケルトンを継承=形状不一致）/ error.tsx は親を継承 | 記載なし | PageScaffold(bare) / DataTable(mobileLabel) / ErrorState / FilterChipBar / WorkspaceActionRail(daily-ops rail) / useRealtimeQuery / PROCESS_STEPS_9 | あり: page 2 / content 6 / shared 3 | 部分的: ui-audit-extensions.spec.ts:479（sidebar nav 遷移確認）、design-screen-map.ts:87。画面内容の spec は未確認 | role=status/alert | src/app/(dashboard)/prescriptions/intake/page.tsx, intake-triage-content.tsx (477行) |
| (dashboard)/prescriptions/new | 新規処方受付（手入力フォーム） | 同上 | **あり（PatientHeader sticky — 本バケット唯一の使用箇所）** | 患者・ケース選択→処方明細入力→受付登録で調剤ワークフロー開始。QR下書き(qr_draft_id)取込 | 患者検索/選択患者/ケース/前回処方/QR下書き/医療機関/後発候補の各取得に loading/error(ErrorState+retry)/stale/empty 実装（matrix L143 記載）/ draft: usePrescriptionDraft によるオフライン暗号化自動保存+復元、保存失敗は toast 1回通知（isOfflineEncryptionUnavailableError 分岐）/ ConfirmDialog=前回処方での明細置換（QR由来時 destructive variant で二重確認相当）/ submit mutation error=ローカル role=alert box（共通化余地 = matrix L98）/ colocated loading/error なし（親継承） | **あり**（L98・L143 に明示） | WorkflowPageHeader / PageScaffold / PageShortcutLinks / PatientHeader / ConfirmDialog / ErrorState / StateBadge | あり: 7ファイル計50件（form 15 / contract 11 / ui-contract 3 / submit 8 / urls 3 / period-review 2+8） | あり: ui-workflow-flow.spec.ts:59 / ui-audit-extensions.spec.ts:267,669,734 / ui-mobile-layout.spec.ts:75,112 / ui-major-screens.spec.ts:27 | form aria-label、role=alert、PatientHeader sticky で患者取違え防止 | src/app/(dashboard)/prescriptions/new/page.tsx, prescription-intake-form.tsx (3396行), prescription-intake-submit.ts, src/lib/hooks/use-prescription-draft |
| (dashboard)/prescriptions/qr-drafts | QR下書き一覧 | 同上 | 行単位（下書き行に患者照合結果。未照合は state-confirm 色） | QRスキャン下書きの一覧・フィルタ（全件/未照合）・詳細への遷移 | all/unmatched 2クエリ + filterMode 切替 / DataTable の errorMessage/onRetry に取得失敗を接続 / realtime invalidateOn(qr_draft_created/confirmed) / キーボード ArrowUp/Down/Enter（scope=qr-drafts）/ colocated loading/error なし（親 prescriptions/ の boundary 継承） | 部分的（T4 L122 に「qr-drafts 等」= 状態色混在指摘。現コードは bg-state-confirm トークン使用で raw 色 grep 0 件 → 指摘は解消済みの可能性、matrix 側が stale） | PageScaffold / WorkflowPageHeader / DataTable / Badge + state-confirm トークン / useKeyboardShortcuts | あり: page.test.tsx 2件 | あり: e2e-prescription-dispensing-flow.spec.ts:809,824,844 / ui-mobile-layout.spec.ts:100,470 | キーボード行移動 + Enter 選択、data-testid=qr-drafts-list-workspace | src/app/(dashboard)/prescriptions/qr-drafts/page.tsx (329行) |
| (dashboard)/prescriptions/qr-drafts/[id] | QR下書き詳細・受付確定 | 同上 | あり（照合患者情報+ケース選択。未照合は Badge destructive 警告） | QR下書きの内容確認→ケース紐付け→受付確定（confirm mutation）or 破棄 | loading=PageScaffold 内 role=status aria-live=polite / isDraftError→ErrorState / ケース取得 loading(role=status aria-live)+error で確定不可（fail-close: isCaseSelectionUnavailable）/ 破棄=AlertDialog（destructive 二重確認）/ 確定成功→受付へ遷移、破棄成功→一覧へ / mobileDense: モバイル min-h-[44px]・デスクトップ sm:h-8/sm:min-h-0 の密度切替 / colocated loading/error なし（親継承） | **あり**（L135: 見出し階層・aria-live・必須色の指摘） | PageScaffold / WorkflowPageIntro / ErrorState / AlertDialog / Badge / page.helpers.ts 分離（route 非route export 回避パターン） | あり: page 12 / accessibility 2 / helpers 3 | あり: e2e-prescription-dispensing-flow.spec.ts:849 / ui-mobile-layout.spec.ts:470 | 専用 accessibility test あり。role=status + aria-live。デスクトップ側は 44px 未満（sm:h-8、キーボード前提の意図的密度） | src/app/(dashboard)/prescriptions/qr-drafts/[id]/page.tsx (1377行), page.helpers.ts |
| (dashboard)/qr-scan | QRスキャン（モバイル起点の処方QR読取→PC送信） | 同上 | あり（QR患者情報の照合。複数候補時は患者選択 Dialog） | カメラで処方QRを連続スキャン→パース→患者照合→下書きとして PC へ送信 | ScanPhase state machine: camera/scanned/parsed/matched/sending/done/error（page.tsx L71-78）/ cameraError（getUserMedia 失敗・@zxing dynamic import）/ 各フェーズ role=status aria-live=polite、エラー role=alert / 患者複数候補 Dialog / 送信失敗は固定文言+clientLog.warn / sessionId 維持による連続スキャン / colocated loading/error なし（(dashboard) 直下 boundary 継承） | 記載なし | WorkflowPageIntro / Dialog / page-shortcut-presets / qr-scan-draft-payload(zod schema) | あり: contract 14 / payload 5（**render test なし**） | あり: e2e-prescription-dispensing-flow.spec.ts:793 / ui-mobile-layout.spec.ts:80,113 / ui-major-screens.spec.ts:28 | role=status/alert + aria-live 多数、CameraOff アイコン+テキスト併用 | src/app/(dashboard)/qr-scan/page.tsx (1077行), qr-scan-draft-payload.ts |

## De facto パターン・逸脱・重複実装（Phase 5 監査の種）

### De facto パターン（本バケットで確立している型）
- **印刷ルート三兄弟の共通型**: management-plan/print・medications/print・visit-records/print は
  「'use client' + 複数 useQuery(fail-close) → ready 後 setTimeout(window.print, 150) → role=status
  aria-live=polite の専用 Skeleton → エラーは固定文言+戻るリンク」で完全に同型
  （src/app/(dashboard)/patients/[id]/{management-plan,medications,visit-records}/print/page.tsx）。
- **Suspense fallback の新規範**: 「同形状の軽量スケルトン外枠（スピナー文言なし=false-empty/CLS
  回避）」というコメント付きパターンが medications/page.tsx・medication-calendar/page.tsx で確立。
- **取得失敗の fail-open/fail-close 使い分け**: primary データは ErrorState+onRetry で停止、
  補助データ（薬剤マスタ等）は非ブロッキング notice + 再試行 + カウント「—」表示
  （prescription-history-content.tsx L1630-1785, medications-content.tsx L1100-1117）。
- **6軸状態色 SSOT の遵守**: CYCLE_STATUS_CONFIG が MEDICATION_CYCLE_STATUS_ROLE + STATUS_TOKENS
  から生成（prescriptions/prescription.shared.ts）。旧 CLAUDE.md 色規則の不採用が明示コメント化。
  服薬時間帯は状態色でなく --time-slot-* カテゴリ色トークン（medication-calendar-content.tsx L59-66）。
- **DataTable への errorMessage/onRetry 接続**（qr-drafts/page.tsx L188, prescriptions-table.tsx）。

### 逸脱
1. **medication-calendar-content.tsx は共通 ErrorState 不使用**: 手組み role=alert box + 手組み再試行
   ボタン（L343-363）。同思想だが部品化されておらず、prescription-history の drug-master notice
   （こちらは非ブロッキング補助の意図コメントあり）とも別実装。
2. **local `StatusDot` の命名衝突**: prescriptions-table.tsx L50 の `StatusDot` は共有
   `@/components/ui/status-dot`（StateBadge/StatusDot SSOT）と同名の別物（実体は Badge ラッパー）。
   色は STATUS_TOKENS 経由で SSOT 準拠だが、名前が SSOT 部品を偽装する。
3. **redirect スタブに loading.tsx が残存**: management-plan/ と visit-records/ は page が即 redirect
   するのに PageScaffold+Skeleton の loading.tsx を保持。到達し得ない装飾（削除候補）。
4. **Suspense fallback の新旧混在**: prescriptions/[id]/page.tsx と prescriptions/intake/page.tsx は
   旧型の `<Loading label="...読み込み中..." />` スピナー、medications/medication-calendar は
   新規範のスケルトン。同バケット内で不統一。
5. **intake の loading 継承形状不一致**: /prescriptions/intake は colocated loading.tsx を持たず、
   親 prescriptions/loading.tsx（フルスクリーン master-detail スケルトン）を継承する。intake の
   実画面（PageScaffold+テーブル）と形状が一致しない。
6. **PatientHeader 未使用**: 「PatientHeader は患者識別 SSOT」（メモ: careviax-patientheader-reuse）
   に対し、患者配下 5 ルート（medications/medication-calendar/prescriptions ほか印刷ビュー）は
   いずれも WorkflowPageIntro の backHref+タイトルのみで患者氏名/生年月日の常時表示なし。
   本バケットで PatientHeader を使うのは prescriptions/new のみ（sticky）。患者取違え防止の観点で
   Phase 5 の検討対象。
7. **44px の 2 方針並存**: prescriptions ワークスペース系は `!h-auto !min-h-[44px]
   sm:!min-h-[44px]`（全 viewport 44px 強制、`!` エスカレーション付き）を大量反復。一方
   qr-drafts/[id] は `min-h-[44px] sm:h-8 sm:min-h-0`（モバイルのみ 44px、デスクトップは密度優先）。
   Button variant contract（メモ）上どちらも意図的だが、reviewer が判別できる基準の明文化が必要。
8. **matrix の stale 記述**: T4（L122）は qr-drafts の非6軸色混在を指摘するが、現コードは
   qr-drafts 2 ファイルとも raw 色 grep 0 件・state-confirm トークン使用。台帳更新漏れの可能性。

### テスト/E2E ギャップ
- **medication-calendar は E2E 到達 spec なし**（tools/tests 全 grep でヒットなし）。
- **qr-scan は unit render test なし**（contract/payload テストのみ。カメラ依存のためと推測、未確認）。
- **prescriptions/[id]・intake は直接 goto の E2E なし**（一覧経由遷移・sidebar nav 確認のみ）。
- redirect スタブ 2 ルートの E2E なし（低リスク）。

### 重複実装
- 印刷 3 ルートのデータ取得+ready 判定+auto-print タイマー+ローディング/エラー UI がコピー&ペースト
  で 3 重化（PrintPageToolbar/PrintLayout は共通化済みだが、フェッチ/print 起動ロジックは未共通化）。
- org 名取得 → `pharmacyName={org.name.trim() || 'PH-OS薬局'}` のフォールバックが medications/print と
  visit-records/print に重複。management-plan/print は org を取得せず 'PH-OS薬局' ハードコード
  （print/page.tsx L185）で挙動も不一致。
