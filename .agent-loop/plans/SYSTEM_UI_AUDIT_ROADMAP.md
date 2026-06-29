# System-wide UI Audit Roadmap — Claude×Codex 壁打ち用 (DRAFT, 実装前レビュー)

> 生成: 2026-06-28 システム横断監査 Workflow (18 agents, 110/111画面 + BE↔FEカバレッジ + completeness-critic)。
> **これは実装前 DRAFT。codex の反証ベース壁打ちでギャップをゼロにしてから Wave1 着手。**
> user directive: 実装前codexレビュー必須 / 忖度なし / 疑問点・計画漏れ・手順抜け・対象画面漏れ・BE-without-FE をゼロに。

## カバレッジ & グレード

- 監査済 110/111 画面。未監査: ['/settings']
- グレード分布: **B82 / A14 / C14**。修正候補: **P1×13 / P2×140 / P3×158**

## ⚠ 監査プロセスの既知の穴 (completeness-critic + Claude忖度なし検証)

- 対象画面漏れ1件: /settings (src/app/(dashboard)/settings/page.tsx:1-19) は OperationalPolicyContent を描画する実画面だが監査リスト110件に不在。/admin/settings と混同された漏れ。設定/運用ポリシーは情報優先度・グルーピング・見出し階層の監査対象であり superficial 扱い不可。
- 状態次元(loading/empty/error/permission)の体系的スキップ疑い: loading/empty/error は page.tsx ではなく専用の loading.tsx(50+件)/error.tsx(25+件)に実装されている(例: src/app/(dashboard)/set/loading.tsx, .../set/error.tsx, .../settings/error.tsx)。監査が page.tsx のみを読んでいた場合、状態色・空表示・エラー表示の適合判定が実ファイルに grounding されておらず file:line 根拠が欠落。/settings は error.tsx を持つのにルート自体が未監査。
- 薄いラッパー page.tsx の表層監査リスク: clerk-support/communications/select-mode/select-site/offline-sync/admin professionals は page.tsx が4行で、実UI(レイアウト・密度・状態)は兄弟の \*-content.tsx クライアントコンポーネントに存在。operations-insights/capacity/inventory-forecast/notification-settings/data-explorer/formulary/document-templates も7-8行。page.tsx だけの監査では配色/タイポ/密度/a11y の逸脱を捕捉できず、claims が実描画コンポーネントの file:line に紐づかない。
- 印刷ルート(reports/print, reports/[id]/print, patients/[id]/{management-plan,medications,visit-records}/print)は print media 固有のタイポ/密度/コントラスト要件を持つが、画面用ルーブリック(タッチ44px等)では評価軸が噛み合わず、印刷a11y/可読性が体系的に未評価の可能性。
- 件数表記の不整合: 監査リストは prescriptions 系を括弧注記でまとめており実ファイル数(111)と宣言数(110)が乖離。漏れ検出が件数照合に依存していた場合、設定画面1件の漏れを吸収してしまう構造的リスク。
- BE-FE 突合の盲点: 監査が page.tsx 起点のため、サーバーコンポーネント側の fetch/権限分岐(canAuthorReport 等)に依存する permission 状態の出し分けが、page.tsx に現れず content/サーバー層に隠れる画面で未マッピングの懸念。

### Claude スポット検証 (誤検知率)

- **EmptyState採用主張=健全**: my-day/patients/notifications/handoff/conferences/requests/reports/billing いずれも EmptyState 未import → 誤検知でない。
- **Skeleton主張=部分要注意**: workflow/notifications/conferences は loading.tsx+Skeleton既存（RSC loading と client refetch spinner の区別が曖昧）。external/qr-scan/collaboration は loading.tsx も Skeleton も無し=主張有効。
  → **Wave2 Skeleton項目は『client spinnerか RSC既カバーか』を画面ごとに確認してから実装**（盲目置換禁止）。codex壁打ちで個別 refute 希望。
- header/色/touch 主張は file:line grounding 済みで堅い。

## 🔴 SAFETY-CRITICAL (最優先, Wave前に着手判断)

### S0. Gate all 4 workbench irreversible sign-offs behind ConfirmDialog (調剤完了 / 監査承認+麻薬二重確認 / セット監査承認 / セット全セット advance) `[SSOT裁定要]`

- 画面/箇所: /dispense (use-workbench-write-handlers.ts:1033), /audit (:1060 + narcotic collectDispenseAuditDoubleCount:1053), /set-audit (:1086 + onAuditNg:1183), /set (onBulk:985)
- 修正: Wrap completeDispense / completeAudit / setAudit(approved) / onAuditNg in ConfirmDialog before mutate; on /audit when any line isNarcotic require ConfirmDialog.requiredConfirmText (double-confirm). F12/footer-primary currently commits instantly with only inline validation. No visual restyle of workbench chrome — confirm dialog is a modal overlay, not a chrome change.
- リスク: Irreversible publish of dispense/audit/set evidence (incl. 麻薬 counts) one keystroke away with no confirmation — wrong-patient or miscount publishes silently.

### S1. Add focus-visible rings to all workbench raw controls (keyboard focus currently invisible) `[SSOT裁定要]`

- 画面/箇所: /dispense, /audit (麻薬 count inputs prescription-grid.tsx:962/972), /set, /set-audit (監査OK :794, NG :818) — raw <button>/<select>/<input>/checkbox throughout prescription-grid.tsx + right-pane.tsx
- 修正: Add focus-visible:ring-2 focus-visible:ring-ring (or equivalent outline) to every interactive control. The workbench is fully keyboard-driven (F-keys) yet focus is invisible — a direct WCAG 2.4.7 AA failure on the highest-stakes screens, including narcotic count entry.
- リスク: AA fail on keyboard navigation of irreversible clinical actions; operator cannot see which control has focus before committing.

### S2. Scope workbench global keydown so F11/F12 don't hijack browser fullscreen/devtools `[SSOT裁定要]`

- 画面/箇所: /dispense /audit /set /set-audit (dispensing-workbench.tsx:281)
- 修正: window keydown preventDefault on F11/F12 hijacks browser shortcuts globally; scope listener to workbench focus or drop F11 from the fkey map.
- リスク: Global key capture is an operability/accessibility hazard outside the intended work surface.

### S3. Gate 月次締め (billing close, terminal/irreversible) behind ConfirmDialog

- 画面/箇所: /billing/candidates (billing-candidates-content.tsx:992-1002; also row 確定/除外 :694-722)
- 修正: Wrap closeMutation in ConfirmDialog(variant=destructive) summarizing closeReady count + month before mutate; promote 月次締め to default(primary) variant. Sibling /billing/partner-cooperation already gates transitions with ConfirmDialog — this is a cross-screen inconsistency, not a new pattern.
- リスク: One-click terminal billing close (exported state) with no undo; financial/data-integrity.

