# GateB: state-file 監査パス（再 grounding 台帳）

> **目的**: SYSTEM_UI_AUDIT_ROADMAP.md の Wave1/2 状態系（EmptyState / Skeleton / ErrorState）主張は
> `page.tsx` を一次ソースに grounding されていたが、状態系 UI は `loading.tsx`(60) / `error.tsx`(22) /
> `*-content.tsx`(71) に分散する。本台帳はそれら state-file を一次ソースに各主張を再 grounding し、
> **REAL（実 target・file:line）/ FALSE_POSITIVE（既カバー・触ると退行）/ PARTIAL / N/A** に分類する。
> **Wave1 の状態系 sweep は本台帳の REAL 行のみを対象とし、DO-NOT-TOUCH 行に触れてはならない（blind sweep 禁止）。**
>
> 監査: 2026-06-28、3並列 read-only エージェント（Claude）。各次元は実ソース file:line で突合。

## 方法論的補正（page.tsx grounding が取りこぼした構造）

1. **`DataTable` が `EmptyState` と `SkeletonRows` を内蔵**（`src/components/ui/data-table.tsx:522,537,612`）。
   → DataTable 駆動の一覧は EmptyState/Skeleton 済み。page.tsx 起点監査はこれを誤検知していた（EmptyState FP の主因）。
2. **route-level `loading.tsx`(60) は PCA spinner と1件の非正規 shell を除き実質 Skeleton カバー**（codex 独立census 補正）。
   非 Skeleton-直マッチは3件: `admin/pca-pumps/loading.tsx`=`<Loading/>` true spinner（唯一の真 spinner）、`patients/loading.tsx`=PatientBoardLoadingShell 経由で Skeleton/SkeletonRows（実カバー・FP）、`schedules/proposals/loading.tsx`=独自 animate-pulse bg-muted（skeleton 様・spinner でない、Wave1 blocker でない／canonical 化は後日任意）。
   → RSC ナビ fallback はほぼ全画面 Skeleton 済み。実 target は client refetch 層（`*-content.tsx` の `if(isLoading) return <Loading/>` / "読み込み中" text）と一部の inner `<Suspense fallback={<Loading/>}>`。
3. **route-level `error.tsx` の 22/22 が `ErrorState`**（全て `createRouteErrorBoundary(tag)` の一行）。
   → route-level error 境界は 100% 採用済み・sweep 対象外。実 target は `*-content.tsx` の query 失敗時 hand-rolled error markup のみ。

---

## Dimension 1: EmptyState adoption（再 grounded）

- Canonical: `src/components/ui/empty-state.tsx` → `EmptyState({icon,title,description?,guidance?,action?,headingLevel=3})`。dashed-border `role="status"` カード。`DataTable` が内蔵描画。
- 集計: **REAL=17 / FALSE_POSITIVE=8 / PARTIAL=3 / N/A=1**（29行）。**観測 FP 率 ≈ 31%**（roadmap の ~22% を上回る）。
- 補正 loc: roadmap ~160 は過大。実 inline empty ≈ 37 sites / 20 screens → **実質 ~90–120 loc**。

### REAL target（sweep が触るべき file:line）
1. `select-site/select-site-content.tsx:105`
2. `patients/[id]/safety-check/safety-check-content.tsx:516`
3. `patients/[id]/collaboration/collaboration-content.tsx:159`
4. `patients/[id]/medication-calendar/medication-calendar-content.tsx:357`
5. `patients/[id]/medications/medications-content.tsx:942,1083,1183,1277`（PARTIAL: 一部 DataTable）
6. `prescriptions/intake/intake-triage-content.tsx:457`
7. `schedules/schedule-team-board.tsx:645,729,1103`
8. `schedules/emergency-route/emergency-route-content.tsx:344`
9. `schedules/route-compare/route-compare-content.tsx:498`
10. `schedules/proposals/schedule-proposals-content.tsx:1716,1822,2079`
11. `visits/visits-today.tsx:367`
12. `visits/[id]/facility-packet/facility-packet-content.tsx:93`
13. `visits/evidence/evidence-gallery-content.tsx:218`
14. `reports/report-share-workspace.tsx:143,278,300,347,457`
15. `reports/[id]/share/interprofessional-share-content.tsx:253`
16. `reports/report-delivery-dashboard.tsx:325`（PARTIAL: dashed-div のみ。DataTable emptyMessage は残す）
17. `handoff/handoff-workspace.tsx:669,1163,1491`
18. `communications/requests/requests-content.tsx:298,314`
19. `conferences/conferences-content.tsx:1276,1446,1557`
20. `billing/billing-check-content.tsx:322`（PARTIAL: inline `<p>` のみ。DataTable lists は残す）

### DO-NOT-TOUCH（既カバー・触ると退行）
- 直接 `<EmptyState>`: `mcs-content.tsx(:614,837)`, `notifications-content.tsx(:252)`, `prescriptions-table.tsx(:138)`, `partner-cooperation-billing-content.tsx(:558,903)`
- DataTable 内蔵 EmptyState: `qr-drafts/page.tsx`, `billing-candidates-content.tsx`, admin DataTable 群（institutions/drug-masters/users/pca-pumps/facility-standards/inventory-forecast/pharmacist-credentials/analytics）
- 共有コンポーネント経由: `my-day-content.tsx`(MyDayEmptyAction), `patients-board.tsx`（inline empty 無し）

---

## Dimension 2: Skeleton-for-spinner（再 grounded）