### S4. Fix qr-draft editor data-loss: add leave-guard + autosave, and confirm the irreversible 確定 conversion

- 画面/箇所: /prescriptions/qr-drafts/[id] (page.tsx:259 formState, :1079 確定)
- 修正: Editable formState has NO useUnsavedChangesGuard and NO autosave (contrast /prescriptions/new which has both at :530/:577) → silent edit loss. Add guard+autosave; gate 確定 (draft→処方受付, irreversible) with ConfirmDialog before confirmMutation.mutate.
- リスク: Data loss on navigation away from an in-progress prescription draft; irreversible conversion with no confirm.

### S5. Convert irreversible account-status + destructive-delete raw Dialogs to ConfirmDialog (with requiredConfirmText where terminal)

- 画面/箇所: /admin/users (suspend/retire :1258), /admin/pharmacy-sites (insurance delete :885), /admin/shifts (suspend/retire :660), /admin/billing-rules (delete AlertDialog :612), /patients/[id]/consent (RevokeConsentDialog :662)
- 修正: Replace hand-written Dialog/AlertDialog with ConfirmDialog(variant=destructive); 退職(retire) and consent-revoke (invalidates ALL external-share access) require requiredConfirmText double-confirm; pharmacy-site delete needs an explicit 取り消せません line.
- リスク: Irreversible personnel/access/billing-config mutations without the canonical destructive-confirm contract; consent-revoke severs patient external access.

### S6. Fix dashboard timeline AA contrast fail + chart-token-as-state misuse

- 画面/箇所: /dashboard (dashboard-cockpit.tsx:288)
- 修正: TIMELINE_BLOCK_CLASSES.visit 'bg-chart-2 text-white' ≈3.1:1 < 4.5:1 AND misuses a chart series token as a state fill → 'bg-primary text-primary-foreground' (or a verified ≥4.5:1 token); reserve chart-2 for non-text point/line.
- リスク: AA text-contrast failure on the home root timeline.

### S7. Raise sub-12px floor breaches that are screen-visible (not print)

- 画面/箇所: /prescriptions inline-detail (text-[9px] :280/284/320/333/338), /prescriptions/[id] & qr-drafts/[id] (text-[10px]), /reports/print hub (text-[9px] QR / text-[10px]), workbench (9.5–11px, ssot exception candidate)
- 修正: Raise screen-visible badge/label text to the 12px label floor (text-xs); keep print:text-[9px] overrides for print only. Workbench dense type is flagged as an SSOT exception decision (see open_questions), not auto-changed.
- リスク: Legibility/AA-readability on dense clinical data; smallest offenders are barely readable.

### S8. Critical-concern + barcode-safety a11y on the safety-check screen

- 画面/箇所: /patients/[id]/safety-check (ConcernCard focus :110-121, critical label :126)
- 修正: Add focus-visible:ring-2 to selectable ConcernCard <button>; critical concern label text-destructive → text-state-blocked (AA body).
- リスク: Keyboard focus invisible + AA-borderline alert text on the medication-safety review screen.

## 🌊 WAVES

### Wave 1 [low] Near-invisible token/spacing/heading hygiene — no behavior change, fully parallelizable across clusters

- **text-destructive body-alert → text-state-blocked sweep (AA body floor)** (loc~40, visual=False)
  - 対象: ~25 screens: search, offline-sync, qr-scan, safety-check, consent, mcs, prescriptions table/[id], qr-drafts/[id], schedule-proposals, visit-record-detail, brief, all reports/[id]+share+print, referral-form, partner-cooperation, billing-rules, jobs, settings, notification-settings, service-areas, uat, management-plan/medications/visit-records print
- **State-color bg-fill → border-l + text/icon accent purge (L311-319)** (loc~90, visual=True)
  - 対象: dashboard tiles, patients-board truncation note, card-workspace HOME_OPS tiles, consent revoke-impact panel, mcs/medication-calendar/prescriptions/share alert panels, schedules gantt (SCHEDULE_STATUS_CLASSES), conflicts PLAN_CARD_TONE, billing KPI bars, admin metrics/realtime/performance/jobs panels, requests followup textarea, conferences chips, reports/print hub
- **EmptyState component adoption for inline <p>/dashed-div empties** (loc~160, visual=False)
  - 対象: my-day, patients-board, select-site, safety-check, collaboration, mcs, medication-calendar, medications, prescriptions/intake/qr-drafts, schedules board/emergency/route-compare/proposals, visits-today, facility-packet, evidence, reports list/[id]/share/analytics, handoff, requests, conferences, notifications, billing all, ~12 admin screens
- **Latin all-caps eyebrow removal + per-button height-override (!h-auto/min-h-11/h-8/h-6) cleanup** (loc~50, visual=True)
  - 対象: patients/new+edit, prescriptions/referral/drug-master 'Admin Console' eyebrows; select-mode, select-site, collaboration, medications, residual, prescriptions-workspace, reports list/[id], notifications, conferences, emergency-route, alert-rules, settings override soup
- **font-weight ladder sweep (all-bold → semibold headings / medium body)** (loc~40, visual=True)
  - 対象: collaboration, residual, schedules board/conflicts/route-compare, capture, voice-memo, evidence, handoff, reports list/share, billing partner/candidates, master-editor stubs, operations-insights, master-hub, print hub
- **tabular-nums + right-align on numeric/date columns** (loc~20, visual=True)
  - 対象: prescriptions/[id], route-compare, reports/analytics table, medications/print, visit-records/print
- **8pt-grid spacing snap + radius normalization (rounded-2xl/xl → rounded-lg)** (loc~35, visual=True)
  - 対象: my-day p-2.5, patients-board p-2.5/mt-1.5, mcs px-2.5, master-hub p-3.5/gap-2.5, drug-master px-1, packaging/medications/proposals rounded-2xl, requests rounded-xl
- **focus-visible ring additions on non-workbench raw controls** (loc~30, visual=False)
  - 対象: safety-check ConcernCard, consent radio, mcs/medications selects, prescriptions filter buttons, qr-drafts filters, data-explorer list buttons, incidents record buttons, medication-calendar retry button, visit-record-detail report menu, conferences picker, handoff consult picker
- **Audit + remediate the missed /settings route and reconcile state-file grounding** (loc~20, visual=True)
  - 対象: /settings (OperationalPolicyContent), plus spot-check loading.tsx/error.tsx for the 50+/25+ state files

### Wave 2 [medium] Component unification — converge confirms, loading, and headers onto anchors

- **ConfirmDialog unification for non-safety destructive/irreversible raw Dialog/AlertDialog** (loc~140, visual=True)
  - 対象: offline-sync inline confirm, schedule-proposals (3x AlertDialog), qr-drafts/[id] discard, handoff TransferDialog+resolution, pca-pumps return/cancel, data-explorer field PATCH, tasks bulk-complete (optional), workflow inquiry resolve
  - 依存: safety_critical ConfirmDialog work establishes the pattern
- **Skeleton-for-spinner: replace bare <Loading/> with layout skeletons (L460)** (loc~180, visual=True)
  - 対象: workflow, pharmacy-cooperation, external, qr-scan, card-workspace, patient-edit, prescriptions list-detail/[id]/qr-drafts, collaboration, visit-record-detail+form (手本), facility-packet, evidence, reports/[id]+share+print, notifications, requests, conferences, drug-master/formulary/facility-standards/pharmacist-credentials/institutions Suspense, dispense-audit-stats, analytics animate-pulse, realtime
- **Header SSOT convergence: bespoke <h1> → sr-only h1 + body h2 / WorkflowPageHeader|Intro (L376)** (loc~220, visual=True)
  - 対象: search, select-mode, select-site, offline-sync, patients/compare, card-workspace, safety-check, collaboration, intake-triage, schedules board+conflicts+emergency+route-compare empty-h1, visits-today, brief, facility-packet, reports list/share, notifications, handoff, billing-check, print hub, admin master-hub
- **Native <select> (h-8/32px, no focus ring) → shadcn Select OR min-h-11 + focus-visible** (loc~60, visual=True)
  - 対象: prescriptions filters, prescription-history route/method, mcs selects, admin/settings SettingRow
- **Surface-ladder de-boxing (concentric border → bg-muted elevation step)** (loc~90, visual=True)
  - 対象: dashboard process tiles, patients/compare PreviewBox, card-workspace, medications Card>article, residual li/section, share mixed surfaces, schedule-proposals nested panels, packaging, notification-settings stacked cards, data-explorer, analytics overdue rows, jobs expanded rows, master-editor stubs
- **ErrorState adoption for hand-rolled error/Alert blocks** (loc~80, visual=False)
  - 対象: mcs error box, reports/[id] Alert, share bespoke error h1, conferences detail/notes error, uat 6 query errors, jobs, print pages, management-plan/medications/visit-records print

### Wave 3 [high] Structural restructures — heavy forms, focal hierarchy, raw modals

- **prescriptions/new single-submit + fixed bottom thumb-zone action bar** (loc~40, visual=True)
  - 対象: /prescriptions/new (period-review:68 second submit, intake-form:2960 in-flow submit)
  - 依存: VisitStepActionBar is the existing手本
- **Sticky bottom action bar for long patient/referral authoring forms** (loc~35, visual=True)
  - 対象: /patients/new, /patients/[id]/edit (patient-form.tsx:2399), /referrals/new (:580)
  - 依存: prescriptions/new fixed-bar work
- **AddMedicationDialog raw inset modal → Dialog (focus-trap/Esc/overlay-close)** (loc~25, visual=True)
  - 対象: /patients/[id]/medications (:326-392)
- **card-workspace skeleton + focal header restructure** (loc~35, visual=True)
  - 対象: /patients/[id] (card-workspace.tsx:4190 loading, :4220 three equal links)
- **Patient-card / dense-board focal restructure + primary-anchor dedupe** (loc~50, visual=True)
  - 対象: prescriptions-workspace (新規受付 ×3), prescriptions/[id] all-outline bar, visits-today card double-bold, voice-memo equal buttons, billing/candidates no-primary month-ops, schedule emergency/route-compare two-primary
- **Leave-guard / autosave for long JSON-authoring + draft forms (non-safety)** (loc~90, visual=False)
  - 対象: admin alert-rules, billing-rules, document-templates, settings, incidents, uat, shifts (changeMonth drops draft), brief correction editor, facility-packet memo

## 🔌 BE-without-FE ギャップ (codex の BE知識で要 augment/refute)

> 『バックエンドはあるがフロントエンドがない』。codex: 各項目を repo evidence で確認し、(a) 本当にFE無いか refute、(b) 抜けてる項目を積み増し、(c) BE所有/dead判定。

- **[P1/high] GS1 barcode verification during dispensing (GTIN/expiry/lot → YJ match vs prescribed line; wrong-drug/expired warnings). permission canDispense.**
  - BE: `src/app/api/dispense-tasks/[id]/verify-barcode/route.ts`
  - 欠落FE: No barcode-scan affordance in the dispensing workbench calls this safety check; @zxing is in the stack but no scanner UI invokes it. Wrong-drug/expired-drug verification is server-side but unreachable.
- **[P1/high] Generate/regenerate the set (一包化) day×slot batch matrix from latest intake + audited results (force regen, OCC, narcotic tagging, packaging snapshot). permission canSet.**
  - BE: `src/app/api/set-plans/[id]/generate-batches/route.ts`
  - 欠落FE: No UI action to initially generate or force-regenerate the set calendar; without it a SetPlan has zero SetBatch rows so /set and /set-audit have nothing to populate (workbench loads via GET calendar only).
- **[P1/high] Full CRUD + lifecycle for トレーシングレポート/服薬情報提供書 (pharmacist→physician): list, create, edit, status draft→sent→received→acknowledged with channel (ph_os_share/fax), delete drafts. permission canAuthorReport.**
  - BE: `src/app/api/tracing-reports/route.ts + [id]/route.ts`
  - 欠落FE: No screen to list/author/edit/advance-status/pick-channel/delete tracing reports. Pharmacists only see an auto-linked PDF via the communications flow — the entire authoring+lifecycle surface is missing.
- **[P2/high] Billing-close readiness KPI summary (17 metrics: previsit_blockers, undrafted_reports, close_ready/close_blocked, evidence_insufficient, revision/site-config mismatches, open review tasks). permission canReport.**
  - BE: `src/app/api/billing-evidence/stats/route.ts`
  - 欠落FE: No billing-close readiness dashboard/widget surfaces these operational KPIs; check + analytics screens cover per-month lists but not this consolidated readiness summary.
- **[P2/high] Bulk medication-history (薬歴) PDF export for up to 500 patient_ids (async job, 202). permission canVisit.**
  - BE: `src/app/api/patients/medications/bulk-export/route.ts`
  - 欠落FE: No multi-select 'bulk 薬歴 PDF 一括出力' affordance on the patient board / reports print hub to enqueue and monitor the job (single-patient export IS surfaced).