- Canonical: `src/components/ui/loading.tsx` → `Skeleton`(animate-pulse rounded bg-muted) / `SkeletonRows` / `Loading`(中央 `<Spinner size=lg>`=真の spinner) / `Spinner`。`DataTable` は `SkeletonRows` を内蔵。
- 集計: **REAL=9 screens(13 sites) / FALSE_POSITIVE=13 / PARTIAL=5 / N/A=3**。**screen-level FP ≈ 48%**（roadmap の "~4/9" を上回る広範な既カバー）。
- 補正 loc: ~13 REAL + ~7 PARTIAL = ~20 conversion sites ≈ **~120–180 loc**。ただし **`*-content.tsx` の client branch と一部 inner `<Suspense>` fallback に費やす（route `page.tsx` ではない）。13 screens は完全に除外。**

### REAL target（client-spinner、sweep が触るべき）
1. `external/external-viewer-content.tsx:206,269,343`（bare text ×3）
2. `prescriptions/qr-drafts/[id]/page.tsx:409`（`<Loading/>`）
3. `visits/[id]/visit-record-detail.tsx:560`（bare text）
4. `visits/[id]/record/visit-record-form.tsx:1501`（bare text）
5. `visits/evidence/evidence-gallery-content.tsx:204`（bare text）
6. `reports/[id]/share/interprofessional-share-content.tsx:220`（`<Loading/>`）
7. `communications/requests/requests-content.tsx:300,312`（bare text ×2）
8. `admin/dispense-audit-stats/page.tsx:84`（`<Loading/>`）
9. `reports/analytics/page.tsx:31`（inner Suspense `<Loading/>`）

### PARTIAL（route は Skeleton 済み。完全性を追うなら client/inner-Suspense fallback のみ）
`card-workspace.tsx:1320,4190` / `patient-edit-content.tsx:175` / `prescriptions/[id]/page.tsx:18` / `reports/[id]/page.tsx:651` / `notifications-content.tsx:190` + `notifications/page.tsx:22` / `conferences/page.tsx:40` + `conferences-content.tsx:1308`

### DO-NOT-TOUCH（既 Skeleton／hard FP）
- content が既に Skeleton 描画: **`collaboration-content.tsx:133`（CollaborationSkeleton）**, **`facility-packet-content.tsx:67-71`**（← roadmap が "valid target" とした2件は誤り）, `workflow-dashboard-view.tsx:171`, `pharmacy-cooperation-workflow-content.tsx:3052`, `analytics-content.tsx`（inline animate-pulse 既存）
- route Skeleton / DataTable: prescriptions-list, qr-drafts-list, reports-list, realtime, admin masters（drug-masters/formulary/facility-standards/pharmacist-credentials/institutions）
- N/A（spinner が意味的に正しい）: `qr-scan/page.tsx`（カメラ初期化）, `reports/[id]/print/page.tsx:540`（監査 POST 中）, `reports/print/print-hub-content.tsx:883`

---

## Dimension 3: ErrorState adoption（再 grounded）

- Canonical: `src/components/ui/error-state.tsx` → `ErrorState({variant,title,description,detail,action,size,headingLevel,live})`。variant=not-found/server/network/forbidden/unauthorized。route 用 wrapper=`route-error-boundary.tsx:createRouteErrorBoundary(tag)`。
- 集計: **REAL=10 / FALSE_POSITIVE=0 / PARTIAL=1（jobs/DataTable）**。**観測 FP 率 ≈ 0%**（roadmap の 0% 主張を確認）。
- `error.tsx` survey: **22/22 が ErrorState 採用済み（bespoke 0）→ route-level error 境界は sweep 対象外**。
- 補正 loc: roadmap ~80 はやや過少（print 3ページ + UAT 4ブロックを undercount）。実 ≈ **~110–125 loc**。

### REAL target（hand-rolled error markup、sweep が触るべき）
1. `patients/[id]/mcs/mcs-content.tsx:936-948`（border-destructive div + AlertTriangle）
2. `reports/[id]/page.tsx:656-676`（`<Alert>`）
3. `reports/[id]/share/interprofessional-share-content.tsx:225-245`（bespoke `<h1>`）
4. `shared/[token]/shared-viewer-content.tsx:319-322`（border-destructive div）
5. `conferences/conferences-content.tsx:1302-1305`（border-destructive div）
6. `admin/uat/uat-content.tsx:464,637,733,971`（query-error `<p>` ×4）
7. `reports/print/print-hub-content.tsx:884-892`（+ `:1082` printError）
8. `patients/[id]/management-plan/print/page.tsx:132-141`
9. `patients/[id]/medications/print/page.tsx:109-120`
10. `patients/[id]/visit-records/print/page.tsx:137-147`

### PARTIAL / 注意
- **jobs**: 画面に inline error 無し。`DataTable.errorMessage`→`data-table.tsx:498-513` の bespoke `role="alert"` box に委譲。jobs 個別編集は no-op。DataTable error box の ErrorState 統一は別の横断変更。

---

## Gate 判定

- **PASS 条件**: Wave1/2 の状態系 sweep は本台帳の **REAL 行（file:line）のみ**を対象とする。DO-NOT-TOUCH 行への blind edit は退行（EmptyState ~31% / Skeleton ~48% screen-level が既カバー）。
- **loc 補正サマリ**: EmptyState 160→~90-120 / Skeleton 180→~120-180（但し場所は content 層）/ ErrorState 80→~110-125。
- **Wave1 着手可否**: 本台帳適用を条件に、Wave1 の状態系項目は per-instance scope で着手可。route-level `loading.tsx`/`error.tsx` は対象外（既カバー）。
- **要 codex レビュー**: maker/checker により本 grounding 台帳を codex が独立検証してから Wave1 状態系 sweep を実装する。