- **[P2/medium] Rework edit-in-place of a REJECTED dispense result (B5: latest audit must be rejected), version OCC, re-transitions task→completed / cycle→audit_pending, reopens schedules. PATCH permission canDispense.**
  - BE: `src/app/api/dispense-results/[id]/route.ts`
  - 欠落FE: FE only POSTs new results; no UI GET/PATCH of the rejected [id] resource — rework is either silently re-POSTed (making this dead) or the in-place correction is unsurfaced.
- **[P2/high] Admin outbound-webhook management: list redacted registrations + register with event subscriptions returning one-time HMAC secret. permission canAdmin.**
  - BE: `src/app/api/admin/webhooks/route.ts`
  - 欠落FE: Entire feature has no UI — no screen to register/list/rotate webhooks or display the create-time secret.
- **[P2/high] Facility-level contact persons (nurse station / facility staff): GET + PUT. permission canAdmin.**
  - BE: `src/app/api/admin/facilities/[id]/contacts/route.ts`
  - 欠落FE: Facilities page renders generic MasterEditorView; no facility-detail UI to view/edit facility contacts (read and write both unsurfaced). Patient-level contacts exist, facility-level does not.
- **[P3/medium] Append a response/correspondence to an OPEN communication request without resolving it: GET responses + POST.**
  - BE: `src/app/api/communication-requests/[id]/responses/route.ts`
  - 欠落FE: requests-content records replies only via POST /resolve-followup (which closes the item); no UI to reply while keeping the request open.
- **[P3/medium] Self-service security actions: POST sign-out-all-sessions (logout-all) and self-service MFA disable/re-enroll.**
  - BE: `src/app/api/me/logout-all/route.ts + src/app/api/me/mfa/disable/route.ts`
  - 欠落FE: No settings/security affordance to 'log out of all devices' or disable/re-enroll MFA (setup/verify ARE surfaced). MFA-disable may be intentionally gated under mandatory-MFA compliance — confirm.
- **[P3/high] Facility detail panels: GET facility's visit-batches, GET facility's patient roster.**
  - BE: `src/app/api/admin/facilities/[id]/visit-batches/route.ts + [id]/patients/route.ts`
  - 欠落FE: No facility-detail view of its visit batches or resident patient roster (admin/facilities only consumes /units).
- **[P3/high] External-professional detail: GET communication-event history log + GET linked patient list.**
  - BE: `src/app/api/admin/external-professionals/[id]/communications/route.ts + [id]/patients/route.ts`
  - 欠落FE: No per-professional collaboration audit-trail view or linked-patient list (admin screen only calls the list endpoint).
- **[P3/high] Conference participant smart suggestions (recency/frequency ranking). authenticated.**
  - BE: `src/app/api/conference-notes/participant-suggestions/route.ts`
  - 欠落FE: Conference participant autocomplete is wired to the raw external-professionals list instead; the suggestion-ranking capability is unused.
- **[P3/medium] Manual re-extraction of handoff items from an edited visit-record SOAP (processHandoffExtraction). permission canVisit.**
  - BE: `src/app/api/visit-records/[id]/handoff/extract/route.ts`
  - 欠落FE: No UI to re-run handoff extraction after SOAP is edited post-creation; extraction only auto-fires at record-create. Lower impact (auto-extract + manual handoff editing already exist).
- **[P3/medium] Set-audit history listing (GET) and legacy DispenseTask queue (GET).**
  - BE: `src/app/api/set-audits/route.ts (GET) + src/app/api/dispense-queue/route.ts`
  - 欠落FE: set-audits GET history is unsurfaced (only POST create is wired). dispense-queue appears legacy/superseded by /api/dispense-workbench/patients — likely dead capability, confirm before any FE work.

- **[P2/high] (Claude追加 BWF-1) dispensing-stats 新フィールド `prescriptionRegisteredWithoutDispenseTasks`**
  - BE: `src/app/api/dashboard/dispensing-stats/route.ts` (2026-06-28 codex slice, APPROVED)
  - 欠落FE: 描画ゼロ。codex想定配置=statistics headline か dashboard cockpit の condition/blocked-reasons にデータ整合アラート『処方登録済みだが調剤タスク未生成』+triageリンク。success/volume KPIに混ぜない。

## ❓ OPEN QUESTIONS (壁打ちで closeする — 多くは codex/SSOT/人間裁定が必要)

1. Workbench sub-12px type (9.5–11.5px on /dispense /audit /set /set-audit) and state-color bg-fills (粉砕 badge white-on-state-blocked at 9.5px, NG button bg) — are these accepted SSOT exceptions for the protected レセコン chrome, or in-scope AA fixes? L54 protects workbench VISUALS; need an explicit ruling on whether AA-contrast/legibility overrides visual protection for the type-size and the white-on-state-blocked badge specifically.
2. Workbench confirm-gating + focus-visible rings are flagged ssot_decision because they touch protected screens. Confirm: adding a ConfirmDialog overlay and focus rings is a behavior/a11y change, NOT a visual chrome restyle, and is therefore permitted under L54 — please ratify so safety_critical can ship.
3. BE ownership / sequencing for the 3 P1 BE-without-FE gaps: verify-barcode (scanner UI in workbench), generate-batches (set-calendar generation trigger — without it the set workbench is empty), and tracing-reports CRUD. Are these codex-owned FE-enablement tasks, or do they need a joint FE/BE mini-spec first? generate-batches is a functional blocker, not polish.
4. Is /api/dispense-queue actually dead (superseded by /api/dispense-workbench/patients) and safe to deprecate, or does it back a legacy path we must keep? Same question for dispense-results/[id] PATCH rework — is rework done by re-POST (endpoint dead) or genuinely unsurfaced?
5. master-editor-view stubs (admin staff/facilities/vehicles/external-professionals) are BE-unconnected dead-FE with no-op saves. Is BE wiring in codex's queue, or do we ship the FE weight/surface fixes now and leave them visually-correct-but-inert? They share one file so FE fixes are cheap but won't make them functional.
6. MFA-disable + logout-all having no UI: intentional under mandatory-MFA / compliance posture, or a genuine missing security-settings surface? Affects whether /settings gets a security section.
7. Header convergence scope: should immersive/print screens (capture, the 5 print routes with intentional double-h1 toolbar+body) be exempted from the sr-only-h1+body-h2 rule, and should print routes get a dedicated print-media a11y rubric (touch-44px etc. don't apply)?
8. State-dimension grounding gap: audits read page.tsx but loading/empty/error live in 50+ loading.tsx / 25+ error.tsx files. Do we need a dedicated state-file audit pass before trusting Wave-1/2 state-handling claims, or fold spot-checks into Wave 1?
9. Is the dashboard timeline fix 'bg-primary text-primary-foreground' acceptable, or does using primary (deep navy) on a timeline block conflict with the primary-action color reservation? Need a token decision for the replacement.
10. schedule-proposals confirm-chaos (3 raw AlertDialog + Sheet) — does the irreversible 確定/route_order commit warrant requiredConfirmText, or is single-confirm sufficient given it's reversible until commit?

## 📐 SSOT追加提案 (docs/ui-ux-design-guidelines.md へ。PROMOTION_QUEUE §13 gate)

- 状態色 bg-fill 禁止の適用範囲を明文化: ガント／進捗バー／アラートパネル／ステータスタイルへの bg-state-_/10 全面塗りは不可。例外は rounded-full の小バッジのみ（既存 L311-319 に screen 列挙を追記）。装飾バーは bg-chart-_/bg-primary を使う。
- 本文アラートテキストは text-state-blocked を使う。text-destructive は短い required-\* マーカー等の非本文に限定（AA 境界のため）。全 cluster 横断ルールとして昇格。
- 可視 <h1> 直置き禁止を再強調し、例外を明記: immersive 撮影画面 (capture) と print ルート（toolbar h1 + document body h1 の二重）は DOM 上 single-h1 を保てば可。それ以外は sr-only h1 + body h2 / WorkflowPageHeader|Intro / AdminPageHeader を必須化。
- 不可逆サインオフ（調剤完了/監査承認/セット監査承認/月次締め/同意取消/退職/draft確定）は ConfirmDialog 必須、麻薬計数・退職・同意取消は requiredConfirmText 二重確認必須。raw Dialog/AlertDialog による破壊確認は禁止（ConfirmDialog が唯一の正本）。
- ローディングは Skeleton（レイアウト形状保持）必須、bare <Loading/>/spinner/inline 読み込み中テキストは不可（L460 既存ルールに違反画面リストを台帳化）。空表示は EmptyState、エラーは ErrorState を必須コンポーネント化。
- ラベル最小 12px(text-xs) を全画面床として明記。print:text-[Npx] は print 専用 override のみ許可。ワークベンチ chrome の例外可否は別途裁定（open_questions 参照）。
- Button の高さは size variant に委ね、!h-auto/min-h-11/h-8/h-6 等の個別 height override を禁止（Button touch-target contract を SSOT 化）。native <select> は 44px 確保 + focus-visible 必須、可能なら shadcn Select。
- focus-visible リングを全インタラクティブ要素に必須化（raw <button>/<select>/<input>/checkbox 含む）。キーボード操作画面（特にワークベンチ）で focus 可視は WCAG 2.4.7 AA 必須。
- 長尺オーサリングフォーム（処方/患者/紹介/JSON 設定/下書き編集）は useUnsavedChangesGuard 必須、可能なら autosave。主送信は単一 primary を fixed VisitStepActionBar に配置（thumb-zone 一貫配置）。
- Latin all-caps eyebrow（'Admin Console'/'Patient Intake' 等）は calm-medical トーンに反するため不可。JP ラベルまたは削除。

## ✅ /settings 監査 closure (対象画面漏れ 1件を Claude が後追い監査)

- route: `/settings` → operational-policy-content.tsx (843行)。**overall B**。
- **dim4 状態=A(良)**: PolicySkeleton(L475-485, aria-label付) + ErrorState(L9,607) を正しく実装。※ page.tsx Suspense fallback は bare `<Loading/>`(RSC) だが content は Skeleton。→ **Skeleton主張は画面ごとに client-spinner か RSC-fallback か要判別の実例**。
- 逸脱(既存Wave項目へ追記のみ、新規不要):
  - dim1: L586 `<h1 class="text-xl font-bold">設定</h1>` bespoke 可視h1 → Wave2 header convergence 対象に追加
  - dim5: font-bold 乱用(L218/247/280/300/317/373/377/413/433) → Wave1 font-weight ladder
  - dim6: L458 `text-[11px]` sub-12px → Wave1 floor raise
  - dim7: L789 `bg-state-confirm/10` panel-fill(L594はrounded-full badge=例外OK) → Wave1 state-fill purge
  - dim8: raw `<button>`×2, focus-visible×0 → Wave1 focus-visible 追加
- **結論: 110→111画面 カバレッジ完了。/settings は新規リスクを生まず既存Waveに吸収。**

---

# 🔁 SELF-REVIEW 補正適用版 (v2) — ultracode 忖度なし自己レビュー結果

> 2026-06-28 Claude ultracode自己レビュー(33agent, refute-by-default/file:lineアンカー/三値/severity anchor/pre-mortem/YAGNI) + codex独立verdict(cross-family) を統合。**v1の過大主張・誤検知を自己摘発して補正。**

## 信頼度 / tally

- 中〜高。安全スパイン(S0)とBE orphan在庫(B0-B14)は高信頼でship可。S0は独立再現(dispense-workbench配下にConfirmDialog/AlertDialog/window.confirm 0件、completeDispense/completeAudit/setAudit が:1033/1060/1086でmutate直叩き)。S6矛盾も実証(visit=bg-chart-2 vs desk=bg-primary :288/289、提案fixは同色衝突)。S1のAA前提はglobals.css:275がoutline-ring/50=色のみ・outline:none不在→UA focus残存で反証。低信頼領域は状態系UI(EmptyState/Skeleton)のgrounding——page.tsx起点監査がloading.tsx/error.tsx/\*-content.tsxの二層を取りこぼし、EmptyState誤検知率~22%(notifications/mcs採用済)、Skeleton 4/9がRSC既カバー。Claude自己レビュー4件とcodex独立verdictは安全コア・BE P1・状態系ゲートで広範に一致しており、roadmap骨子の信頼度自体は高い。
- tally: SAFETY(9): CONFIRMED 6(S0/S3/S4/S6/S7/S8部分)・REFUTED 3(S1/S2/S5)。ただしseverity要補正がS4/S6/S7/S8/S3に集中(critical→major/minor)。BE-without-FE(15): CONFIRMED-NO-FE 13(B0/B1/B3/B5/B6/B7/B8/B9/B10/B11/B12/B13/B14)・PARTIAL-FE 2(B2/B4)。UNVERIFIED 0(全件file:line突合済)。WAVE: Wave1 9項=PATTERN-REAL/PARTIAL混在(状態系誤検知率EmptyState~22%/Skeleton~44%RSC既カバー/ErrorState 0%)、Wave2 6項=同様、Wave3 6項=構造系PATTERN-REAL中心。P1の真偽: S0=CONFIRMED-blocker、B1 generate-batches=CONFIRMED functional-blocker(set空)、B0 verify-barcode=CONFIRMED orphan、B2=P1降格(PARTIAL-FE)。

## ⛔ REFUTED / DEMOTED (v1から落とす/降格)

- S1: REFUTED(severity overstated)——focus invisible/WCAG2.4.7 AA failは反証(globals.css:275 outline-ring/50色のみ・outline:none不在でUA focus残存、spot-check実証)。残核は明示ringのnit級ハードニング。set/set-audit anchorはdivセル誤り
- S2: REFUTED as safety-critical——F11/F12 hijack実在だがoperability/minor。module.css:7保護不変宣言の意図的レセコン設計、PHI/不可逆mutation無関係
- S5: REFUTED——4箇所全て確認フロー既存(shifts/billing-rules ConfirmDialog済、users reason必須+reactivate可逆)。残核はusers/pharmacy-sites raw Dialog統一のnit
- S8: REFUTED(core)——不可逆無確認/focus欠落/F-key hijackは全て不成立(resolve ConfirmDialog済:559、barcode/F-key不在、UA focus可視)。有効は色依存criticalのminor 1点のみ
- S6 chart-token-as-state-misuse サブ主張: DEMOTE to nit——timeline visit/desk/breakはcategorical kind、SSOT:307は--chart-\*をseries/categorical用途に予約ゆえchart-2 for categoryはdefensible。実体はtoken-family不整合(hardcoded text-white非適応)。AA-contrast本体はdark-mode限定CONFIRMED
- S7: DEMOTE safety_critical→minor——sub-12px実在だがWCAG非該当(最小font未規定)、根拠はSSOT 12px floorのみ。/reports例はprint経路で'screen'表題と矛盾し対象外
- S3: DEMOTE critical→strong-major——財務compliance(月次締め)であり臨床患者安全/PHI漏洩でない。付随F-key/focus/AA主張は本箇所未実証で削除
- S4: DEMOTE safety_critical/critical→major(leave-guard)+minor(confirm)——確定はintake/cycle登録でclinical irreversible sign-offでない。'autosave'はrepo非正規ゆえdrop
- B2: DEMOTE P1→PARTIAL-FE/P2-P3(要codex確定)——tracing-reportsはvisit-record起票+communications/requests到達可能で機能ブロック無し、欠落は専用CRUD UIのみ
- B5: DEMOTE P2→low/nit——rework capabilityはPOST upsert+completeDispenseで露出済、PATCH[id]は冗長granular orphan、feature blockerでない
- UI_AUDIT U-3(error/permission境界薄『error.tsx 5箇所+root』): REFUTED(stale)——live treeでerror.tsx 21+箇所。open所見から撤回/再定義
- Wave1 'text-destructive AA body floor違反'(S8+~25画面sweep根拠): REFUTED as AA claim——red-600≈4.8:t white背景でPASS、semantic-consistency変更へ降格
- Wave2 Skeleton blind-replace(workflow/notifications/conferences/realtime): REFUTED as over-broad——loading.tsxにSkeleton既存でno-op。残client spinnerのみ有効
- Wave1 EmptyState adoption(notifications/mcs): FALSE-POSITIVE——両者EmptyState/ErrorState採用済(notifications:9/252、mcs:23/614/837)。L20自己検証'誤検知でない'はnotificationsで破綻
- Wave2 offline-sync-content/data-explorer 'raw dialog unification'ターゲット: FALSE(mis-scoped)——offline-syncはinline div confirm、data-explorerはconfirm皆無=net-new confirm追加であってunificationでない
- settings page.tsx 'client-spinner置換'主張: FALSE-POSITIVE——Suspense fallbackはbare Loading(RSC)だがcontentはPolicySkeleton ship済

## ✂ YAGNI DROP (過剰提案・use-error citation無し)

- Wave1 font-weight ladder sweep(~40loc): SSOTにfont-bold禁止規定なし、nit級stylistic。共通workflow-page-header/print-layout触ると横断回帰。defer
- Wave1 Latin all-caps eyebrow除去(~50loc): AdminPageHeader既定1コンポーネント+1ページに集約、per-screen soupでない。コンポーネントレベル1点修正で足り、sweep化は過剰。data-table/workflow列eyebrowは意図的ゆえ対象外
- Wave1 8pt-grid snap+radius normalization rounded-2xl/xl→rounded-lg(~35loc): bulkがcard.tsx/dialog.tsx/page-section.tsx/loading.tsx共通primitiveに在り、blind置換でglobal surface radius回帰+skeleton↔content形状不一致。共通UIは意図的token変更へ、per-screen rounded-2xlのみに限定(p-2.5/p-3.5 off-grid snapは有効)
- Wave1 surface de-boxing: 主観的visual、use-error citation無し。protected workbench非接触条件付きでlisted surfaceのみ
- Wave3 desktop sticky bottom action bar(patients/new+referrals/new): thumb-zoneはSSOT L260-273で在宅訪問中・屋外片手のmobile-field規則、desktop authoring formは対象外。use-error citation無し。defer
- Wave3 card-workspace/patient-card 'focal header restructure'/'three equal links': use-error citation無しの主観restructure。AddMedicationDialog focus-trap・shifts draft-drop guard・prescriptions/new double-submitの具体バグのみkeep
- SSOT additions ~5条(L189/191/193/194/195)の再記述: 既批准ルール(L311-319/376/460/323/Button契約)のchurn。'違反画面台帳'へ畳みdocument追加はdrop
- prescriptions-workspace '新規受付×3 primary'サブターゲット: variant=default実出現1件(:266)でnear-false-positive、過大主張ゆえdrop
- S8/S5/S2のbundle済サブ主張(focus追加/ConfirmDialog追加/F-key対処): 対象コード不在の空振り。冗長二重確認は回帰ゆえdrop

## ⚠ RISK FLAGS (盲目適用での回帰/制約違反)

- [HIGH/HIGH] text-destructive→state-blocked blind sweep(~40loc): --destructive=red-600≈4.8:1でAA PASS済のtextを再着色し、state-blocked/10赤背景上ではcontrast低下の恐れ。回避=find/replace禁止、per-location測定ゲート、body-alertラベル限定scope
- [HIGH/HIGH] S0/S1 workbench編集がSSOT保護レセコンchrome(guidelines L54、module.css:5-7操作体系不変)に侵入。confirm/focus patchがinline style/F1-F12固定レイアウトを暗黙破壊。回避=OQ2先ratify、golden-image前後比較、onPrimary/onBulkはribbon/grid非接触のままconfirm await
- [HIGH/HIGH] S6 visit→bg-primary置換はdesk=bg-primary(:289)と同色衝突しタイムライン状態識別消失。spot-check実証済。回避=ship禁止、検証済non-chart/non-primaryトークンへ差替+OQ9裁定
- [MED/HIGH] state-color bg-fill purge(~90loc): bg-state-\*/10が唯一の状態signalの画面でfill除去のみ実施すると色情報喪失。SSOT:316許可のrounded-fullバッジまで剥がす過剰sweep。回避='fill除去ANDborder-l+label追加'を1コミット原子化、rounded-fillピル保全
- [MED/HIGH] height-override cleanup(min-h-11/h-8一律除去)がButton touch-target variant契約を破りraw要素の唯一の44px保証を剥がしsub-44px再導入。回避=per-instanceでButton/raw判別、coarse-pointer 44px後検証
- [MED/HIGH] 麻薬requiredConfirmTextが高頻度F12キーフローにtyping friction追加→operatorがroute around。回避=麻薬lineのみscope、非麻薬は単一confirm、F-keyフローusability-test
- [MED/HIGH] 大規模並列visual diff(Wave1~480loc)がcodex review帯域を超えrubber-stamp回帰。回避=per-PR loc上限、cluster-scopedコミット、screenshot diff添付
- [MED/MED] grounding drift: roadmapがpage.tsx読みで状態がloading.tsx/error.tsxに分散。Wave1/2状態主張が誤ファイル狙い。回避=state-fileパス先行(ゲートB)
- [MED/MED] S2 preventDefault scope化がF12次工程ショートカット自体を無効化する恐れ。回避=listenerをworkbench focusにscope(fkey削除でなく)、surface内F12機能維持
- [LOW/HIGH] generate-batches functional blocker(B1)をcosmetic waveに埋没させると/set+/set-auditがinert据置。spot-check実証(consumer 0/mutation hub欠落)。回避=functional BE-enablement(generate-batches/verify-barcode/tracing-reports)を別トラックでcosmetic前出し

## 🛠 CORRECTIONS (各主張の具体補正)

- **S1**: severity critical→minor(nit)へ較正。'keyboard focus invisible/WCAG2.4.7 AA fail'は反証(globals.css:275 outline-ring/50=色のみ、outline:none不在でUA focus残存)。set/set-audit anchor :794/:818はdivセル誤りで実制御行(select:510/input:535,558,874,923,962,972/button:151,169,666)へ差替。明示focus-visibleリング追加はハードニングとして安全だが'バグ修正'と売らない
- **S2**: safety-critical→minor(operability)へ再分類。F11/F12 hijackは実在(use-workbench-view.ts:1115-1116登録fkey+dispensing-workbench.tsx:286 window-level preventDefault)だがPHI/不可逆mutationなし。module.css:7で保護不変宣言された意図的レセコン設計。unbindはdocs/decisions級裁定要、'sign-off無確認'はS0へ分離
- **S3**: critical/safety_critical→strong-major。月次締めclose(:995 closeMutation.mutate直叩き、ConfirmDialog 0件)は不可逆+外部PHI送信(二重送信risk)だが臨床患者安全でなく財務compliance。fix=既存ConfirmDialog(requiredConfirmText推奨)でラップ。付随F-key/focus/AA主張は本箇所未実証→削除。確定/除外(:694-721)は可逆ゆえconfirm不要
- **S4**: safety_critical/critical→major(leave-guard)+minor(確定confirm)へ分割較正。core(QR draft editorがuseUnsavedChangesGuard不採用、:259 formState、兄弟4 editorは採用)はCONFIRMED。fix=prescription-intake-form.tsx:530をミラーしallowNavigation()追加。'autosave'はrepo非正規パターンゆえbundleしない(leave-guardが正)。本ページのfocus/AA/F-keyサブ主張は非該当
- **S6**: critical→major(dark-mode限定AA)。light=4.6:1 PASS/dark=~3.1:1 FAILと明記。提案fix 'bg-primary'はdesk=bg-primary(:289)と同色衝突しvisit/desk識別消失→ship禁止。検証済AA≥4.5:1のnon-chart/non-primary stateトークンへ差替、OQ9先決。根本=hardcoded text-white非適応。--chart-2 globalは触らない(他5箇所chart用途回帰)。'chart-token-as-state misuse'はnit級に降格
- **S7**: safety_critical→minor(nit寄り)。sub-12px badge(prescription-inline-detail.tsx:280/284/320/333/338=9px、qr-drafts:236/245=10px)はSSOT 12px floor(:323/:452)逸脱で根拠はWCAGでなくSSOT一本化。'不可逆無確認/focus/AA/F-key'テンプレ混入削除。/reports例はprint経路で表題'screen'と矛盾→除外。fix=text-xsへ、共通Badge部品で底上げ推奨
- **S8**: critical→minor。core主張(不可逆無確認/focus欠落/F-key)は全てREFUTED(resolveはConfirmDialog済:559、barcode/F-key不在、UA focus可視)。唯一有効=ConcernCard:122-126のcritical表示がtext-destructive赤のみ依存(色依存回避違反)→AlertTriangle+sr-only'重大'併記。ConfirmDialog/focus/F-key追加は対象不在ゆえ不要(冗長二重確認は回帰)
- **S5**: safety_critical→nit(consistency)。4箇所全てに確認フロー既存(shifts/billing-rules済、users/pharmacy-sitesはreason必須+reactivate可逆)。修正範囲はusers-content.tsx:1258/pharmacy-sites-content.tsx:885のraw Dialog→ConfirmDialog統一のみ。requiredConfirmTextは可逆操作ゆえ付与しない。shifts/billing-rules変更不要
- **B2**: P1→P2/P3へ降格(要codex確定)。tracing-reports CRUD実在だがvisit-record提出で起票+communications/requestsで一覧/状態遷移/PDF到達可能=機能ブロック無し。欠落は専用CRUD UIのみ。navigation.ts:57 /reports#tracing-reportsはデッドリンク(専用一覧不在の傍証)。codexはP1列挙ゆえ最終往復で確定
- **B4**: 主張をreword: 'enqueue affordance欠落, monitoring一部有'。bulk-export起票UIはゼロだがadmin/jobs/jobs-dashboard-content.tsxにrun結果monitoring存在ゆえPARTIAL-FE。P2維持
- **B5**: P2だが実害low/nit。rework capability自体はPOST collection upsert(route.ts:628-633)+completeDispenseで露出済、PATCH[id]は冗長granular orphan。feature blockerとして扱わない
- **B14-dispense-queue**: 単なる未消費でなくsuperseded-legacy(dispense-workbench/patients route.ts:14が明記)。DEAD-BE性格・safe-delete不可・新FE不要。set-auditsはPOST活線でorphanはGETメソッドのみ
- **Wave1-statecolor-sweep**: text-destructive→state-blocked sweepは①L190ルールが未批准proposal、②--destructive=red-600≈4.8:1 white背景でAA PASS——'AA body floor違反'はfalse、semantic-consistency変更へ較正。body-alertラベル限定にscope、error-state/form-error-summary/alert.tsxのrequired-marker用途は除外。state-blocked/10赤背景上はper-location測定
- **Wave1-bgfill-purge**: 置換先を明文分岐: ガント/KPI等'面で占有・量encode'する装飾バー=bg-chart-\*/bg-primary(SSOT:189)、'状態つき確認タイル'=border-l+text。SSOT:316許可のrounded-full小バッジ(schedule-team-board.tsx:667/1049、settings:594)は保全、fill除去とborder-l+label追加を1コミット原子化(色情報喪失防止)
- **Wave1-EmptyState**: 着手前に各ターゲットをEmptyState import+実描画パスで個別re-grep必須。notifications(:9/252採用済=hard FP)・mcs(:23/614/837採用済=stale FP)を除外。L20自己検証'誤検知でない'は破綻ゆえ信用不可
- **Wave1-height-override**: min-h-11/h-8除去はper-instanceで'shadcn Button(variantが44px-coarse担保)か raw要素(min-h-11が唯一の44px保証)か'判別。raw要素から剥がすとtouch-target退行。eyebrow除去はAdminPageHeaderコンポーネント既定レベルで(per-screen soupでない)、data-table/workflow列eyebrowのuppercaseは意図的ゆえ保全
- **Wave2-Skeleton**: 各行に'RSC既カバー(loading.tsx Skeleton)or client-spinner残'を明記してから着手。workflow/notifications/conferences/admin-realtimeはloading.tsx Skeleton済→blind置換no-op。対象化は残client spinner(realtime:276/conferences:40/mcs:612,933/external:36)のみ。a11y(role=status/sr-only/motion-reduce)保全
- **Wave2-header-convergence**: WorkflowPageHeader descriptionはHelpPopover(既定非表示)行きゆえload-bearing本文を移さない(HelpPopover Trap memo)。workspace型トップ(sr-only h1)とハブ型(可視h1)のマッピング表をWave2前に付す。print/immersive除外
- **SSOT-additions**: 📐L188-198の~5条(bg-fill ban/visible-h1 ban/Skeleton-required/12px floor/Button-height-by-variant)は既批准ルールの再記述=churn。'既存ルール下の違反画面enumeration台帳'へ畳む。真に追加的なのはConfirmDialog-irreversible列挙/body-alert-text-state-blocked(AA証明保留)/Latin-eyebrow-banのみ

## 🚪 実装ゲート + verdict

補正適用後にWave1着手可。ただし2つのゲートを先に通すこと。【ゲートA: 安全コア先行】S0(blocker)・S3・S4・B1 generate-batchesはcosmetic waveから分離した安全/機能トラックとして最優先で着手。S0はOQ2(confirm overlay+focus ring=behavior/a11yであり保護レセコンchrome restyleでない)をratifyしてから、楽観更新前段挿入+autofocus確定で実装、workbenchのgolden-image snapshot前後比較必須。【ゲートB: state-file監査】Wave1/2の状態系(EmptyState/Skeleton/ErrorState)はloading.tsx/error.tsx/\*-content.txを一次ソースに再grounding する専用パスを通すまでblind sweep禁止(EmptyState誤検知~22%実証済)。この2ゲート通過後、Wave1のcosmetic sweepはYAGNI削減(下記drop)+per-instance scope補正を施して着手。S6 fixは現状proposalではship不可(desk同色衝突)——トークン裁定(OQ9)を別途解決。codexと安全コア・BE P1・state-fileゲートで合意済みゆえ、補正リスト適用を条件にroadmap骨子は実装可。

## 🔴 残課題 (codex最終往復で確定)

- B2 tracing-reports severity: codex(P1)とClaude自己レビュー(nit〜P3、隣接フロー到達可能)が不一致。専用CRUD/list UI不在の実害がP1かP3か、codex最終往復で確定要(self-consistency不可)
- 状態系grounding: Wave1/2の全EmptyState/Skeleton/ErrorState locはUNVERIFIED推定として扱う。loading.tsx(60+)/error.tsx(21)/\*-content.txを一次ソースにした専用state-file監査パスをWave1着手前にゲート化。EmptyState誤検知~22%・Skeleton~44%RSC既カバーが定量化済
- カバレッジ穴: UI_AUDITは運用ハブ~6画面のみ深掘り、(dashboard)111画面中~100(admin~40/patients[id]サブ/billing/薄ラッパー~70 \*-content.tsx)とprint 5ルートが未監査。U-3(error.tsx 5箇所)はlive tree(21+箇所)でstale→撤回/再定義要。Wave1前にsrc/app/(dashboard)からroute list再生成し111 registryとdiff
- S0 fix設計の未確定: confirm挿入は楽観更新(primary(phase)/applyCell)より前段、確定ボタンautofocus+Enter確定/EscapeキャンセルでF12高速運用維持、麻薬は独立double-confirm。requiredConfirmTextは麻薬lineのみscope(非麻薬は単一confirm)でF12 muscle-memory回帰を回避——OQ2(a11y/behaviorは保護chrome restyleでないか)ratify先決
- S6/OQ9のトークン裁定: visit用の検証済AA≥4.5:1なnon-chart/non-primary stateトークンを未選定。S1のfocus-visibleリングは保護chromeへの視覚追加ゆえOQ1/OQ2 ratify前はship不可
- master-editor stubs(staff/facilities/vehicles/external-prof)=no-op save inert FE。視覚cleanupだけでは不十分→API配線 or intentionally-disabled/read-onlyラベルの方針裁定が必要(B7/B10/B11と関連)

---

# ✅ 壁打ち収束 (ZERO-GAP, 2026-06-28)

Claude ultracode自己レビュー × codex独立verdict(ROUND2 + FINAL SIGN-OFF)で全点合意:

- B2=P2確定 / GateA・GateB合意 / YAGNI drop合意 / OQ1・OQ2 ratify
- **S0は confirm gating のみで進行**(focus-ring は UA focus存在ゆえ非S0/nit、束ねない)
- ConfirmDialog overlay=patient-safety gating(chrome restyleでない、protected layout不変+golden-image前後比較条件)
- 実装順: GateA(S0 + generate-batches) → GateB(state-file監査) → Wave1(YAGNI削減+per-instance scope) → Wave2/3
  「No additional blockers from Codex」。user directive(疑問点/計画漏れ/手順抜け/対象画面漏れ/BE-without-FE をゼロに)達成。
