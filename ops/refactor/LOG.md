# LOG — 実施記録+検証（1スライス1エントリ）

> 2026-07-03 台帳再編で REFACTOR_LOG.md と VERIFICATION.md を統合。過去分は
> `archive/REFACTOR_LOG_until-20260703.md` / `archive/VERIFICATION_until-20260703.md` を参照。
> エントリ書式: `## <日付> <変更ID> <commit>` — 分類 / 対象 / 実施内容 / 挙動変更 /
> 検証(コマンドと結果) / レビュー verdict / 残課題。簡潔に（1エントリ 15 行以内目安）。

## 2026-07-05 R40/R44-print-hub 8acdefdb

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/app/(dashboard)/reports/print/print-hub-content.tsx`,
  `src/app/(dashboard)/reports/print/print-hub-content.test.tsx`
- 実施: set plans / patient prescriptions / care reports / patient documents の read GET 4本を
  `readApiJson` へ移行し、failed GET の API JSON `message` 表面化テストを追加。
- 挙動変更: read fetch 実装内部の helper 収束のみ。query paths、patient_id scoping、
  patient API helper、print audit helper、org header、queryKey、enabled gates、print audit POST、
  first-visit print history mutation、error UI は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused print-hub-content Vitest `1 file / 28 tests` green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 8acdefdb。
- 残課題: R40/R44 は partial。first-visit print history mutation は未変更。

## 2026-07-05 R40/R44-patient-medications c54ff5d4

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/app/(dashboard)/patients/[id]/medications/medications-content.tsx`,
  `src/app/(dashboard)/patients/[id]/medications/medications-content.test.tsx`
- 実施: medication profiles / patient summary / medication issues / inquiry records /
  residual medications の read GET 5本を `readApiJson` へ移行し、failed GET の API JSON `message`
  表面化テストを追加。
- 挙動変更: read fetch 実装内部の helper 収束のみ。query paths、encoded query values、
  patient API helper、org header、queryKey、enabled gates、no-false-empty/error UI、mutations、QR/export は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused medications-content Vitest `1 file / 33 tests` green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit c54ff5d4。
- 残課題: R40/R44 は partial。add/issue mutation fetchers は未変更。

## 2026-07-05 R40/R44-residual-adjustment 8fa2bbcc

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/app/(dashboard)/patients/[id]/residual-adjustment/residual-adjustment-content.tsx`,
  `src/app/(dashboard)/patients/[id]/residual-adjustment/residual-adjustment-content.headers.test.tsx`
- 実施: residual medications / inquiry records read GET 2本を `readApiJson` へ移行し、
  focused header/path test を real Response body 経路へ更新。
- 挙動変更: read fetch 実装内部の helper 収束のみ。query path、encoded patient_id、org header、
  queryKey、enabled gate、error UI、intervention mutation、presigned upload flow は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused residual-adjustment Vitest `3 files / 17 tests` green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 8fa2bbcc。
- 残課題: R40/R44 は partial。mutation/upload fetcher は未変更。

## 2026-07-05 R40/R44-patient-edit d62db6f6

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/app/(dashboard)/patients/[id]/edit/patient-edit-content.tsx`,
  `src/app/(dashboard)/patients/[id]/edit/patient-edit-content.fetch.test.tsx`
- 実施: patient edit の patient overview read GET を `readApiJson` へ移行し、
  failed GET の API JSON `message` 表面化テストを追加。
- 挙動変更: read fetch 実装内部の helper 収束のみ。patient API path helper、org header、
  queryKey、enabled gate、refetch settings、dot-segment fail-closed、edit redirect helper、loading/error UI は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused patient-edit Vitest `2 files / 9 tests` green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit d62db6f6。
- 残課題: R40/R44 は partial。追加 fetcher は response body read の PHI safety を個別確認して段階移行。

## 2026-07-05 R40/R44-patient-readiness-cards 3e1ba2b9

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/app/(dashboard)/patients/[id]/patient-readiness-card.tsx`,
  `src/app/(dashboard)/patients/[id]/patient-workflow-preview-card.tsx` と各 test。
- 実施: patient readiness / workflow preview の read GET 2本を `readApiJson` へ移行し、
  failed GET の API JSON `message` 表面化テストを追加。
- 挙動変更: read fetch 実装内部の helper 収束のみ。patient path helpers、org header、
  queryKey、enabled gate、dot-segment fail-closed、patient links、loading/error UI は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused readiness/workflow Vitest `2 files / 16 tests` green。
  scoped eslint green。prettier は workflow test formatting 後 green。diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 3e1ba2b9。
- 残課題: R40/R44 は partial。追加 fetcher は response body read の PHI safety を個別確認して段階移行。

## 2026-07-05 R40/R44-patient-compare 1bbbca61

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/app/(dashboard)/patients/compare/compare-board.tsx`,
  `src/app/(dashboard)/patients/compare/compare-board.test.tsx`
- 実施: patient compare の patient overview read GET を `readApiJson` へ移行し、
  failed GET の API JSON `message` 表面化テストを追加。
- 挙動変更: read fetch 実装内部の helper 収束のみ。patient API path helper、org header、
  queryKey、enabled gate、compare card error UI、compare-card open link helper は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused compare-board Vitest `1 file / 3 tests` green。
  scoped eslint green。prettier は test file formatting 後 green。diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 1bbbca61。
- 残課題: R40/R44 は partial。追加 fetcher は response body read の PHI safety を個別確認して段階移行。

## 2026-07-05 R40/R44-visit-record-form 88125ca9

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/app/(dashboard)/visits/[id]/record/visit-record-form.tsx`
- 実施: visit record form の schedule detail / patient header summary / visit-preparation read GET
  3本を `readApiJson` へ移行。
- 挙動変更: read fetch 実装内部の helper 収束のみ。schedule/header-summary/visit-preparation
  path、org header、queryKey、enabled gate、schedule blocking error、fail-closed safety banner、
  retryable warning、CDS POST、save/upload/reflection mutations は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused visit-record-form Vitest `1 file / 22 tests` green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 88125ca9。
- 残課題: R40/R44 は partial。CDS POST と mutation/upload fetcher は未変更。

## 2026-07-05 R40/R44-visit-record-detail 500507ef

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/app/(dashboard)/visits/[id]/visit-record-detail.tsx`,
  `src/app/(dashboard)/visits/[id]/visit-record-detail.test.tsx`
- 実施: visit record detail / patient header / care reports / billing candidates /
  residual medications / visit-preparation の read GET 6本を `readApiJson` へ移行し、
  failed GET の API JSON `message` 表面化テストを追加。
- 挙動変更: read fetch 実装内部の helper 収束のみ。path/query/header/queryKey/enabled gates、
  fail-closed banners、no-false-empty/no-false-complete readiness、mutations は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused visit-record-detail Vitest `1 file / 18 tests` green。
  scoped eslint green。prettier は test file formatting 後 green。diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 500507ef。
- 残課題: R40/R44 は partial。mutation/generation fetcher は未変更。

## 2026-07-05 R40/R44-safety-check 6231bed5

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/app/(dashboard)/patients/[id]/safety-check/safety-check-content.tsx`,
  `src/app/(dashboard)/patients/[id]/safety-check/safety-check-content.test.tsx`
- 実施: medication issues / patient safety summary の read GET 2本を `readApiJson` へ移行し、
  failed GET の API JSON `message` 表面化テストを追加。
- 挙動変更: read fetch 実装内部の helper 収束のみ。raw patient_id query、patient API helper、
  org header、queryKeys、enabled gates、CDS degraded/fail-closed、mutations は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused safety-check-content Vitest `1 file / 25 tests` green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 6231bed5。
- 残課題: R40/R44 は partial。CDS 4xx-as-empty 特殊契約と mutation は未変更。

## 2026-07-05 R40/R44-facility-packet 4e57f877

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/app/(dashboard)/visits/[id]/facility-packet/facility-packet-content.tsx`,
  `src/app/(dashboard)/visits/[id]/facility-packet/facility-packet-content.test.tsx`
- 実施: facility packet の visit-preparation read GET を `readApiJson` へ移行し、
  endpoint/org header/roster render/API JSON `message` の契約テストを新規追加。
- 挙動変更: read fetch 実装内部の helper 収束のみ。visit-preparations path、
  org header、queryKey、enabled gate、retry UI、no-facility fallback、save mutation は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused facility-packet-content Vitest `1 file / 2 tests` green。
  scoped eslint green。prettier は new test formatting 後 green。diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 4e57f877。
- 残課題: R40/R44 は partial。追加 fetcher は response body read の PHI safety を個別確認して段階移行。

## 2026-07-05 R40/R44-visit-reflected-fields 198e6183

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/app/(dashboard)/visits/[id]/visit-reflected-fields-card.tsx`,
  `src/app/(dashboard)/visits/[id]/visit-reflected-fields-card.test.tsx`
- 実施: visit reflected fields card の read GET を `readApiJson` へ移行し、
  failed GET の API JSON `message` が query error に残る契約テストを追加。
- 挙動変更: read fetch 実装内部の helper 収束のみ。reflected-fields path、
  org header、queryKey、enabled gate、retryable error card、空カード抑制、機微項目表示は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused visit-reflected-fields-card Vitest `1 file / 5 tests` green。
  scoped eslint green。prettier は test file formatting 後 green。diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 198e6183。
- 残課題: R40/R44 は partial。追加 fetcher は response body read の PHI safety を個別確認して段階移行。

## 2026-07-05 R40/R44-evidence-gallery 4905eff3

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/app/(dashboard)/visits/evidence/evidence-gallery-content.tsx`,
  `src/app/(dashboard)/visits/evidence/evidence-gallery-content.test.ts`
- 実施: evidence gallery の visit-record list read GET を `readApiJson` へ移行し、
  failed GET の API JSON `message` が query error に残る契約テストを追加。
- 挙動変更: read fetch 実装内部の helper 収束のみ。visit-records query path、
  org header、queryKey、enabled gate、offline draft merge/retry/sync、attachment cap は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused evidence-gallery-content Vitest `2 files / 6 tests` green。
  scoped eslint green。prettier は touched files formatting 後 green。diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 4905eff3。
- 残課題: R40/R44 は partial。追加 fetcher は response body read の PHI safety を個別確認して段階移行。

## 2026-07-05 R40/R44-visit-brief-review 8f91ad17

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/app/(dashboard)/visits/[id]/brief/visit-brief-review-content.tsx`,
  `src/app/(dashboard)/visits/[id]/brief/visit-brief-review-content.test.tsx`
- 実施: visit brief review の patient visit-brief read GET を `readApiJson` へ移行し、
  failed GET の API JSON `message` が query error に残る契約テストを追加。
- 挙動変更: read fetch 実装内部の helper 収束のみ。patient resolution fallback GETs、
  patient API helper、org header、queryKeys、enabled gates、retry UI、feedback mutation は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused visit-brief-review-content Vitest `1 file / 2 tests` green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 8f91ad17。
- 残課題: R40/R44 は partial。追加 fetcher は response body read の PHI safety を個別確認して段階移行。

## 2026-07-05 R40/R44-patient-visit-brief 868eb6e2

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/components/visit-brief/patient-visit-brief-section.tsx`,
  `src/components/visit-brief/patient-visit-brief-section.test.tsx`
- 実施: patient visit brief の read GET を `readApiJson` へ移行し、
  failed GET の API JSON `message` が query error に残る契約テストを追加。
- 挙動変更: read fetch 実装内部の helper 収束のみ。patient API helper、org header、
  queryKey、enabled gate、retryable error UI、loading skeleton、compact card rendering は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused patient-visit-brief-section Vitest `1 file / 4 tests` green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 868eb6e2。
- 残課題: R40/R44 は partial。追加 fetcher は response body read の PHI safety を個別確認して段階移行。

## 2026-07-05 R40/R44-patient-share d351c199

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/app/(dashboard)/patients/[id]/share/external-share-content.tsx`,
  `src/app/(dashboard)/patients/[id]/share/external-share-content.test.tsx`
- 実施: patient share overview / care team / contacts / communication request list+detail の
  read GET 5本を `readApiJson` へ移行し、failed GET の API JSON `message` 表面化テストを追加。
- 挙動変更: read fetch 実装内部の helper 収束のみ。path helpers、org header、queryKey、
  enabled gates、hostile-id encoding、no-store overview、mutation contracts、queue href は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused patient-share Vitest `1 file / 12 tests` green。scoped eslint green。
  prettier は touched files formatting 後 green。diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit d351c199。
- 残課題: R40/R44 は partial。追加 fetcher は response body read の PHI safety を個別確認して段階移行。

## 2026-07-05 R40/R44-structured-care-panel 5b5c7e8f

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/components/features/patients/patient-structured-care-panel.tsx`,
  `src/components/features/patients/patient-structured-care-panel.test.tsx`
- 実施: patient structured care panel の read GET を `readApiJson` へ移行し、
  failed GET の API JSON `message` が query error に残る契約テストを追加。
- 挙動変更: read fetch 実装内部の helper 収束のみ。patient API helper、org header、queryKey、
  enabled gate、retryable error UI、空カード抑制、UTC date-only display は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused patient-structured-care-panel Vitest `1 file / 5 tests` green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 5b5c7e8f。
- 残課題: R40/R44 は partial。追加 fetcher は response body read の PHI safety を個別確認して段階移行。

## 2026-07-05 R40/R44-patient-field-revisions e110d2ec

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/components/features/patients/patient-field-revision-timeline.tsx`,
  `src/components/features/patients/patient-field-revision-timeline.test.tsx`
- 実施: patient field revision timeline の read GET を `readApiJson` へ移行し、
  failed GET の API JSON `message` 表面化テストを追加。
- 挙動変更: read fetch 実装内部の helper 収束のみ。patient API helper、category query、
  org header、queryKey、enabled gate、hostile-id encoding/dot rejection、truncated metadata は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused patient-field-revision timeline Vitest `1 file / 6 tests` green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit e110d2ec。
- 残課題: R40/R44 は partial。追加 fetcher は response body read の PHI safety を個別確認して段階移行。

## 2026-07-05 R40/R44-patient-history-summary 5010c64d

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/components/features/patients/patient-history-summary.tsx`,
  `src/components/features/patients/patient-history-summary.test.tsx`
- 実施: previous prescription / previous visit summary の read GET 2本を
  `readApiJson` へ移行し、failed GET の API JSON `message` 表面化テストを追加。
- 挙動変更: read fetch 実装内部の helper 収束のみ。patient API helper、`?limit=5`,
  visit-records query、org header、queryKey、enabled gate、href helper、current-item exclusion は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused patient-history-summary Vitest `1 file / 5 tests` green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 5010c64d。
- 残課題: R40/R44 は partial。追加 fetcher は response body read の PHI safety を個別確認して段階移行。

## 2026-07-05 R40/R44-report-detail 6402269d

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/app/(dashboard)/reports/[id]/page.tsx`,
  `src/app/(dashboard)/reports/[id]/page.test.tsx`
- 実施: care report detail / external professional suggestions の read GET 2本を
  `readApiJson` へ移行し、failed GET の API JSON `message` 表面化テストを追加。
- 挙動変更: read fetch 実装内部の helper 収束のみ。path helpers、org header、queryKey、
  enabled gates、hostile report-id encoding、send-permission gate、send safety は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  mutation error handling、idempotency headers、live DB/external send/secret/push/destructive operation 不変。
- 検証: focused report detail Vitest `1 file / 38 tests` green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 6402269d。
- 残課題: R40/R44 は partial。追加 fetcher は response body read の PHI safety を個別確認して段階移行。

## 2026-07-05 R40/R44-interprofessional-share 058e183c

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/app/(dashboard)/reports/[id]/share/interprofessional-share-content.tsx`
- 実施: care report detail / patient care team / patient contacts / communication request list /
  communication request detail の read GET 5本を `readApiJson` へ移行。
- 挙動変更: read fetch 実装内部の helper 収束のみ。path helpers、org header、queryKey、
  enabled gates、hostile-id encoding/dot rejection、view-only gate、reply list/detail separation は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  POST mutation error handling、live DB/external send/secret/push/destructive operation 不変。
- 検証: focused interprofessional-share Vitest `1 file / 28 tests` green。
  scoped eslint green。prettier は touched component formatting 後 green。diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 058e183c。
- 残課題: R40/R44 は partial。追加 fetcher は response body read の PHI safety を個別確認して段階移行。

## 2026-07-05 R40/R44-collaboration-overview aa2c3955

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/app/(dashboard)/patients/[id]/collaboration/collaboration-content.tsx`,
  `src/app/(dashboard)/patients/[id]/collaboration/collaboration-content.test.tsx`
- 実施: patient collaboration overview GET を `readApiJson<PatientOverview>` へ移行し、
  failed GET の API JSON `message` が queryFn から表面化する契約テストを追加。
- 挙動変更: read fetch 実装内部の helper 収束のみ。patient path helper、org header、queryKey、
  enabled gate、workflow back link、presence heartbeat/users、comment thread entity id、refresh invalidation は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused collaboration Vitest `1 file / 10 tests` green。
  scoped eslint green。prettier は touched test formatting 後 green。diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit aa2c3955。
- 残課題: R40/R44 は partial。追加 fetcher は response body read の PHI safety を個別確認して段階移行。

## 2026-07-05 R40/R44-prescription-inline-detail 683a8c59

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/app/(dashboard)/prescriptions/prescription-inline-detail.tsx`
- 実施: prescription intake detail GET を `readApiJson<IntakeDetail>` へ移行。
- 挙動変更: read fetch 実装内部の helper 収束のみ。path helper、org header、queryKey、
  hostile-id encoding/dot rejection、処方/患者リンク、display_id 表示、明細 table は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused prescription-inline-detail Vitest `1 file / 10 tests` green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 683a8c59。
- 残課題: R40/R44 は partial。追加 fetcher は response body read の PHI safety を個別確認して段階移行。

## 2026-07-05 R40/R44-visits-today 6e911f36

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/app/(dashboard)/visits/visits-today.tsx`,
  `src/app/(dashboard)/visits/visits-today.test.tsx`
- 実施: `/api/visits/today-preparation` board GET を `readApiJson` へ移行。
  既存 contract test を標準 `Response` mock に更新し、endpoint/org header/query key/envelope unwrap を固定。
- 挙動変更: read fetch 実装内部の helper 収束のみ。realtime invalidation、board rendering、
  disabled primary action、action rail、blocked reasons、evidence links は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused visits-today Vitest は object identity assertion で一度 red、deep equality へ修正後
  `1 file / 6 tests` green。scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 6e911f36。
- 残課題: R40/R44 は partial。追加 fetcher は response body read の PHI safety を個別確認して段階移行。

## 2026-07-05 R40/R44-my-day bc78bc28

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/app/(dashboard)/my-day/my-day-content.tsx`,
  `src/app/(dashboard)/my-day/my-day-content.test.tsx`
- 実施: assigned visit schedules / admin status-change audit logs の read GET 2本を
  `readApiJson` へ移行。queryFn contract test で assigned visit endpoint、org header、
  admin status-change org header/JST day boundary を固定。
- 挙動変更: read fetch 実装内部の helper 収束のみ。queryKey、enabled gates、task cursor pagination、
  dashboard cockpit fetch、status-change visibility rules は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused my-day Vitest `1 file / 20 tests` green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit bc78bc28。
- 残課題: R40/R44 は partial。追加 fetcher は response body read の PHI safety を個別確認して段階移行。

## 2026-07-05 R40/R44-external-viewer 798e1e08

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/app/(dashboard)/external/external-viewer-content.tsx`,
  `src/app/(dashboard)/external/external-viewer-content.test.tsx`
- 実施: external access / patient self-reports / community activities の read GET 3本を
  `readApiJson` へ移行。queryFn contract test で static endpoint、org header、query key を固定。
- 挙動変更: read fetch 実装内部の helper 収束のみ。response envelope、retry/error UI、
  self-report PATCH、task POST mutation/invalidation は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused external viewer Vitest `1 file / 9 tests` green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 798e1e08。
- 残課題: R40/R44 は partial。追加 fetcher は response body read の PHI safety を個別確認して段階移行。

## 2026-07-05 R40/R44-contact-profiles dbe9853d

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/app/(dashboard)/admin/contact-profiles/contact-profiles-content.tsx`,
  `src/app/(dashboard)/admin/contact-profiles/contact-profiles-content.test.tsx`
- 実施: contact-profiles GET の `if (!response.ok) throw` + `response.json()` を
  `readApiJson<{ data: ContactProfile[] }>` へ移行。test mock を標準 Response contract へ変更。
- 挙動変更: read fetch 実装内部の helper 収束のみ。path helper、`buildOrgHeaders`、
  React Query key、debounce、response envelope、delivery target edit、PATCH mutation は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused contact-profiles Vitest `1 file / 7 tests` green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit dbe9853d。
- 残課題: R40/R44 は partial。追加 fetcher は response body read の PHI safety を個別確認して段階移行。

## 2026-07-05 R40/R44-admin-analytics 43f2afdf

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/app/(dashboard)/admin/analytics/analytics-content.tsx`
- 実施: billing analytics / resource-map GET の `if (!res.ok) throw` + `res.json()` を
  `readApiJson` へ移行。既存 test が static path/org headers/query keys と独立 error state を固定。
- 挙動変更: read fetch 実装内部の helper 収束のみ。API paths、`buildOrgHeaders`、
  React Query keys、response envelopes、billing/resource-map UI、aggregate-only search は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused admin analytics Vitest `1 file / 9 tests` green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 43f2afdf。
- 残課題: R40/R44 は partial。追加 fetcher は response body read の PHI safety を個別確認して段階移行。

## 2026-07-05 R40/R44-facility-standards e0324a79

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/app/(dashboard)/admin/facility-standards/facility-standards-content.tsx`,
  `src/app/(dashboard)/admin/facility-standards/facility-standards-content.test.tsx`
- 実施: facility standards GET の `if (!res.ok) throw` + `res.json()` を
  `readApiJson<FacilityStandardsResponse>` へ移行。static path/org header/envelope metadata を test 固定。
- 挙動変更: read fetch 実装内部の helper 収束のみ。`/api/admin/facility-standards`、
  `buildOrgHeaders`、React Query key、count metadata、hidden-count/claim judgement は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused facility-standards Vitest `1 file / 4 tests` green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit e0324a79。
- 残課題: R40/R44 は partial。追加 fetcher は response body read の PHI safety を個別確認して段階移行。

## 2026-07-05 R40/R44-dispense-audit-stats a2d0e1bc

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/app/(dashboard)/admin/dispense-audit-stats/page.tsx`,
  `src/app/(dashboard)/admin/dispense-audit-stats/page.test.tsx`
- 実施: dispense audit stats GET の `if (!res.ok) throw` + `res.json()` を
  `readApiJson<{ data: RejectReasonStats }>` へ移行。static path/org header を test 固定。
- 挙動変更: read fetch 実装内部の helper 収束のみ。`/api/admin/reject-reason-stats?days=...`、
  `buildOrgHeaders`、React Query key、response envelope、period switching、aggregate stats は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused dispense-audit stats Vitest `1 file / 5 tests` green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit a2d0e1bc。
- 残課題: R40/R44 は partial。追加 fetcher は response body read の PHI safety を個別確認して段階移行。

## 2026-07-05 R40/R44-inventory-forecast ae862108

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/app/(dashboard)/admin/inventory-forecast/inventory-forecast-content.tsx`,
  `src/app/(dashboard)/admin/inventory-forecast/inventory-forecast-content.test.tsx`
- 実施: inventory forecast GET の `if (!res.ok) throw` + `res.json()` を
  `readApiJson<{ data: InventoryForecast }>` へ移行。static path/org header を test 固定。
- 挙動変更: read fetch 実装内部の helper 収束のみ。`/api/admin/inventory-forecast`、
  `buildOrgHeaders`、React Query key、response envelope、forecast UI、unresolved-drug handling は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused inventory forecast Vitest `1 file / 6 tests` green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit ae862108。
- 残課題: R40/R44 は partial。追加 fetcher は response body read の PHI safety を個別確認して段階移行。

## 2026-07-05 R40/R44-jobs-dashboard 42048531

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/app/(dashboard)/admin/jobs/jobs-dashboard-content.tsx`,
  `src/app/(dashboard)/admin/jobs/jobs-dashboard-content.test.tsx`
- 実施: jobs dashboard GET の `if (!res.ok) throw` + `res.json()` を
  `readApiJson<{ data: JobDefinitionEntry[] }>` へ移行。static path/org header/envelope unwrap を test 固定。
- 挙動変更: read fetch 実装内部の helper 収束のみ。`/api/jobs`、
  `buildOrgHeaders`、React Query key、response envelope、structured error summary、rerun mutation は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused jobs dashboard Vitest `1 file / 8 tests` green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 42048531。
- 残課題: R40/R44 は partial。追加 fetcher は response body read の PHI safety を個別確認して段階移行。

## 2026-07-05 R40/R44-capacity-dashboard dd8fe888

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/app/(dashboard)/admin/capacity/capacity-content.tsx`,
  `src/app/(dashboard)/admin/capacity/capacity-content.test.tsx`
- 実施: capacity dashboard GET の `if (!res.ok) throw` + `res.json()` を
  `readApiJson<{ data: CapacitySummary }>` へ移行。static path/org header/envelope unwrap を test 固定。
- 挙動変更: read fetch 実装内部の helper 収束のみ。`/api/admin/capacity`、
  `buildOrgHeaders`、React Query key、response envelope、aggregate KPI、loading/error は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused capacity dashboard Vitest `1 file / 12 tests` green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit dd8fe888。
- 残課題: R40/R44 は partial。追加 fetcher は response body read の PHI safety を個別確認して段階移行。

## 2026-07-05 R40/R44-master-hub 67f3b081

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/app/(dashboard)/admin/master-hub-content.tsx`,
  `src/app/(dashboard)/admin/master-hub-content.test.tsx`
- 実施: master-hub GET の `if (!res.ok) throw` + `res.json()` を
  `readApiJson<{ data: MasterHubResponse }>` へ移行。static path/envelope unwrap を test 固定。
- 挙動変更: read fetch 実装内部の helper 収束のみ。`/api/admin/master-hub`、
  init-less fetch、React Query key、response envelope、master cards/actions、loading/error は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused master-hub Vitest `1 file / 11 tests` green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 67f3b081。
- 残課題: R40/R44 は partial。追加 fetcher は response body read の PHI safety を個別確認して段階移行。

## 2026-07-05 R40/R44-operations-insights 3e4ceb4e

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/app/(dashboard)/admin/operations-insights/operations-insights-content.tsx`
- 実施: operations-insights GET の `if (!res.ok) throw` + `res.json()` を
  `readApiJson<{ data: OperationsInsights }>` へ移行。
- 挙動変更: read fetch 実装内部の helper 収束のみ。`/api/admin/operations-insights`、
  `buildOrgHeaders`、React Query key、response envelope、charts/KPIs/hints、loading/error は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused operations-insights Vitest `1 file / 5 tests` green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 3e4ceb4e。
- 残課題: R40/R44 は partial。追加 fetcher は response body read の PHI safety を個別確認して段階移行。

## 2026-07-05 R40/R44-audit-logs 35837bcc

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/app/(dashboard)/admin/audit-logs/audit-logs-content.tsx`,
  `src/app/(dashboard)/admin/audit-logs/audit-logs-content.test.tsx`
- 実施: audit-log list GET の `if (!res.ok) throw` + `res.json()` を
  `readApiJson<{ data: AuditLog[] }>` へ移行。list request の org header 契約を test で固定。
- 挙動変更: read fetch 実装内部の helper 収束のみ。`/api/audit-logs`、query params、
  `buildOrgHeaders`、React Query key、response envelope、filter UI、empty/error、JSON/CSV export は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused audit-logs Vitest `1 file / 8 tests` green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 35837bcc。
- 残課題: R40/R44 は partial。追加 fetcher は response body read の PHI safety を個別確認して段階移行。

## 2026-07-05 R40/R44-admin-metrics a82f19e7

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/app/(dashboard)/admin/metrics/metrics-dashboard-content.tsx`,
  `src/app/(dashboard)/admin/metrics/metrics-dashboard-content.test.tsx`
- 実施: admin metrics GET の `if (!res.ok) throw` + `res.json()` を
  `readApiJson<{ data: MetricsData }>` へ移行。成功 test に static path/header 契約を追加。
- 挙動変更: read fetch 実装内部の helper 収束のみ。`/api/admin/metrics`、
  `buildOrgHeaders`、React Query key、response envelope、metric card 表示、
  first-load/stale-refetch error behavior は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused admin metrics Vitest `1 file / 7 tests` green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit a82f19e7。
- 残課題: R40/R44 は partial。追加 fetcher は response body read の PHI safety を個別確認して段階移行。

## 2026-07-05 R40/R44-saved-views cd3e3c05

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/app/(dashboard)/views/saved-views-content.tsx`,
  `src/app/(dashboard)/views/saved-views-content.test.tsx`
- 実施: saved-view preference GET と named-view GET の `if (!res.ok) throw` + `res.json()` を
  `readApiJson` へ移行。test mock を標準 `jsonResponse` contract へ変更。
- 挙動変更: read fetch 実装内部の helper 収束のみ。`/api/me/preferences`,
  `/api/saved-views?scope=schedules`, path helper、`buildOrgHeaders`、React Query key、
  envelope fallback、画面表示、mutation error parsing / hostile-id encoding は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused saved-views Vitest `1 file / 13 tests` green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit cd3e3c05。
- 残課題: R40/R44 は partial。追加 fetcher は response body read の PHI safety を個別確認して段階移行。

## 2026-07-05 R40/R44-select-site cb515780

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/app/(dashboard)/select-site/select-site-content.tsx`
- 実施: site-selection GET helper の `if (!res.ok) throw` + `res.json()` を
  `readApiJson<{ data: MySite[] }>` へ移行。
- 挙動変更: read fetch 実装内部の helper 収束のみ。`/api/me/sites`、`buildOrgHeaders`、
  React Query key、response envelope unwrapping、画面表示、site switch mutation は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused select-site Vitest `1 file / 2 tests` green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit cb515780。
- 残課題: R40/R44 は partial。追加 fetcher は response body read の PHI safety を個別確認して段階移行。

## 2026-07-05 R40/R44-staff-workload 478ff2a8

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/app/(dashboard)/tasks/tasks-content.tsx`,
  `src/app/(dashboard)/tasks/tasks-content.test.tsx`
- 実施: tasks staff-workload GET fetcher の `if (!res.ok) throw` + `res.json()` を
  `readApiJson<{ data: StaffWorkload[]; date: string }>` へ移行。queryFn contract test を追加。
- 挙動変更: read fetch 実装内部の helper 収束のみ。API path、`buildOrgHeaders`、
  React Query key、response envelope、画面表示、task list pagination、task mutations は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused tasks content Vitest `1 file / 12 tests` green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 478ff2a8。
- 残課題: R40/R44 は partial。追加 fetcher は response body read の PHI safety を個別確認して段階移行。

## 2026-07-05 R40/R44-notifications 0182c928

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/app/(dashboard)/notifications/notifications-content.tsx`,
  `src/app/(dashboard)/notifications/notifications-content.test.tsx`
- 実施: notifications inbox GET fetcher の `if (!res.ok) throw` + `res.json()` を
  `readApiJson<{ data: NotificationItem[] }>` へ移行。既存 queryFn contract test で envelope 返却も固定。
- 挙動変更: read fetch 実装内部の helper 収束のみ。API path helper、`buildOrgHeaders`、
  React Query key、realtime merge、response envelope、画面表示、mark-read mutation は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused notifications inbox Vitest `1 file / 11 tests` green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 0182c928。
- 残課題: R40/R44 は partial。追加 fetcher は response body read の PHI safety を個別確認して段階移行。

## 2026-07-05 R40/R44-staff-kpi ec58d924

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/app/(dashboard)/admin/staff/staff-kpi-panel.tsx`,
  `src/app/(dashboard)/admin/staff/staff-kpi-panel.test.tsx`
- 実施: staff KPI GET fetcher の `if (!response.ok) throw` + `response.json()` を
  `readApiJson<StaffMetricsResponse>` へ移行。既存 queryFn contract test で envelope 返却も固定。
- 挙動変更: read fetch 実装内部の helper 収束のみ。API path helper、`buildOrgHeaders`、
  React Query key、response envelope、画面表示は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused staff KPI Vitest `1 file / 3 tests` green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit ec58d924。
- 残課題: R40/R44 は partial。追加 fetcher は response body read の PHI safety を個別確認して段階移行。

## 2026-07-05 R40/R44-packaging-methods 9b03632f

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/app/(dashboard)/admin/packaging-methods/packaging-methods-content.tsx`,
  `src/app/(dashboard)/admin/packaging-methods/packaging-methods-content.test.tsx`
- 実施: packaging methods GET fetcher の `if (!res.ok) throw` + `res.json()` を
  `readApiJson<PackagingMethodsResponse>` へ移行。既存 queryFn contract test で envelope 返却も固定。
- 挙動変更: read fetch 実装内部の helper 収束のみ。API path、`buildOrgHeaders`、
  React Query key、response envelope、画面表示、save mutation error payload parsing は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused packaging methods Vitest `1 file / 9 tests` green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 9b03632f。
- 残課題: R40/R44 は partial。追加 fetcher は response body read の PHI safety を個別確認して段階移行。

## 2026-07-05 R40/R44-report-delivery ee0a3856

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 対象: `src/app/(dashboard)/reports/report-delivery-dashboard.tsx`,
  `src/app/(dashboard)/reports/report-delivery-dashboard.test.tsx`
- 実施: report delivery analytics GET fetcher の `if (!response.ok) throw` +
  `response.json()` を `readApiJson<DeliveryAnalyticsResponse>` へ移行。
  既存 queryFn contract test で envelope 返却も固定。
- 挙動変更: read fetch 実装内部の helper 収束のみ。API path、`buildOrgHeaders`、
  React Query key、response envelope、画面表示、reminder mutation error payload parsing は維持。
- 安全: product UI read fetch internals のみ。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
  live DB/external send/secret/push/destructive operation 不変。
- 検証: focused report delivery dashboard Vitest `1 file / 9 tests` green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit ee0a3856。
- 残課題: R40/R44 は partial。追加 fetcher は response body read の PHI safety を個別確認して段階移行。

## 2026-07-05 R23-schedule-optimizer 58c42de5

- 分類: dup-helper / error message helper convergence
- 対象: `src/app/(dashboard)/schedules/proposals/schedule-weekly-optimizer.tsx`,
  `src/app/(dashboard)/schedules/proposals/schedule-weekly-optimizer.test.tsx`
- 実施: facility aggregation failure reason を既存 `messageFromError` へ収束。
  empty Error message の fallback reason テストを追加。
- 挙動変更: 空の Error message は shared helper 契約どおり fallback へ正規化。
  request payload、partial-batch behavior、toast summary、query invalidation は維持。
- 安全: client/helper error formatting のみ。product API/DB/auth/authorization/PHI/billing/deploy/package
  dependency は変更不要。audit semantics/live DB/external send/secret/push/destructive operation 不変。
- 検証: focused schedule-optimizer/error-message vitest 2 files / 13 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 58c42de5。
- 残課題: R23 は partial。残りは query detail optional / sentinel / API error-code checks が中心。

## 2026-07-05 R23-qr-scan 74b7e6ea

- 分類: dup-helper / error message helper convergence
- 対象: `src/app/(dashboard)/qr-scan/page.tsx`,
  `src/app/(dashboard)/qr-scan/page.contract.test.ts`
- 実施: QR scan draft-send error を既存 `messageFromError` へ収束。
  既存 source contract test に helper 使用の teeth を追加。
- 挙動変更: 空の Error message は shared helper 契約どおり fallback へ正規化。
  QR draft request body、site context、alert/status live region、retry/reset flow は維持。
- 安全: client/helper error formatting のみ。product API/DB/auth/authorization/PHI/billing/deploy/package
  dependency は変更不要。audit semantics/live DB/external send/secret/push/destructive operation 不変。
- 検証: focused QR scan/error-message vitest 2 files / 14 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 74b7e6ea。
- 残課題: R23 は partial。残りの hand-rolled error-message ternary は段階移行を継続。

## 2026-07-05 R23-mfa-setup bae0f7c1

- 分類: dup-helper / error message helper convergence
- 対象: `src/app/(auth)/mfa/setup/page.tsx`,
  `src/app/(auth)/mfa/setup/page.test.tsx`
- 実施: MFA setup loading / verification error を既存 `messageFromError` へ収束。
  empty Error message の fallback alert テストを追加。
- 挙動変更: 空の Error message は shared helper 契約どおり fallback へ正規化。
  MFA setup/verify API path、request body、step遷移、recovery codes handling は維持。
- 安全: client/helper error formatting のみ。product API/DB/auth flow semantics/authorization/PHI/billing/deploy/package
  dependency は変更不要。audit semantics/live DB/external send/secret/push/destructive operation 不変。
  SSOT には必要時にそれらを product contract として変更可というユーザー指示が記録済み。
- 検証: focused MFA setup/error-message vitest 2 files / 5 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit bae0f7c1。
- 残課題: R23 は partial。残りの hand-rolled error-message ternary は段階移行を継続。

## 2026-07-05 R23-billing-rules 8c3b18aa

- 分類: dup-helper / error message helper convergence
- 対象: `src/app/(dashboard)/admin/billing-rules/page.tsx`,
  `src/app/(dashboard)/admin/billing-rules/page.test.tsx`
- 実施: billing rule JSON validation error を既存 `messageFromError` へ収束。
  empty Error message の fallback alert テストを追加し、既存 validation 表示へ `role="alert"` を付与。
- 挙動変更: 空の Error message は shared helper 契約どおり fallback へ正規化。
  JSON object validation、mutation payload、API path、billing semantics は維持。
- 安全: client/helper validation-error formatting のみ。product API/DB/auth/authorization/PHI/billing/deploy/package
  dependency は変更不要。audit semantics/live DB/external send/secret/push/destructive operation 不変。
  SSOT には必要時にそれらを product contract として変更可というユーザー指示が記録済み。
- 検証: focused billing-rules/error-message/json-editor vitest 3 files / 20 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 8c3b18aa。
- 残課題: R23 は partial。残りの hand-rolled error-message ternary は段階移行を継続。

## 2026-07-05 R23-patient-medications 318f04d1

- 分類: dup-helper / error message helper convergence
- 対象: `src/app/(dashboard)/patients/[id]/medications/medications-content.tsx`,
  `src/app/(dashboard)/patients/[id]/medications/medications-content.test.tsx`
- 実施: patient medication add-dialog mutation error alert を既存
  `messageFromError` へ収束。empty Error message の fallback alert テストを追加。
- 挙動変更: 空の Error message は shared helper 契約どおり fallback へ正規化。
  server message 表示、assertive alert、薬剤追加 dialog、mutation payload は維持。
- 安全: client/helper error formatting のみ。product API/DB/auth/authorization/PHI/billing/deploy/package
  dependency は変更不要。audit semantics/live DB/external send/secret/push/destructive operation 不変。
  SSOT には必要時にそれらを product contract として変更可というユーザー指示が記録済み。
- 検証: focused patient-medications/error-message vitest 2 files / 31 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 318f04d1。
- 残課題: R23 は partial。残りの hand-rolled error-message ternary は段階移行を継続。

## 2026-07-05 R23-drug-master fea1cd37

- 分類: dup-helper / error message helper convergence
- 対象: `src/app/(dashboard)/admin/drug-masters/drug-master-content.tsx`,
  `src/app/(dashboard)/admin/drug-masters/drug-master-content.test.tsx`
- 実施: official drug master import preview failure 表示を既存
  `messageFromError` へ収束。empty Error message の fallback alert/toast テストを追加。
- 挙動変更: 空の Error message は shared helper 契約どおり fallback へ正規化。
  preview request body、org headers、成功 preview、取込実行 mutation は維持。
- 安全: client/helper error formatting のみ。product API/DB/auth/authorization/PHI/billing/deploy/package
  dependency は変更不要。audit semantics/live DB/external send/secret/push/destructive operation 不変。
  SSOT には必要時にそれらを product contract として変更可というユーザー指示が記録済み。
- 検証: focused drug-master/error-message vitest 2 files / 90 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit fea1cd37。
- 残課題: R23 は partial。残りの hand-rolled error-message ternary は段階移行を継続。

## 2026-07-05 R23-audit-logs 872624db

- 分類: dup-helper / error message helper convergence
- 対象: `src/app/(dashboard)/admin/audit-logs/audit-logs-content.tsx`,
  `src/app/(dashboard)/admin/audit-logs/audit-logs-content.test.tsx`
- 実施: audit log export failure toast を既存 `messageFromError` へ収束。
  empty Error message の fallback toast テストを追加。
- 挙動変更: 空の Error message は shared helper 契約どおり fallback へ正規化。
  export request params、blob download、success toast、list error state は維持。
- 安全: client/helper error formatting のみ。product API/DB/auth/authorization/PHI/billing/deploy/package
  dependency は変更不要。audit semantics/live DB/external send/secret/push/destructive operation 不変。
- 検証: focused audit-logs/error-message vitest 2 files / 11 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 872624db。
- 残課題: R23 は partial。残りの hand-rolled error-message ternary は段階移行を継続。

## 2026-07-05 R23-search 4f1c7321

- 分類: dup-helper / error message helper convergence
- 対象: `src/app/(dashboard)/search/search-content.tsx`,
  `src/app/(dashboard)/search/search-content.test.tsx`
- 実施: 全体検索の outer error alert を既存 `messageFromError` へ収束。
  empty Error message の JSON parse failure fallback テストを追加。
- 挙動変更: 空の Error message は shared helper 契約どおり fallback へ正規化。
  fetch-level partial failure feedback とカテゴリ結果維持は不変。
- 安全: client/helper error formatting のみ。product API/DB/auth/authorization/PHI/billing/deploy/package
  dependency は変更不要。audit/live DB/external send/secret/push/destructive operation 不変。
- 検証: focused search/error-message vitest 2 files / 23 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 4f1c7321。
- 残課題: R23 は partial。残りの hand-rolled error-message ternary は段階移行を継続。

## 2026-07-05 R23-print-hub 42d866e3

- 分類: dup-helper / error message helper convergence
- 対象: `src/app/(dashboard)/reports/print/print-hub-content.tsx`,
  `src/app/(dashboard)/reports/print/print-hub-content.test.tsx`
- 実施: first-visit print history failure 表示を既存 `messageFromError` へ収束。
  empty Error message の fallback alert テストを追加。
- 挙動変更: 空の Error message は shared helper 契約どおり fallback へ正規化。
  印刷後確認、print-batch request body、通常 Error message は維持。
- 安全: client/helper error formatting のみ。product API/DB/auth/authorization/PHI/billing/deploy/package
  dependency は変更不要。audit/live DB/external send/secret/push/destructive operation 不変。
- 検証: focused print-hub/error-message vitest 2 files / 27 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 42d866e3。
- 残課題: R23 は partial。残りの hand-rolled error-message ternary は段階移行を継続。

## 2026-07-05 R23-schedule-proposals 6d098a9b

- 分類: dup-helper / error message helper convergence
- 対象: `src/app/(dashboard)/schedules/proposals/schedule-proposals-content.tsx`
- 実施: proposal action / bulk action の fetch/json error formatting 3箇所を既存
  `messageFromError` へ収束。
- 挙動変更: 空の Error message は shared helper 契約どおり fallback へ正規化。
  safe failure display、server-reached 判定、toast/alert の sensitive suppression は維持。
- 安全: client/helper error formatting のみ。product API/DB/auth/authorization/PHI/billing/deploy/package
  dependency は変更不要。audit/live DB/external send/secret/push/destructive operation 不変。
- 検証: focused schedule-proposals/error-message vitest 2 files / 42 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 6d098a9b。
- 残課題: R23 は partial。残りの hand-rolled error-message ternary は段階移行を継続。

## 2026-07-05 R23-workbench-mutations ad956006

- 分類: dup-helper / error message helper convergence
- 対象: `src/components/features/dispense-workbench/use-workbench-mutations.ts`,
  `src/components/features/dispense-workbench/use-workbench-mutations.test.tsx`
- 実施: generic workbench write error toast を既存 `messageFromError` へ収束。
  empty Error message の fallback toast テストを追加。
- 挙動変更: 空の Error message は shared helper 契約どおり fallback へ正規化。
  conflict/write error 専用分岐と通常 Error message は維持。
- 安全: client/helper error formatting のみ。product API/DB/auth/authorization/PHI/billing/deploy/package
  dependency は変更不要。audit/live DB/external send/secret/push/destructive operation 不変。
- 検証: focused workbench-mutations/error-message vitest 2 files / 8 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit ad956006。
- 残課題: R23 は partial。残りの hand-rolled error-message ternary は段階移行を継続。

## 2026-07-05 R23-patient-form a47b52fa

- 分類: dup-helper / error message helper convergence
- 対象: `src/components/features/patients/patient-form.tsx`,
  `src/components/features/patients/patient-form.test.tsx`
- 実施: patient form の query error formatter と qualification check catch を既存
  `messageFromError` へ収束。empty Error message の qualification fallback テストを追加。
- 挙動変更: 空の Error message は shared helper 契約どおり fallback へ正規化。
  通常 Error message、HTTP payload message、toast/alert 表示は維持。
- 安全: client/helper error formatting のみ。product API/DB/auth/authorization/PHI/billing/deploy/package
  dependency は変更不要。audit/live DB/external send/secret/push/destructive operation 不変。
- 検証: focused patient-form/error-message vitest 2 files / 26 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit a47b52fa。
- 残課題: R23 は partial。残りの hand-rolled error-message ternary は段階移行を継続。

## 2026-07-05 R23-prescription-intake a510f2c2

- 分類: dup-helper / error message helper convergence
- 対象: `src/app/(dashboard)/prescriptions/new/prescription-intake-submit.ts`,
  `src/app/(dashboard)/prescriptions/new/prescription-intake-submit.test.ts`,
  `src/app/(dashboard)/prescriptions/new/prescription-intake-form.tsx`
- 実施: prescription intake submit/original-document error formatting を既存
  `messageFromError` へ収束。empty Error message の fallback テストを追加。
- 挙動変更: 空の Error message は shared helper 契約どおり fallback へ正規化。
  blocked line detail formatting と通常 Error message は維持。
- 安全: client/helper error formatting のみ。product API/DB/auth/authorization/PHI/billing/deploy/package
  dependency は変更不要。audit/live DB/external send/secret/push/destructive operation 不変。
- 検証: focused prescription-intake/error-message vitest 3 files / 17 tests green
  （既存 React act warning あり）。scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit a510f2c2。
- 残課題: R23 は partial。残りの hand-rolled error-message ternary は段階移行を継続。

## 2026-07-05 R25-complete 0f3d0151+3ed6ad78

- 分類: pattern-inconsistency / ErrorState retry action convergence
- 対象: reports, partner billing, prescriptions table, patient medications,
  notification settings, PCA pumps, drug-master detail/formulary panels, shifts.
- 実施: ASTで残存していた ErrorState retry action を `onRetry` + `retryLabel`
  へ移行。outline/sm retry は `retryVariant`/`retrySize` で維持。
- 挙動変更: なし。表示ラベル、refetch/reset handlers、false-empty/false-negative-safe
  error branch は不変。
- 安全: UI presentation/refactor のみ。product API/DB/auth/authorization/PHI/billing/deploy/package
  dependency は変更不要。audit/live DB/external send/secret/push/destructive operation 不変。
- 検証: AST scan は non-retry href ErrorState action 5件のみ残存。focused panel vitest
  6 files / 113 tests green。focused drug-master/shifts vitest 2 files / 99 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commits 0f3d0151, 3ed6ad78。
- 残課題: R25 は retry-action contract として complete。broader Plans.md objective は継続。

## 2026-07-05 R25-schedule-visit 72b1f57c

- 分類: pattern-inconsistency / ErrorState retry action convergence
- 対象: `src/app/(dashboard)/schedules/proposals/schedule-weekly-optimizer.tsx`,
  `src/app/(dashboard)/schedules/proposals/schedule-proposals-content.tsx`,
  `src/app/(dashboard)/visits/[id]/visit-record-detail.tsx`,
  `src/app/(dashboard)/visits/[id]/record/visit-record-form.tsx`
- 実施: schedule proposal / visit record の ErrorState 4箇所を
  `action={{ label: '再読み込み', onClick }}` から `onRetry` + `retryLabel` へ移行。
- 挙動変更: なし。表示ラベル、refetch handler、false-empty/false-negative-safe error branch、
  schedule/visit query behavior は不変。
- 安全: UI presentation/refactor のみ。product API/DB/auth/authorization/PHI/billing/deploy/package
  dependency は変更不要。audit/live DB/external send/secret/push/destructive operation 不変。
- 検証: focused schedule/visit vitest 4 files / 82 tests green。scoped
  eslint/prettier/diff-check green。`pnpm typecheck` green。retry-label scan は
  non-ErrorState EmptyState と ErrorState precedence test のみ残存。
- レビュー: self-verified。commit 72b1f57c。
- 残課題: R25 は partial。broader `<ErrorState action>` usages は別途監査が必要。

## 2026-07-05 R25-patient e6e73fa4

- 分類: pattern-inconsistency / ErrorState retry action convergence
- 対象: `src/components/features/patients/residual-medication-chart.tsx`,
  `src/app/(dashboard)/patients/[id]/prescriptions/prescription-history-content.tsx`,
  `src/app/(dashboard)/patients/[id]/patient-care-team-panel.tsx`
- 実施: residual medication / prescription history / patient care-team professional
  options の ErrorState 3箇所を `action={{ label: '再読み込み', onClick }}` から
  `onRetry` + `retryLabel` へ移行。
- 挙動変更: なし。表示ラベル、refetch handler、false-empty-safe error branch、
  residual/prescription-history/professional-option query behavior は不変。
- 安全: UI presentation/refactor のみ。product API/DB/auth/authorization/PHI/billing/deploy/package
  dependency は変更不要。audit/live DB/external send/secret/push/destructive operation 不変。
- 検証: targeted patient-context retry action scan 0件。focused patient-context vitest
  3 files / 42 tests green。scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit e6e73fa4。
- 残課題: R25 は partial。残りの ErrorState retry action は段階移行を継続。

## 2026-07-05 R25-prescription 901c4276

- 分類: pattern-inconsistency / ErrorState retry action convergence
- 対象: `src/app/(dashboard)/prescriptions/[id]/prescription-detail-content.tsx`,
  `src/app/(dashboard)/prescriptions/qr-drafts/[id]/page.tsx`
- 実施: prescription detail / QR draft / QR draft case-list の ErrorState 3箇所を
  `action={{ label: '再読み込み', onClick }}` から `onRetry` + `retryLabel` へ移行。
  case-list は `retryVariant="outline"` + `retrySize="sm"` で外観維持。
- 挙動変更: なし。表示ラベル、refetch handler、secondary back action、false-empty-safe
  error branch、prescription/QR draft/case-list query behavior は不変。
- 安全: UI presentation/refactor のみ。product API/DB/auth/authorization/PHI/billing/deploy/package
  dependency は変更不要。audit/live DB/external send/secret/push/destructive operation 不変。
- 検証: targeted prescription retry action scan 0件。focused prescription/QR draft vitest
  2 files / 15 tests green。scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 901c4276。
- 残課題: R25 は partial。残りの ErrorState retry action は段階移行を継続。

## 2026-07-05 R25-admin-alert-audit 47cbe882

- 分類: pattern-inconsistency / ErrorState retry action convergence
- 対象: `src/app/(dashboard)/admin/alert-rules/page.tsx`,
  `src/app/(dashboard)/admin/dispense-audit-stats/page.tsx`
- 実施: alert rules と dispense audit stats の ErrorState 2箇所を
  `action={{ label: '再読み込み', onClick }}` から `onRetry` + `retryLabel` へ移行。
- 挙動変更: なし。表示ラベル、refetch handler、false-empty-safe error branch、
  alert-rule/dispense-audit query behavior は不変。
- 安全: UI presentation/refactor のみ。product API/DB/auth/authorization/PHI/billing/deploy/package
  dependency は変更不要。audit/live DB/external send/secret/push/destructive operation 不変。
- 検証: targeted admin alert/audit retry action scan 0件。focused alert/audit vitest
  2 files / 21 tests green。scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 47cbe882。
- 残課題: R25 は partial。残りの ErrorState retry action は段階移行を継続。

## 2026-07-04 R25-admin-credential-template ad234b5a

- 分類: pattern-inconsistency / ErrorState retry action convergence
- 対象: `src/app/(dashboard)/admin/document-templates/template-content.tsx`,
  `src/app/(dashboard)/admin/pharmacist-credentials/pharmacist-credentials-content.tsx`
- 実施: document templates と pharmacist credentials の ErrorState 2箇所を
  `action={{ label: '再読み込み', onClick }}` から `onRetry` + `retryLabel` へ移行。
- 挙動変更: なし。表示ラベル、refetch handler、false-empty-safe error branch、
  document-template/pharmacist-credential query behavior は不変。
- 安全: UI presentation/refactor のみ。product API/DB/auth/authorization/PHI/billing/deploy/package
  dependency は変更不要。audit/live DB/external send/secret/push/destructive operation 不変。
- 検証: targeted admin credential/template retry action scan 0件。focused template/credential vitest
  2 files / 26 tests green。scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit ad234b5a。
- 残課題: R25 は partial。残りの ErrorState retry action は段階移行を継続。

## 2026-07-04 R25-admin-panel e56519ab

- 分類: pattern-inconsistency / ErrorState retry action convergence
- 対象: `src/app/(dashboard)/admin/staff/staff-kpi-panel.tsx`,
  `src/app/(dashboard)/admin/facility-standards/facility-standards-content.tsx`
- 実施: staff KPI と facility standards の ErrorState 2箇所を
  `action={{ label: '再読み込み', onClick }}` から `onRetry` + `retryLabel` へ移行。
- 挙動変更: なし。表示ラベル、refetch handler、false-zero/false-judgement-safe error branch、
  staff/facility query behavior は不変。
- 安全: UI presentation/refactor のみ。product API/DB/auth/authorization/PHI/billing/deploy/package
  dependency は変更不要。audit/live DB/external send/secret/push/destructive operation 不変。
- 検証: targeted admin panel retry action scan 0件。focused staff/facility vitest 2 files / 6 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit e56519ab。
- 残課題: R25 は partial。残りの ErrorState retry action は段階移行を継続。

## 2026-07-04 R25-work-coordination fc496fa2

- 分類: pattern-inconsistency / ErrorState retry action convergence
- 対象: `src/app/(dashboard)/tasks/tasks-content.tsx`,
  `src/app/(dashboard)/handoff/handoff-workspace.tsx`
- 実施: tasks list と handoff comment-feed の ErrorState 2箇所を
  `action={{ label: '再読み込み', onClick }}` から `onRetry` + `retryLabel` へ移行。
- 挙動変更: なし。表示ラベル、retry/refetch handler、false-empty-safe error branch、
  tasks/handoff query behavior は不変。
- 安全: UI presentation/refactor のみ。product API/DB/auth/authorization/PHI/billing/deploy/package
  dependency は変更不要。audit/live DB/external send/secret/push/destructive operation 不変。
- 検証: targeted tasks/handoff retry action scan 0件。focused tasks/handoff vitest 2 files / 33 tests green
  （handoff test の既存 React act warning あり）。scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit fc496fa2。
- 残課題: R25 は partial。残りの ErrorState retry action は段階移行を継続。

## 2026-07-04 R25-admin-analytics-stale e45a869e

- 分類: pattern-inconsistency / ErrorState retry action convergence
- 対象: `src/app/(dashboard)/admin/analytics/analytics-content.tsx`
- 実施: admin analytics stale-data ErrorState 2箇所を
  `action={{ label: '再読み込み', onClick, variant: 'outline', size: 'sm' }}` から
  `onRetry` + `retryLabel` + `retryVariant` + `retrySize` へ移行。
- 挙動変更: なし。表示ラベル、refetch handler、live-region、stale-data copy、outline/sm button、
  billing analytics/resource-map query behavior は不変。
- 安全: UI presentation/refactor のみ。product API/DB/auth/authorization/PHI/billing/deploy/package
  dependency は変更不要。audit/live DB/external send/secret/push/destructive operation 不変。
- 検証: targeted admin analytics retry action scan 0件。focused admin analytics vitest 1 file / 9 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit e45a869e。
- 残課題: R25 は partial。残りの ErrorState retry action は段階移行を継続。

## 2026-07-04 R25-admin-metrics 90388a2e

- 分類: pattern-inconsistency / ErrorState retry action convergence
- 対象: `src/app/(dashboard)/admin/metrics/metrics-dashboard-content.tsx`
- 実施: admin metrics の ErrorState 2箇所を
  `action={{ label: '再読み込み', onClick }}` から `onRetry` + `retryLabel` へ移行。
  stale-data retry は `retryVariant="outline"` + `retrySize="sm"` で外観維持。
- 挙動変更: なし。表示ラベル、refetch handler、live-region、stale-data copy、outline/sm button、
  admin metrics query behavior は不変。
- 安全: UI presentation/refactor のみ。product API/DB/auth/authorization/PHI/billing/deploy/package
  dependency は変更不要。audit/live DB/external send/secret/push/destructive operation 不変。
- 検証: targeted admin metrics retry action scan 0件。focused admin metrics vitest 1 file / 7 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 90388a2e。
- 残課題: R25 は partial。残りの ErrorState retry action は段階移行を継続。

## 2026-07-04 R25-statistics 00344de5

- 分類: pattern-inconsistency / ErrorState retry action convergence
- 対象: `src/app/(dashboard)/statistics/statistics-content.tsx`,
  `src/components/ui/error-state.tsx`
- 実施: `ErrorState` に `retrySize` を追加し、statistics KPI の ErrorState 2箇所を
  `action={{ label: '再読み込み', onClick }}` から `onRetry` + `retryLabel` へ移行。
  stale-data retry は `retryVariant="outline"` + `retrySize="sm"` で外観維持。
- 挙動変更: なし。表示ラベル、refetch handler、live-region、stale-data copy、outline/sm button、
  statistics query behavior は不変。
- 安全: UI presentation/refactor のみ。product API/DB/auth/authorization/PHI/billing/deploy/package
  dependency は変更不要。audit/live DB/external send/secret/push/destructive operation 不変。
- 検証: targeted statistics retry action scan 0件。focused ErrorState/statistics vitest 2 files / 24 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 00344de5。
- 残課題: R25 は partial。残りの ErrorState retry action は段階移行を継続。

## 2026-07-04 R25-route-global-boundary 823307ae

- 分類: pattern-inconsistency / ErrorState retry action convergence
- 対象: `src/components/ui/error-state.tsx`, `src/app/global-error.tsx`,
  `src/components/ui/route-error-boundary.tsx`
- 実施: `ErrorState` に `retryVariant` を追加し、global/route error boundary の
  `action={{ label: '再試行', onClick, variant: 'outline' }}` 2箇所を
  `onRetry` + `retryVariant="outline"` へ移行。outline維持の回帰テストを追加。
- 挙動変更: なし。表示ラベル、retry handler、outline variant、secondary dashboard link、
  Sentry capture、digest表示、error-boundary behavior は不変。
- 安全: UI presentation/refactor のみ。product API/DB/auth/authorization/PHI/billing/deploy/package
  dependency は変更不要。audit/live DB/external send/secret/push/destructive operation 不変。
- 検証: targeted route/global retry action scan 0件。focused ErrorState vitest 1 file / 8 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 823307ae。
- 残課題: R25 は partial。残りの ErrorState retry action は段階移行を継続。

## 2026-07-04 R25-schedule-calendar 7461d41f

- 分類: pattern-inconsistency / ErrorState retry action convergence
- 対象: `src/app/(dashboard)/schedules/calendar-view.tsx`
- 実施: schedule calendar の ErrorState 2箇所を
  `action={{ label: '再読み込み', onClick }}` から `onRetry` + `retryLabel` へ移行。
- 挙動変更: なし。表示ラベル、refetch handler、error branch、billing preview/schedule query behavior は不変。
- 安全: UI presentation/refactor のみ。product API/DB/auth/authorization/PHI/billing/deploy/package
  dependency は変更不要。schedule/audit/live DB/external send/secret/push/destructive operation 不変。
- 検証: targeted retry action scan 0件。focused calendar-view vitest 2 files / 15 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 7461d41f。
- 残課題: R25 は partial。残りの ErrorState retry action は段階移行を継続。

## 2026-07-04 R25-dispense-patient-list 596afee7

- 分類: pattern-inconsistency / ErrorState retry action convergence
- 対象: `src/components/features/dispense-workbench/patient-list-panel.tsx`
- 実施: dispense workbench patient-list の ErrorState 1箇所を
  `action={{ label: '再読み込み', onClick }}` から `onRetry` + `retryLabel` へ移行。
- 挙動変更: なし。表示ラベル、retryLoad handler、error branch は不変。EmptyState action はR25対象外で維持。
- 安全: UI presentation/refactor のみ。product API/DB/auth/authorization/PHI/billing/deploy/package
  dependency は変更不要。dispense query/mutation/audit/live DB/external send/secret/push/destructive operation 不変。
- 検証: targeted ErrorState retry action scan 0件。focused workbench color-token vitest 1 file / 14 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 596afee7。
- 残課題: R25 は partial。残りの ErrorState retry action は段階移行を継続。

## 2026-07-04 R25-admin-data-explorer b9095cfa

- 分類: pattern-inconsistency / ErrorState retry action convergence
- 対象: `src/app/(dashboard)/admin/data-explorer/data-explorer-content.tsx`
- 実施: admin data-explorer の ErrorState 2箇所を
  `action={{ label: '再読み込み', onClick }}` から `onRetry` + `retryLabel` へ移行。
- 挙動変更: なし。表示ラベル、refetch handler、error branch、query behavior は不変。
- 安全: UI presentation/refactor のみ。product API/DB/auth/authorization/PHI/billing/deploy/package
  dependency は変更不要。admin data-explorer read/edit/audit/live DB/external send/secret/push/destructive operation 不変。
- 検証: targeted retry action scan 0件。focused admin data-explorer vitest 1 file / 9 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit b9095cfa。
- 残課題: R25 は partial。残りの ErrorState retry action は段階移行を継続。

## 2026-07-04 R25-admin-pharmacy-sites 176035a0

- 分類: pattern-inconsistency / ErrorState retry action convergence
- 対象: `src/app/(dashboard)/admin/pharmacy-sites/pharmacy-sites-content.tsx`
- 実施: admin pharmacy-sites の ErrorState 2箇所を
  `action={{ label: '再読み込み', onClick }}` から `onRetry` + `retryLabel` へ移行。
- 挙動変更: なし。表示ラベル、refetch handler、error branch、query behavior は不変。
- 安全: UI presentation/refactor のみ。product API/DB/auth/authorization/PHI/billing/deploy/package
  dependency は変更不要。pharmacy-site/config save/audit/live DB/external send/secret/push/destructive operation 不変。
- 検証: targeted retry action scan 0件。focused admin pharmacy-sites vitest 1 file / 21 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 176035a0。
- 残課題: R25 は partial。残りの ErrorState retry action は段階移行を継続。

## 2026-07-04 R25-admin-business-holidays e42242d2

- 分類: pattern-inconsistency / ErrorState retry action convergence
- 対象: `src/app/(dashboard)/admin/business-holidays/business-holidays-content.tsx`
- 実施: admin business-holidays の ErrorState 2箇所を
  `action={{ label: '再読み込み', onClick }}` から `onRetry` + `retryLabel` へ移行。
- 挙動変更: なし。表示ラベル、refetch handler、error branch、query behavior は不変。
- 安全: UI presentation/refactor のみ。product API/DB/auth/authorization/PHI/billing/deploy/package
  dependency は変更不要。business-holiday save/audit/live DB/external send/secret/push/destructive operation 不変。
- 検証: targeted retry action scan 0件。focused admin business-holidays vitest 1 file / 14 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit e42242d2。
- 残課題: R25 は partial。残りの ErrorState retry action は段階移行を継続。

## 2026-07-04 R25-admin-drug-masters 06784c51

- 分類: pattern-inconsistency / ErrorState retry action convergence
- 対象: `src/app/(dashboard)/admin/drug-masters/drug-master-content.tsx`
- 実施: admin drug-masters の ErrorState 3箇所を
  `action={{ label: '再読み込み', onClick }}` から `onRetry` + `retryLabel` へ移行。
- 挙動変更: なし。表示ラベル、refetch handler、error branch、query behavior は不変。
- 安全: UI presentation/refactor のみ。product API/DB/auth/authorization/PHI/billing/deploy/package
  dependency は変更不要。drug master import/adoption/audit/live DB/external send/secret/push/destructive operation 不変。
- 検証: targeted retry action scan 0件。focused admin drug-masters vitest 1 file / 86 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 06784c51。
- 残課題: R25 は partial。残りの ErrorState retry action は段階移行を継続。

## 2026-07-04 R25-admin-operating-hours a33d3c0b

- 分類: pattern-inconsistency / ErrorState retry action convergence
- 対象: `src/app/(dashboard)/admin/operating-hours/operating-hours-content.tsx`
- 実施: admin operating-hours の ErrorState 3箇所を
  `action={{ label: '再読み込み', onClick }}` から `onRetry` + `retryLabel` へ移行。
- 挙動変更: なし。表示ラベル、refetch handler、error branch、query behavior は不変。
- 安全: UI presentation/refactor のみ。product API/DB/auth/authorization/PHI/billing/deploy/package
  dependency は変更不要。operating-hours save/audit/live DB/external send/secret/push/destructive operation 不変。
- 検証: targeted retry action scan 0件。focused admin operating-hours vitest 1 file / 11 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit a33d3c0b。
- 残課題: R25 は partial。残りの ErrorState retry action は段階移行を継続。

## 2026-07-04 R25-prescription-intake b9a55665

- 分類: pattern-inconsistency / ErrorState retry action convergence
- 対象: `src/app/(dashboard)/prescriptions/new/prescription-intake-form.tsx`
- 実施: prescription intake の ErrorState 4箇所を
  `action={{ label: '再読み込み', onClick }}` から `onRetry` + `retryLabel` へ移行。
- 挙動変更: なし。表示ラベル、refetch handler、error branch、lookup behavior は不変。
- 安全: UI presentation/refactor のみ。product API/DB/auth/authorization/PHI/billing/deploy/package
  dependency は変更不要。prescription payload/audit/live DB/external send/secret/push/destructive operation 不変。
- 検証: targeted retry action scan 0件。focused prescription intake vitest 2 files / 17 tests green
  （既存 React `act(...)` warning あり）。scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit b9a55665。
- 残課題: R25 は partial。残りの ErrorState retry action は段階移行を継続。

## 2026-07-04 R25-patient-medications 06430afb

- 分類: pattern-inconsistency / ErrorState retry action convergence
- 対象: `src/app/(dashboard)/patients/[id]/medications/medications-content.tsx`
- 実施: patient medications の ErrorState 5箇所を
  `action={{ label: '再読み込み', onClick }}` から `onRetry` + `retryLabel` へ移行。
- 挙動変更: なし。表示ラベル、refetch handler、error branch、query behavior は不変。
- 安全: UI presentation/refactor のみ。product API/DB/auth/authorization/PHI/billing/deploy/package
  dependency は変更不要。audit/live DB/external send/secret/push/destructive operation 不変。
- 検証: targeted retry action scan 0件。focused patient medications vitest 1 file / 27 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 06430afb。
- 残課題: R25 は partial。残りの ErrorState retry action は段階移行を継続。

## 2026-07-04 R25-admin-performance 1ea41977

- 分類: pattern-inconsistency / ErrorState retry action convergence
- 対象: `src/app/(dashboard)/admin/performance/page.tsx`
- 実施: admin performance の ErrorState 5箇所を
  `action={{ label: '再読み込み', onClick }}` から `onRetry` + `retryLabel` へ移行。
- 挙動変更: なし。表示ラベル、refetch handler、error branch、query behavior は不変。
- 安全: UI presentation/refactor のみ。product API/DB/auth/authorization/PHI/billing/deploy/package
  dependency は変更不要。audit/live DB/external send/secret/push/destructive operation 不変。
- 検証: targeted retry action scan 0件。focused admin performance vitest 1 file / 5 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 1ea41977。
- 残課題: R25 は partial。残りの ErrorState retry action は段階移行を継続。

## 2026-07-04 R32-final bcf516b7

- 分類: test refactor / QueryClient wrapper convergence
- 対象: dispense workbench mutations / visit brief card / patient documents panel tests
- 実施: R32 最終3テストの local `QueryClient`/`QueryClientProvider` wrapper を
  `createQueryClientWrapper` へ収束。client spy/cache assertion は `createTestQueryClient` を使用。
- 挙動変更: なし。retry-disabled test defaults を維持し、product runtime は不変。
- 安全: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は変更不要。
  query/mutation/org header/audit/server behavior 不変。
- 検証: focused final R32 vitest 3 files / 26 tests green。scoped eslint/prettier/diff-check
  green。`pnpm typecheck` green。R32 direct QueryClient wrapper scan 0件。
- レビュー: self-verified。commit bcf516b7。
- 残課題: R32 は完了。broader Plans.md objective は継続。

## 2026-07-04 R32-patient 92be298a

- 分類: test refactor / QueryClient wrapper convergence
- 対象: saved views / consent records / residual adjustment / visit record form tests
- 実施: patient/visit 4テストの local `QueryClient`/`QueryClientProvider` wrapper を
  `createQueryClientWrapper` へ収束。
- 挙動変更: なし。retry-disabled test defaults を維持し、product runtime は不変。
- 安全: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は変更不要。
  query/mutation/org header/audit/server behavior 不変。
- 検証: focused patient/visit vitest 4 files / 46 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 92be298a。
- 残課題: R32 は残りの QueryClient wrapper 移行が継続。

## 2026-07-04 R32-analytics 85f7963d

- 分類: test refactor / QueryClient wrapper convergence
- 対象: admin analytics / operations insights / template body editor / statistics tests
- 実施: analytics/statistics 4テストの local `QueryClient`/`QueryClientProvider` wrapper を
  `createQueryClientWrapper` へ収束。refetch/rerender制御が必要な箇所は `createTestQueryClient` を使用。
- 挙動変更: なし。retry-disabled test defaults を維持し、product runtime は不変。
- 安全: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は変更不要。
  query/mutation/org header/audit/server behavior 不変。
- 検証: focused analytics/statistics vitest 4 files / 33 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 85f7963d。
- 残課題: R32 は残りの QueryClient wrapper 移行が継続。

## 2026-07-04 R32-admin-metrics d1848de5

- 分類: test refactor / QueryClient wrapper convergence
- 対象: admin metrics / capacity / contact profiles / pharmacy cooperation setup tests
- 実施: admin 4テストの local `QueryClient`/`QueryClientProvider` wrapper を
  `createQueryClientWrapper` へ収束。refetch制御が必要な metrics は `createTestQueryClient` を使用。
- 挙動変更: なし。retry-disabled test defaults を維持し、product runtime は不変。
- 安全: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は変更不要。
  query/mutation/org header/audit/server behavior 不変。
- 検証: focused admin vitest 4 files / 40 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit d1848de5。
- 残課題: R32 は残りの QueryClient wrapper 移行が継続。

## 2026-07-04 R32-schedules 0ec765bf

- 分類: test refactor / QueryClient wrapper convergence
- 対象: route compare / emergency route / schedule drawer / nav badges tests
- 実施: schedule/nav 4テストの local `QueryClient`/`QueryClientProvider` wrapper を
  `createQueryClientWrapper` へ収束。明示 client が必要な箇所は `createTestQueryClient` を使用。
- 挙動変更: なし。retry-disabled test defaults を維持し、product runtime は不変。
- 安全: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は変更不要。
  query/mutation/org header/audit/server behavior 不変。
- 検証: focused schedule/nav vitest 4 files / 40 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 0ec765bf。
- 残課題: R32 は残りの QueryClient wrapper 移行が継続。

## 2026-07-04 R32-reports 1258009e

- 分類: test refactor / QueryClient wrapper convergence
- 対象: interprofessional share / print hub / report-share workspace / handoff workspace tests
- 実施: reports/handoff 4テストの local `QueryClient`/`QueryClientProvider` wrapper を
  `createQueryClientWrapper` へ収束。cache inspection が必要な print hub は `createTestQueryClient` を使用。
- 挙動変更: なし。retry-disabled test defaults を維持し、product runtime は不変。
- 安全: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は変更不要。
  query/mutation/org header/audit/server behavior 不変。
- 検証: focused reports/handoff vitest 4 files / 98 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 1258009e。
- 残課題: R32 は残りの QueryClient wrapper 移行が継続。

## 2026-07-04 R32-flow cdf6067a

- 分類: test refactor / QueryClient wrapper convergence
- 対象: select-site / select-mode / calendar-view / schedule-day-planner-hooks tests
- 実施: select/schedule 4テストの local `QueryClient`/`QueryClientProvider` wrapper を
  `createQueryClientWrapper` へ収束。
- 挙動変更: なし。retry-disabled test defaults を維持し、product runtime は不変。
- 安全: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は変更不要。
  query/mutation/org header/audit/server behavior 不変。
- 検証: focused select/schedule vitest 4 files / 19 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit cdf6067a。
- 残課題: R32 は残りの QueryClient wrapper 移行が継続。

## 2026-07-04 R32-shared 96e099e9

- 分類: test refactor / QueryClient wrapper convergence
- 対象: shared viewer / partner cooperation billing / comment thread / mention input tests
- 実施: shared/comment/billing 4テストの local `QueryClient`/`QueryClientProvider` wrapper を
  `createQueryClientWrapper` へ収束。cache inspection が必要な1箇所は `createTestQueryClient` を使用。
- 挙動変更: なし。retry-disabled test defaults を維持し、product runtime は不変。
- 安全: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は変更不要。
  query/mutation/org header/audit/server behavior 不変。
- 検証: focused shared/comment/billing vitest 4 files / 35 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 96e099e9。
- 残課題: R32 は残りの QueryClient wrapper 移行が継続。

## 2026-07-04 R32-visits e7965d31

- 分類: test refactor / QueryClient wrapper convergence
- 対象: patient structured-care / handoff confirm / visit reflected fields / voice memo tests
- 実施: patient/visit 4テストの local `QueryClient`/`QueryClientProvider` wrapper を
  `createQueryClientWrapper` へ収束。
- 挙動変更: なし。retry-disabled test defaults を維持し、product runtime は不変。
- 安全: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は変更不要。
  query/mutation/org header/audit/server behavior 不変。
- 検証: focused patient/visit vitest 4 files / 15 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit e7965d31。
- 残課題: R32 は残りの QueryClient wrapper 移行が継続。

## 2026-07-04 R32-admin-ops b92abbfb

- 分類: test refactor / QueryClient wrapper convergence
- 対象: operating-hours / incidents / institutions / external-professionals tests
- 実施: admin operations 4テストの local `QueryClient`/`QueryClientProvider` wrapper を
  `createQueryClientWrapper` へ収束。
- 挙動変更: なし。retry-disabled test defaults を維持し、product runtime は不変。
- 安全: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は変更不要。
  query/mutation/org header/audit/server behavior 不変。
- 検証: focused admin operations vitest 4 files / 60 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit b92abbfb。
- 残課題: R32 は残りの QueryClient wrapper 移行が継続。

## 2026-07-04 R32-admin-docs 7d9ef657

- 分類: test refactor / QueryClient wrapper convergence
- 対象: inventory-forecast / dispense-audit-stats / document-template tests
- 実施: admin/document 4テストの local `QueryClient`/`QueryClientProvider` wrapper を
  `createQueryClientWrapper` へ収束。
- 挙動変更: なし。retry-disabled test defaults を維持し、product runtime は不変。
- 安全: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は変更不要。
  query/mutation/org header/audit/server behavior 不変。
- 検証: focused admin/document vitest 4 files / 31 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 7d9ef657。
- 残課題: R32 は残りの QueryClient wrapper 移行が継続。

## 2026-07-04 R32-admin-2 0bd86e3f

- 分類: test refactor / QueryClient wrapper convergence
- 対象: alert-rules signal/page / vehicles / audit-logs tests
- 実施: admin 4テストの local `QueryClient`/`QueryClientProvider` wrapper を
  `createQueryClientWrapper` へ収束。
- 挙動変更: なし。retry-disabled test defaults を維持し、product runtime は不変。
- 安全: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は変更不要。
  query/mutation/org header/audit/server behavior 不変。
- 検証: focused admin vitest 4 files / 40 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 0bd86e3f。
- 残課題: R32 は残りの QueryClient wrapper 移行が継続。

## 2026-07-04 R32-admin fa0fa895

- 分類: test refactor / QueryClient wrapper convergence
- 対象: business-holidays / facilities / pharmacy-sites / service-areas tests
- 実施: admin 4テストの local `QueryClient`/`QueryClientProvider` wrapper を
  `createQueryClientWrapper` へ収束。
- 挙動変更: なし。retry-disabled test defaults を維持し、product runtime は不変。
- 安全: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は変更不要。
  query/mutation/org header/audit/server behavior 不変。
- 検証: focused admin vitest 4 files / 61 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit fa0fa895。
- 残課題: R32 は残りの QueryClient wrapper 移行が継続。

## 2026-07-04 R32-platform b8466684

- 分類: test refactor / QueryClient wrapper convergence
- 対象: platform tenant directory / break-glass / audit-log / data-explorer tests
- 実施: 4テストの local `QueryClient`/`QueryClientProvider` wrapper を
  `src/test/query-client-test-utils.tsx` の `createQueryClientWrapper` へ収束。
- 挙動変更: なし。retry-disabled test defaults を維持し、product runtime は不変。
- 安全: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は変更不要。
  query/mutation/org header/audit/server behavior 不変。
- 検証: focused platform tenant vitest 4 files / 9 tests green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit b8466684。
- 残課題: R32 は残りの QueryClient wrapper 移行が継続。

## 2026-07-04 R05 f2fe83df

- 分類: refactor / import CSV helper convergence
- 対象: `drug-master-import/shared.ts`, medical institution / care service MHLW open-data importers
- 実施: BOM除去・空行除外・quoted delimiter split・trim・safe cell read を共有 helper 化し、
  2 importer の local `stripBom`/`csvRows`/`readCsvCell` 複製を削除。
- 挙動変更: なし。既存の空行除外、BOM除去、quoted comma、header/cell normalize は保持。
- 安全: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は変更不要。
  fetch policy/URL allowlist/zip limit/upsert/server behavior 不変。
- 検証: focused import vitest 3 files / 46 tests green。scoped eslint/prettier/diff-check green。
  `pnpm typecheck` green。
- レビュー: self-verified。commit f2fe83df。
- 残課題: broad Plans.md objective は継続。

## 2026-07-04 R10-next-action 3d23dc1b

- 分類: refactor / workspace rail helper convergence
- 対象: handoff/report-share workspace helpers
- 実施: 監査キュー優先の `buildWorkspaceNextAction` 準コピー2箇所を
  `buildDailyOpsNextAction` 呼び出しへ収束。画面別 no-audit fallback は props で保持。
- 挙動変更: なし。handoff は `/schedules`、report-share は先頭訪問 focus URL を維持。
- 安全: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は変更不要。
  query/mutation/org header/audit/server behavior 不変。
- 検証: focused daily-ops/handoff/report vitest 3 files / 55 tests green（既存 act warning は出力あり）。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 3d23dc1b。
- 残課題: broad Plans.md objective は継続。R10 は ac8aa952 + 3d23dc1b で完了。

## 2026-07-04 R10-blocked-reasons ac8aa952

- 分類: refactor / workspace rail helper convergence
- 対象: `src/lib/workspace/daily-ops-rail.ts` + dashboard/handoff/report/schedule/settings/
  billing/admin/patients/visits rail consumers
- 実施: `buildDailyOpsBlockedReasons` の入力型を `blocked_reasons` payload へ一般化し、
  9箇所の `blocked_reasons -> BlockedReason[]` 手組み mapper を共有 helper に置換。
- 挙動変更: なし。category/age/action label/action href の変換結果は保持。
- 安全: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は変更不要。
  query/mutation/org header/audit/server behavior 不変。
- 検証: focused rail consumer vitest 10 files / 152 tests green（既存 act warning は出力あり）。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit ac8aa952。
- 残課題: R10 の `buildWorkspaceNextAction` 準コピーは別 follow-up。broad Plans.md objective は継続。

## 2026-07-04 R09 63b98972

- 分類: refactor / cockpit action rail guard convergence
- 対象: `src/components/features/workspace/action-rail.tsx`,
  handoff/schedule/report-share workspaces
- 実施: loading/error wrapper を `GuardedWorkspaceActionRail` に集約し、3画面のコピペを props
  差分（test id / aria / report-share error detail）だけへ縮小。
- 挙動変更: なし。既存の loading test id、aria label、エラー文言、再試行、report-share detail は保持。
- 安全: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は変更不要。
  copy は PHI-free、query/mutation/org header/server behavior 不変。
- 検証: focused workspace vitest 3 files / 75 tests green（既存 act warning は出力あり）。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` green。
- レビュー: self-verified。commit 63b98972。
- 残課題: broad Plans.md objective は継続。未関係 dirty は対象外。

## 2026-07-03 台帳再編（このコミット）

- 分類: docs/ops
- 実施: ops/refactor を 3+1 ファイル体制へ再編（STATE/BACKLOG/LOG + CODE_MAP）。
  旧11台帳+ULTRACODE 系8+workflow スクリプト4を archive/ へ git mv（履歴保全）。
  BACKLOG.md = A3 統合バックログ + A1/A2 候補 + VG1 裁定(A1-GEO flagged)。
  P0 は .agent-loop/BLOCKED.md へ一本化（X01 追記）。
- 挙動変更: なし（docs のみ）
- 検証: n/a（ソース非接触）

## 2026-07-03 PERF-01 981f1a58

- 分類: performance / behavior-preserving API internals
- 対象: `src/app/api/pharmacy-drug-stocks/bulk/route.ts` + focused route test
- 実施: preview/audit row→operation 照合の `operations.find(rowNumber)` を first-wins
  `operationByRowNumber` Map に置換。summary audit 側の同種探索も同じ Map へ収束。
- 挙動変更: なし。response shape、row order、invalid/unmatched、audit payload、upsert/auth/no-store 不変。
- 検証: baseline focused vitest 18/18 green。post-edit focused vitest 19/19 green（60行 audit row
  mapping regression 追加）。scoped eslint/prettier/diff-check green。`pnpm typecheck` /
  `pnpm typecheck:no-unused` green。
- レビュー: opus APPROVE、claude commit 981f1a58。self-commit なし。

## 2026-07-03 MFA1 f7bf2e97

- 分類: auth/security observability / behavior-preserving log convergence
- 対象: `src/app/api/auth/mfa/recovery/route.ts` + focused route test
- 実施: Cognito 失敗後の recovery-code restore 失敗ログを `console.error` から safe `logger.error`
  へ置換。context は event/route/method/operation のみ、error は logger の `error_name` 抽出のみ。
- 挙動変更: なし。rate-limit、validation、復旧処理、502/503 応答、restore fail-soft 方向は不変。
- 検証: focused vitest 9/9 green。scoped eslint/prettier/diff-check green。`pnpm typecheck` /
  `pnpm typecheck:no-unused` green。secret/token 非包含 negative assert 追加。
- レビュー: opus APPROVE、claude commit f7bf2e97。self-commit なし。

## 2026-07-03 F84 c22c7fe3

- 分類: bug/concurrency / behavior-preserving app-layer serialization
- 対象: `src/app/api/consent-records/route.ts` + focused route test
- 実施: active ConsentRecord の `patient_id+consent_type` 重複チェックを advisory lock +
  tx内再readへ移動。DB migration/partial unique index は追加しない。
- 挙動変更: なし。既存 400 validation error/message、auth、no-store、audit fail-closed は不変。
- 検証: baseline focused vitest 13/13 green。post-edit focused vitest 14/14 green。scoped
  eslint/prettier/diff-check green。`pnpm typecheck` / `pnpm typecheck:no-unused` green。
- レビュー: opus APPROVE、claude commit c22c7fe3。self-commit なし。

## 2026-07-03 CE17 5205fc48

- 分類: performance / daily prescription expiry scan bounding
- 対象: `src/server/jobs/daily/prescriptions.ts` + `src/server/jobs/daily.test.ts`
- 実施: `checkPrescriptionExpiry` の `prescription_expiry_date <= tomorrow` 全履歴 scan を、
  JST 7日前開始〜翌日終了の bounded window へ変更。通知 title/message/recipient/dedupe/processedCount は不変。
- 通知意味論: 直近7日の outage を catch-up し、dedupe_key は intake id のままなので再通知スパムを増やさない。
- レビュー: opus CHANGES_REQUESTED 1件（初回の今日〜翌日窓では D-1/D 2連続欠落時に通知が永久喪失）。
  下限を7日前へ修正し、`formatDateKey` TZ表示ズレは CE20 として BACKLOG 起票。
- 検証: focused `daily.test.ts -t "prescription expiry"` 3/3 green。full `daily.test.ts` 43/43 green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` は並行 A1-CRC FE dirty の `reports/[id]/page.tsx`
  型エラーで blocked（CE17外、該当 lane へ委譲）。
- 最終: opus APPROVE、claude commit 5205fc48。self-commit なし。

## 2026-07-03 R07 f3733036

- 分類: dead-code removal / behavior-preserving cleanup
- 対象: `src/lib/dashboard/home-config.ts` + 自テスト
- 実施: 外部参照0の dashboard home config（358行）と、その config のみを検証していたテスト（95行）を削除。
  `home-link-builders.ts` は18以上の生存 consumer があるため保持。
- 挙動変更: なし。runtime import なし、route/config/script/型のみ参照なし。docs の生きた参照なし、archive 参照のみ残置。
- 検証: export symbol 静的 `rg` 0件。`home-link-builders.test.ts` 4/4 green。scoped eslint green。
  `tsc --noEmit --pretty false` green、home-config 該当エラー grep 0件。
- レビュー: opus APPROVE、claude commit f3733036。self-commit なし。

## 2026-07-03 PERF-02 60469cd1

- 分類: performance / behavior-preserving API internals
- 対象: `src/app/api/dispense-results/route.ts` + focused route test
- 実施: `DispenseResult` 保存の update/create/P2002 fallback を `org_id_task_id_line_id`
  compound unique upsert へ置換。`DispensingDecision` upsert、partial lock、replay、audit/webhook は不変。
- 同値性: create arm は旧 create の `org_id/task_id/line_id + resultData`、update arm は旧 update/fallback update の
  `resultData` のみ。immutable identity は update に載せない。
- 検証: route+workflow vitest 45/45 green。scoped eslint/prettier/diff-check green。
  `pnpm typecheck` green。2行投入で `DispenseResult.upsert` 2回のみを test-lock。
- レビュー: opus APPROVE、claude commit 60469cd1。self-commit なし。

## 2026-07-03 CE20 66d65f99

- 分類: bug/TZ / user-visible notification date
- 対象: `src/server/jobs/daily/prescriptions.ts` + `src/server/jobs/daily.test.ts`
- 実施: 処方箋期限通知 message の日付を process-local `formatDateKey` から JST 固定 `japanDateKey` へ変更。
- 不変: query window / dedupe_key / recipient / link / processedCount / createMany skipDuplicates。
- 検証: focused `daily.test.ts -t "prescription expiry"` 4/4 green。
  `daily.test.ts` + `date-boundary.test.ts` 68/68 green。scoped eslint/prettier/diff-check green。
  `pnpm typecheck` green。
- レビュー: opus APPROVE、claude commit 66d65f99。self-commit なし。

## 2026-07-03 ID-1a report-ready

- 分類: design-spike / Prisma query extension tx feasibility
- 対象: `src/lib/db/display-id-spike.test.ts` + 台帳3ファイル
- 実施: 既存 `PackagingMethodMaster.description` を display_id surrogate とし、実DB disposable
  `display_id_spike_sequence` で Prisma 7.8 `query.$allModels.create/createMany` hook の挙動を検証。
  schema/migration は変更なし。
- 判定: 基準1 FAIL（interactive tx rollback 後、親行は0件だが sequence `next_value=2` が残り別接続漏れを実証）。
  基準2 非tx create PASS、基準3 createMany 注入 PASS、基準4 withOrgContext session 変数非干渉 PASS。
- 推奨: E1 は不採用。親 create と同一 tx を呼び出し側から渡す E2（明示 `allocateDisplayId(tx, ...)`）へ fallback。
- 検証: focused vitest（local 5433 e2e DB 明示）4/4 green。env未設定時は4/4 skipを確認。
  scoped eslint/prettier/diff-check green。
  `pnpm typecheck` green。`pnpm typecheck:no-unused` は Node 4GB heap OOM、8GB指定で green。
- レビュー: report pending。self-commit なし。

## 2026-07-03 ID-1b report-ready

- 分類: infra/db / display_id E2 allocation foundation
- 対象: `prisma/schema/admin.prisma`, new `20260703143000_add_id_sequence`, `src/lib/db/display-id*`,
  `prisma/rls-policies.sql`, `src/tools/rls-policy-contract.test.ts`, 台帳3ファイル
- 実施: `IdSequence` additive table（`@@map("id_sequence")`, PK org_id+prefix, DB defaults/checks）、
  §2表の138件 registry、`allocateDisplayId` / `allocateDisplayIdRange` / `allocateGlobalDisplayId` を実装。
- 安全契約: org scope は tx 必須、global は `__global__` の明示 helper のみ。`Setting` は業務除外、
  `IdSequence` は infrastructure 除外、`cfg` は予約 prefix。RLS は設計通り intentional exclusion。
- 検証: prisma validate green。unit/static 32 pass + DB 5 skip（env unset）。local e2e migration 適用成功、
  DB integration 含む 37/37 green（rollback非リーク・20並行連番・tenant分離・global sentinel）。
  dev `.env` は `localhost:5432/ph_os_dev` だが DB 未起動で `migrate deploy` は P1001（prod接続なし）。
  eslint/format:check/diff-check green。`pnpm typecheck` は4GB OOM、8GB指定で green。
  `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck:no-unused` green。
- レビュー: report pending。self-commit なし。

## 2026-07-03 ID-2-W1 report-ready

- 分類: infra/db / display_id patient-domain wave 1
- 対象: `prisma/schema/patient.prisma`, new `20260703150000_add_patient_display_ids`,
  `tools/scripts/backfill-display-ids.ts` + test, `src/lib/db/display-id.test.ts`, 台帳3ファイル
- 実施: patient.prisma の18 org-scoped model へ nullable `display_id` と `@@unique([org_id, display_id])` を追加。
  migration は既存列非破壊の `ADD COLUMN` + `WHERE display_id IS NOT NULL` partial unique index のみ。
- backfill: registry model args 指定、org別 `created_at ASC, id ASC`、`allocateDisplayIdRange` batch 採番、
  NULLのみ更新、duplicate/format/sequence pre/post check。local e2eで322 rows backfilled。
- addendum: `--max-rows` を model単位ではなく run全体の apply 上限として事前合計チェック+残budget共有へ修正。
- seed確認: `pnpm db:e2e:prepare` / `pnpm db:e2e:seed` green。post-seed dry-run は全18 model null 0・issues 0。
- 検証: prisma validate/db:generate green。focused vitest DB込み 24/24 green。scoped eslint/format green。
  `pnpm typecheck` は4GB OOM、`NODE_OPTIONS=--max-old-space-size=12288 pnpm typecheck` green。
- 備考: dev DB `localhost:5432` は未起動（接続不可）。Patient create-path allocation は今回LOCK外のため follow-up 候補。
- レビュー: report pending。self-commit なし。

## 2026-07-03 ID-2-W2 report-ready

- 分類: infra/db / display_id prescription-domain wave 2
- 対象: `prisma/schema/prescription.prisma`, new `20260703152000_add_prescription_display_ids`,
  `tools/scripts/backfill-display-ids.ts` usage文言, `src/lib/db/display-id.test.ts`, 台帳3ファイル
- 実施: prescription.prisma の18 org-scoped model へ nullable `display_id` と `@@unique([org_id, display_id])` を追加。
  migration は既存列非破壊の `ADD COLUMN` + `WHERE display_id IS NOT NULL` partial unique index のみ。
- backfill: W1 generic script を registry model args で再利用。local e2e dry-run は対象 NULL 1,522 rows・issues 0。
  apply は1,522 rows backfilled、postChecks は全18 model null 0・duplicate 0・invalid 0・sequenceMismatch 0。
- seed確認: `pnpm db:e2e:prepare` / W2 apply / `pnpm db:e2e:seed` / post-seed dry-run green。
- 検証: prisma validate/db:generate green。focused vitest DB込み 29/29 green。scoped eslint/format/diff-check green。
  `NODE_OPTIONS=--max-old-space-size=12288 pnpm typecheck` と `typecheck:no-unused` green。
- レビュー: db_steward read-only LOW（`--max-rows` usage ambiguity）は wording 修正済み。self-commit なし。

## 2026-07-04 ID-2-W3 report-ready

- 分類: infra/db / display_id visit+communication wave 3
- 対象: `prisma/schema/visit.prisma`, `prisma/schema/communication.prisma`,
  new `20260703153000_add_visit_communication_display_ids`, `src/lib/db/display-id.test.ts`, 台帳3ファイル
- 実施: visit.prisma 10 + communication.prisma 14 direct org-scoped model へ nullable `display_id` と
  `@@unique([org_id, display_id])` を追加。migration は W1/W2 同型の `ADD COLUMN` +
  `WHERE display_id IS NOT NULL` partial unique index のみ。
- 方針: `HandoffBoard` は direct org として W3 対象。`HandoffItem` は registry `orgViaParent` /
  `board_id` 経由で direct `org_id` が無いため W3 generic backfill から除外し W7 残余へ。
- backfill: local e2e dry-run は対象 NULL 102 rows・issues 0。apply は102 rows backfilled、
  postChecks は全24 model null 0・duplicate 0・invalid 0・sequenceMismatch 0。seed 後 dry-run も全0。
- 検証: prisma validate/db:generate green。`pnpm db:e2e:prepare` / W3 apply / `pnpm db:e2e:seed` /
  post-seed dry-run green。focused DB vitest 29/29 green。scoped eslint/format/diff-check green。
  `NODE_OPTIONS=--max-old-space-size=12288 pnpm typecheck` と `typecheck:no-unused` green。
- レビュー: db_steward read-only No Findings。self-commit なし。

## 2026-07-04 ID-2-W4 report-ready

- 分類: infra/db / display_id organization-domain wave 4
- 対象: `prisma/schema/organization.prisma`, new `20260703154000_add_organization_display_ids`,
  `src/lib/db/display-id.test.ts`, 台帳3ファイル
- 実施: organization.prisma の direct org-scoped 15 model へ nullable `display_id` と
  `@@unique([org_id, display_id])` を追加。`Organization` と `User` は割当指示どおり対象外。
  migration は W1-W3 同型の `ADD COLUMN` + `WHERE display_id IS NOT NULL` partial unique index のみ。
- backfill: local e2e dry-run は対象 NULL 38 rows・issues 0。apply は38 rows backfilled、
  postChecks は全15 model null 0・duplicate 0・invalid 0・sequenceMismatch 0。seed 再実行後に
  `Membership` が4 rows再作成されたため、所有外の seed caveat として記録し、Membership の再backfill後の
  final dry-run は全15 model null 0・duplicate 0・invalid 0・sequenceMismatch 0。
- 検証: prisma validate/db:generate green。`pnpm db:e2e:prepare` / W4 apply / `pnpm db:e2e:seed` /
  Membership再apply / final dry-run green。focused DB vitest 29/29 green。scoped eslint/format/diff-check green。
  `NODE_OPTIONS=--max-old-space-size=12288 pnpm typecheck` と `typecheck:no-unused` green。
- レビュー: db_steward read-only No Findings + opus 独立レビュー APPROVE（15モデル網羅・additive・既存 unique 非破壊）。
- land: `7e18fcb2`（code+migration+test）+ `a42065fa`（FIX-CATALOG-IDSEQ）。
- 併せ解消した既存欠陥 FIX-CATALOG-IDSEQ: `IdSequence`（ID-1b 0a3b910c 追加の採番カウンタ表）が
  `src/lib/admin/data-explorer-catalog.ts` のカバレッジカタログに未登録で、`db:generate` 鮮度更新後の
  フル `pnpm test` が `classifies every Prisma model exactly once` で赤（過去波は生成 client stale で通過）。
  `backend_only` へ分類 + `DATA_EXPLORER_MODEL_EXCLUSIONS` へ追加（tenant Data Explorer から除外）。
  combined gate green（test 13056 passed / 0 failed、lint green、build/typecheck/no-unused は W4 tree で green）。
- opus follow-up: M-1（`User` は registry scope='org' だが波計画 global(W6)、`CXR2-RLS02` design 判定で確定）と
  L-1（org-scoped registry model の wave 網羅 completeness assertion）を BACKLOG `ID-2-UR` に登録。

## 2026-07-04 ID-2-W5 report-ready

- 分類: infra/db / display_id pharmacy-partnership wave 5
- 対象: `prisma/schema/pharmacy-partnership.prisma`, new
  `20260703155000_add_pharmacy_partnership_display_ids`, `src/lib/db/display-id.test.ts`,
  台帳3ファイル
- 実施: pharmacy-partnership.prisma の direct org-scoped 18 model へ nullable `display_id` と
  `@@unique([org_id, display_id])` を追加。migration は W1-W4 同型の `ADD COLUMN` +
  `WHERE display_id IS NOT NULL` partial unique index のみ。
- 方針: `PatientShareCase` 等の cross-org 共有系も display_id は row の `org_id` による自org採番。
  相手org向け/外部向け番号としては扱わず、既存 `invoice_no` 等の業務番号も置換しない。
- gate強化: W5 wave list に加え、`pharmacy-partnership.prisma` の direct org-scoped model 集合と
  W5 list が一致する completeness guard を追加。
- backfill: local e2e dry-run は対象 NULL 32 rows・issues 0。apply は32 rows backfilled、
  postChecks は全18 model null 0・duplicate 0・invalid 0・sequenceMismatch 0。seed 再実行後の
  final dry-run も全18 model null 0・duplicate 0・invalid 0・sequenceMismatch 0。
- 検証: prisma validate/db:generate green。`pnpm db:e2e:prepare` / W5 dry-run / W5 apply /
  `pnpm db:e2e:seed` / final dry-run green。focused DB vitest 30/30 green。
  scoped eslint/format/diff-check green。`NODE_OPTIONS=--max-old-space-size=12288 pnpm typecheck`
  と `typecheck:no-unused` green。
- レビュー: migration_planner read-only No Findings。test_architect read-only は W5 completeness guard
  追加を推奨、対応済み。opus 独立レビュー APPROVE（findings ゼロ。cross-org は単一org所有設計
  =第2オーナー列皆無・全relation [id, org_id] 参照で display_id 意味論の破綻なしを実証）。
- land: `86d9d273`。全量 gate: test は 13054 passed / 実失敗 0（唯一の Failed Suite は並行 R22-EXEC の
  ファイル削除と vitest collection の race による spurious ENOENT。W5 非起因）。lint green。
- 運用改善: 以後の全量 gate は EDIT-FREEZE broadcast → 全レーン ACK → gate 実行に変更（race 再発防止）。

## 2026-07-03 DR-DUP1 2e0c7fdb

- 分類: bug/data-integrity / defensive validation
- 対象: `src/app/api/dispense-results/route.ts` + focused route test
- 実施: `lines[].line_id` 重複を zod schema の `superRefine` で 400
  `VALIDATION_ERROR` 拒否。transaction 前に止め、同一 `DispenseResult` の非決定的上書きを防止。
- 呼び出し元 recon: 非テスト POST は workbench mutate→adapter の単一路線。
  FE payload は API `count_rows.map(line.id)` 由来で、drag/drop は splice→push の移動。
- 挙動変更: あり（malformed duplicate payload を拒否）。正規 FE 呼び出しの正常系は不変。
- 検証: focused duplicate test green。full `dispense-results/route.test.ts` 43/43 green。scoped eslint green。
- レビュー: opus APPROVE、claude commit 2e0c7fdb。self-commit なし。

## 2026-07-03 までのスライス（要約、詳細は archive/ と git log）

- Claude lane: Wave2 完了バッチ(9 commits) / W3 code-only(C2/E2/E3, 4 commits) /
  W3-E2/E3 残(3 commits) / W3-B4 中核 52ce1f66 / B6 設計 3a39f69e / Plans 台帳 4cf5bc3b
- codex lane: BE-1 036e05e7 / b33c71b8 / RT1 e8027e51 / RR-QP-A 1b9b5366 / RR-QP-B 07cd78a1 /
  JOB1 c025b133 / JOB2 d6cdc59a / CW1 f15f9f98 / BM1 5be6ebca / billing-candidates 9d1567ba
  — 全て opus APPROVE（9d1567ba/b33c71b8 は post-commit 承認）
- gate: 全量 green（test 13033 / lint / format / colors / typecheck / no-unused / build）

## 2026-07-04 R16-MIN da5889f0 / R16-SWEEP 6f26c04c

- 分類: refactor / JST date-key 収斂（codex2 レーン初仕事）
- 対象: patient-home-operations(MIN) + prescription-date-window / date-continuity /
  conference-data-sync / visit-schedule-planner / dispense-workbench-patients(+新規test)(SWEEP)
- 実施: ローカル TOKYO formatter/toISOString().split を正本 japanDateKey / formatUtcDateKey へ収斂。
  意図的 semantics 修正1件: workbench registered_date を JST 業務日付へ（表示+ソートのみ、課金非関与を
  caller 全数 grep で確認）。除外領域(billing/MCS/timeline/export/auth/schema)は list-only。
- 検証: TZ=UTC / TZ=America/New_York で focused 68 tests green。MIN は Intl 設定 byte-identical 証明。
- レビュー: MIN=committer 検証 APPROVE、SWEEP=opus APPROVE（同値性を helper 実装まで遡って裏取り）。
  opus Low: planner:1241-1245 localDateKey は pre-existing・実害なし、将来 sweep 候補（R16 残余に記録）。

## 2026-07-04 R22-EXEC 759b4dbc

- 分類: dead-code removal / 未使用 Yjs 協調編集+room-token チェーン削除（codex3 レーン初仕事）
- 対象: Yjs client 鎖8+専属テスト、room-token route/service+テスト、package.json(yjs/y-protocols/
  y-websocket/lib0 除去、lockfile 純transitive -57行)、rate-limit/protected-post matrix、
  presence.test の cursor-overlay entry、stale docs 5件、【LOCK例外】websocket lambda テスト2件の
  ローカル token fixture 化（削除 service import の随伴修正、アサーション不変）
- プロセス: opus 計画審査(PLAN_CHANGES_REQUESTED→HIGH織込み: presence.test の readFileSync ENOENT 回避)
  → 実装 → opus 実装レビュー APPROVE。UI 到達可能性ゼロを 二重検証（maker rg + opus 独立 rg）。
- 検証: survivor 11 files/276 tests + websocket 2 files/16 tests green。tree-wide typecheck green
  (claude 独立実行)。build は land 後に claude が検証。
- 残: R22b（tools/infra/websocket 一式+infra docs）。
- 教訓: 全量 gate 中のファイル削除が vitest collection と race → EDIT-FREEZE 運用を導入。
  opus 計画審査は src/ 境界のみで tools/ の cross-boundary import を見落とし → maker が検出・FYI 即応で解消。

## 2026-07-04 R08-EXEC cee20c66

- 分類: dead-code removal / 零importer 5モジュール+5テスト削除（922行、codex3）
- evidence: per-symbol rg 0件、/api/health は backup-monitor shadow 実装で無関係、
  localStorage 生キー不在、barrel 再export なし — maker と opus が独立に二重検証。
- 検証: survivor 7 files/64 tests green、typecheck(8GB) green。
- レビュー: opus APPROVE。Low: design-gap-analysis 等の recent-operations stale 記述
  (元々未配線・退行なし) → doc 掃除 follow-up。

## 2026-07-04 ID-2-W6 d2bcde00

- 分類: infra/db / display_id admin+drug 波 + 設計判断（codex xhigh）
- 実施: admin 15 + drug 3 モデルへ W1-W5 同型 additive。**User registry scope='org'→'global' 是正**
  (M-1 解消。staff 表示は Membership.display_id)。DrugAlertRule/IntegrationJob は nullable org_id で
  恒久 defer。**L-1 completeness gate 実装**(wave 所属 or 明示 DEFERRED、双方向検査)。
- backfill: local e2e 25,347 rows(AuditLog 25K 含む)、postChecks 全 green。
- レビュー: opus APPROVE。Medium(運用): 本番高書込表への index 作成は CONCURRENTLY 別ステップ or
  メンテ窓 → BACKLOG `ID-2-OPS` に起票。Low×2(DEFERRED 注記分離・IntegrationJob 根拠記録)は W7 で消化。

## 2026-07-04 FE-FALSEEMPTY-SWEEP 27496917

- 分類: bug/fe / false-empty fail-close 4画面（codex2）
- 実施: QR draft 詳細・conferences カレンダー・conflict-resolution・visit-brief セクションで
  fetch 失敗が空状態/無言消滅に潰れていたのを ErrorState variant=server + refetch / サマリ '—' へ。
- 検証: focused 4 files/27 tests green(error UI+false-empty 文言不在+refetch 配線)。
- レビュー: opus APPROVE(conferences 巨大 diff を git diff -w で分離し3点のみ確認、isLoading→isError
  順序・enabled ガード適正)。list-only 残余: schedules 系 form 副次データ・billing 隣接(BACKLOG 記載)。

## 2026-07-04 R17-SWEEP 0fd02044 / R17-B2 6d5b256d

- 分類: refactor / counted-list envelope の byte-preserving 収斂（codex2）
- 実施: buildCountedListEnvelope 新設(先頭5キー固定・metadata 後置)、8+2 route を収斂。
  cursor 系/meta.has_more 系/複雑 shape は drift 実在のため list-only(R17 stage1 分類)。
- 検証: キー順を helper/route 両層の full-key-order assert でロック。truncated 2変種の数学的
  同値を opus が証明。9 files/86 tests + B2 30 tests green。
- レビュー: opus APPROVE + B2 は committer 検査(opus 事前検証済みパターン)。

## 2026-07-04 R23 batch2 7e7b6bcd / batch3 618c591a

- 分類: refactor / messageFromError 移行 第2-3バッチ（codex3）
- 実施: B2=admin 9ファイル20箇所+route-compare の byte-identical ローカル helper 削除。
  B3=dashboard 8ファイル15箇所(billing candidates は CSV export toast 1箇所のみ=算定非接触を
  opus が hunk 単位確認)。fallback 全 byte 保存。残量 88 hits/26 files(大半機械的候補、継続妥当)。
- レビュー: 両バッチ opus APPROVE。

## 2026-07-04 ID-2-W7 483750cb — schema 波完遂

- 分類: infra/db / display_id 最終 residual 波（codex xhigh）
- 実施: 残余12 direct-org モデル同型 additive。HandoffItem は org_id 列なし→display_id+非unique
  partial index+--include-parent-scoped opt-in の親join backfill(board→org、二重 reject+test固定)。
  DEFERRED は恒久 defer(DrugAlertRule/IntegrationJob=nullable org_id)のみに分離。
- レビュー: opus APPROVE。Low 申し送り: **HandoffItem の親org unique 軸は未解決 — runtime allocator
  配線前に必ず解決**(design doc §11 参照)。injection 面 clean(quoteIdentifier allowlist+parameterized)。
- これで W1-W7 全波 land。org-scoped 137モデル(恒久defer 2除く)に display_id 列+backfill 経路が揃った。

## 2026-07-04 全量 gate ALL GREEN（EDIT-FREEZE 下）

- 手順: EDIT-FREEZE broadcast → 3レーン ACK 確認 → 直列 gate 実行(新運用の初適用、race ゼロ)。
- 結果: db:generate / test 12995 passed(削除スライス反映で母数減は想定どおり) / lint / format:check /
  colors:check / typecheck(8GB) / typecheck:no-unused(8GB) / build 全 PASS。
- 対象: W4 以降の本日 land 全19スライス(display-id W4-W7 / FIX-CATALOG / R21 / R16×2 / R22 / R08 /
  R23×3 / R17×2 / FE-FALSEEMPTY / 台帳4)。

## 2026-07-04 R23 batch4-6 81958346 / 348aea1a / 8c6d746e

- 分類: refactor / messageFromError 移行 B4-B6（codex3）
- B4=admin 5 files 44箇所(初回 report は単一行 grep で multiline 9箇所を取りこぼし
  → opus CHANGES_REQUESTED → 修正 → 私の独立 rg -U で 0 確認)。B5=patient cards 10 files 17箇所。
  B6=schedules/visits/billing 9 files 22箇所(billing hunks は onError toast のみ)。
- 教訓: 同型 sweep の検出は rg -U (multiline) を標準化。残余 ~20 hits は workflow/offline
  大ファイル+非toast sink → B7-RECON で最終評価中。

## 2026-07-04 R24 cursor-pagination 収斂 bdb02a75 (+ee089258 GET 分)

- 分類: refactor / 手組みカーソルページネーション→buildCursorPage（codex2）
- B1=patient-self-reports/cases/qr-scan-drafts/medication-issues、B2=prescription-intakes 2分岐。
  キー順 byte 保持(full-key-order assert)+exact-limit 境界テスト。take/slice 同値・nextCursor
  表示末尾行 id 同値を opus が証明。複雑系(consent-records/visit-records/care-reports/drug-masters/
  offset型 medication-cycles)と billing-candidates は recon 分類で除外のまま(BACKLOG 保留)。
- インシデント: レビューアが検証で git stash 退避→maker 再適用と衝突し一時差分消失
  → 完全復元・データ喪失なし。以後レビューアには working-tree 変更禁止(git show HEAD: 参照)を
  プロンプトで明示する運用に変更。

## 2026-07-04 ID-2-CP-A a564c824 / ee089258 — create-path 配線 第1弾

- 分類: infra/db / 本番 create 経路が IdSequence 消費開始（codex xhigh）
- 対象: SavedView/Task(非dedupe: operational+set-audit rework+conflict-reconfirmation)/PcaPump/
  PcaPumpRental/PcaPumpMaintenanceEvent/MedicationIssue(visit-record 残薬経路含む) の 6モデル、
  route 9+service 1。same-tx 採番・validation 後配置・4xx 非採番(negative assert は allocator
  不呼出を直接検査)・operational-tasks 公開型 byte 同一(billing-evidence 等 caller 無変更)。
- レビュー: opus 全9項目 PASS で APPROVE。272 tests green。
- 追跡(Medium): **dedupe upsert Task 経路(本番最多)は未配線=NULL display_id 続行** → CP-B で
  設計裁定(事前チェック型 vs 事後埋め型 vs 定期 backfill)。
- 運用ノート(Low): same-tx 採番は id_sequence(org,prefix) 行ロックを commit まで保持。Task の
  't' prefix は org 内ホット行 — 長尺 tx の Task create は org 単位で直列化(設計内在の trade-off)。
- medication-issues は CP-A(POST)+R24-B1(GET) の二重レーン共有ファイル → 両 verdict 後に
  合本コミット ee089258 で land(hunk 非干渉を opus 確認)。

## 2026-07-04 R25-B1 bf005a43 / R18 47c80904 / R23-B5〜B7 348aea1a,8c6d746e,786fdec7+40102b7e

- R25-B1(codex2): 手組み retry action 63箇所/50画面 → 既存 onRetry へ(レンダリング完全同値、
  外観保全 site 3件と「再読み込み」系は保全。label prop 化は契約変更として保留)。opus APPROVE。
- R18(codex3): prescriptions FE の重複 DTO 2型を shared へ(純 type-only、committer 全数検査=
  type-only は検査で完全検証可能なため opus 省略の明示例外)。
- R23 B5-B7(codex3): patient cards 17 + schedules/visits 22 + 最終18箇所。B7 は opus が
  「変数名 error 固定の sweep が draftError を見逃し完了宣言が偽」を捕捉→修正。
  **toast 同型 sweep 完了(B1-B7 計~140箇所)**。教訓: 同型検出は変数名非依存+rg -U を標準。
- B7 land 時に committer の add pathspec ミスで 2 コミット分割(786fdec7+40102b7e、内容同一)。

## 2026-07-04 ID-2-CP-C fbbbe905 / FIX-CPA-MATRIX 435a4b0f / Gate #2 ALL GREEN

- CP-C(codex): range 採番配線 = MedicationProfile/PatientLabObservation/ResidualMedication の
  7経路。opus: range 数=実挿入数を全経路実証、dup-skip→採番順序、skipDuplicates 不在。
- Gate #2(EDIT-FREEZE 下): 唯一の失敗 = auth-matrix ハーネスの汎用 tx proxy に $queryRaw 欠落
  (CP-A 配線 route が 500)。診断で route 設計は正(採番は event-create 分岐内)と確定、
  harness 修正+negative assert 追加(435a4b0f)。test 再実行 13007 passed で ALL GREEN 宣言。
- 教訓: create-path 配線スライスは focused suite に加え **cross-cutting matrix テスト
  (protected-post/patch-delete)を必須検証に含める**。
- 凍結中の idle recon 成果: R06/R19/R20/R30/R35/R42/R45(codex2)、R09/R10/R12/R14/R15/R22b(codex3)
  の現存確認・スライス案が揃い、FREEZE 解除後のキューに投入。

## 2026-07-04 R19 1baee9ab / R06 a59d9d4a / R18 系 type-only 3連

- diff-review(R19)・CdsAlert(R06) の BE/FE 重複契約を中立モジュールへ(type-only、re-export で
  consumer 不変)。R06 は CDS 医療安全隣接のため type-only 厳守で実施。committer 全数検査
  (type-only 例外規定)。R42(VisitVehicleResource、subset/full 分離維持)も同型で進行中。

## 2026-07-04 R15-B1 7d1370c0 / FIX 627c46b4

- R15-B1(codex3): admin 17ファイル57箇所の生 x-org-id → buildOrgHeaders 系へ。opus がヘッダ
  集合 byte 同値・fail-closed 非発火・条件分岐保存を全数確認。B2(admin 外 20ファイル)進行中。
- 627c46b4: 私が land した FIX-CPA-MATRIX の 1n literal が typecheck 赤(TS2737) — gate の
  typecheck 通過**後**に land して再検証を怠った committer ミス。BigInt(1) hotfix。
  教訓: gate 後の追加 land は当該ステップ(typecheck 等)の部分再実行をセットにする。

## 2026-07-04 ID-2-CP-B 4eae9ffc — dedupe upsert Task の採番完了

- 設計: fable 裁定 Option B(事後埋め型)。upsert select id/display_id → NULL なら同 tx で
  allocate + CAS updateMany({id, org_id, display_id: null})。count=0 は reread 収束、fail-closed。
  update branch が display_id を書かない不変条件を test 固定(並行安全性の根拠)。
- レビュー: opus APPROVE(公開 Tx 契約不変・caller 40+ 戻り値未消費まで確認・189+22 green)。
- 既存 NULL 行は次回 dedupe touch で自己治癒。race は欠番のみで重複なし(欠番許容設計)。
- display_id create-path: CP-A/B/C で主要経路完了。残 = CP-D(Patient 系 PHI batch)、
  HandoffItem(unique 軸未解決)、derived MedicationIssue(凍結)。次フェーズ ID-3(UI 表示置換) recon 開始。

## 2026-07-04 収斂バッチ群 (R30/R42/R15-B2,B3/R19/R06/R20-B1〜B4)

- R30(77d8efda): formatFileSize 共有化。R42(d77c5829): VisitVehicleResource 契約共有(subset/full 分離)。
- R15: B2=patients/schedules 19ファイル(489b3da9)、B3=workflow/presence 系 9ファイル(fc261eb2)。
  共有 planner-hooks は R42 と合本(65b3ce26)。B3 で「広い解釈で実装→裁定後 revert→report が stale」
  の報告齟齬が発生、opus が実 tree との乖離を検出 → **report には送信時点の git diff --stat を
  添付する運用**を導入。残 13ファイル/89箇所は B4 進行中(nuance 4件のガイダンス付き)。
- R19(1baee9ab)/R06(a59d9d4a): diff-review・CdsAlert の BE/FE 契約を中立モジュールへ(type-only)。
- R20 B1-B4(b268b41e/e646023f/d4573ccb/f023eb6c): no-store アサーション共有 helper + 147ファイル移行。
  残 ~40 同型 + variant 8(list-only)。
- 627c46b4 の教訓は既記載(land 後の部分再gate)。

## 2026-07-04 ID-3-S1 3ce1e5c1 — UI display_id 表示の第1スライス

- 表示規約 helper(src/lib/display-id/display-labels.ts): 可視ラベル=display_id 非空優先、
  fallback は旧 cuid 短縮と byte 同一。**識別子(href/value/key/payload/cursor)は cuid 恒久維持**。
- prescription-intakes API に additive display_id/cycle.display_id 露出(R24 の key-order テスト無干渉)。
- prescription 系 5 画面の可視ラベル置換。§7 外部非露出は external-access payload の JSON 全文
  negative test で固定(mock に display_id を混入させても公開 payload に出ない)。
- レビュー: opus APPROVE(cuid 維持を site 全数検証)。次: S2=schedule/day-view+patient CareCase パネル。
  billing invoice/PDF 番号は §8.2 別レイヤで恒久 keep-out。

## 2026-07-04 R15 完了級 / R20 完了 / R43 開始 / day-board インシデント

- R15 B4(72392917)/B5(b0801994): 計 72ファイル/291箇所の org ヘッダ収斂完了(残 route-compare 1件
  =S2 待ち解放済み、core boundary 2ファイルは恒久除外)。B5 は offline/realtime クリティカル経路
  含む — opus が retry/queue/SSE 不変と条件付き semantics の実装判断(qr-scan/app-header)を検証。
- R20 B5(9d4fbd89)/B6(45ab4804): no-store アサーション共有化完了(204ファイル)。残14は
  variant 8 + mock 干渉 6(helper import が hoisting で 500 化するファイル=理由文書化済み)。
- R43-B1(7e7ebc63): fetch mock helper 共有化開始(11ファイル)。
- **day-board インシデント(d09688a5)**: R20-B6 で私(committer)が maker の「mixed-lane ファイルは
  hunk 分離」フラグを見落とし whole-file staging → S2 の test 期待値が先行 land し HEAD 赤2件。
  detached worktree で赤を実証 → R20-only 内容を再構築して commit、S2 hunk は worktree に復元。
  **教訓(恒久運用): maker が mixed-lane を明示したファイルは git apply --cached による hunk 単位
  staging を必須とする。丸ごと add 禁止。**

## 2026-07-04 ID-3-S2 5ef759db — schedule/patient パネルの display_id 表示

- day-view 共有 helper が display-labels 経由に(fallback byte 同一・「未設定」保持)。
  proposals/day-board/cases API に additive 露出。**redaction は allowlist 再構築で PHI 防御不変**
  (phone/保険番号等の非露出テスト継続)。UI ラベル置換 + cuid 不変条件を直接値比較で test 固定
  (route-compare の React key はむしろ display 由来→cuid へ改善)。opus APPROVE、392 tests green。
- ID-3 残: S3(patient board/detail nested)、S4+(data-explorer 等の設計スライス)。CP-D recon 進行中。

## 2026-07-04 R55 admin pharmacy-sites loading skeleton (codex3, pending review)

- 分類: UI pattern convergence / R55 plain-text loading → skeleton。
- 実施: `src/app/(dashboard)/admin/pharmacy-sites/pharmacy-sites-content.tsx` の薬局一覧 loading と
  保険設定 sheet 内 loading を visible plain text から `SkeletonRows` + named `role=status` に置換。
  `docs/ui-ux-design-guidelines.md` の skeleton loading 方針に沿い、API/DB/auth/billing 挙動は不変。
- テスト: `pharmacy-sites-content.test.tsx` に2件追加し、薬局一覧/保険設定 loading が
  announced skeleton になり旧 visible div text が出ないことを固定。
- 検証: focused Vitest 21/21 green、scoped ESLint green、scoped Prettier check green、
  scoped `git diff --check` green。
- 状態: Claude/Fable review/commit 待ち。W3-B2 migration apply/commit は引き続き user §15 承認待ち。

## 2026-07-04 agmsg Claude removal / R55 admin jobs loading 66ae881e

- 運用: ユーザー指示「claudeは今回使いません。削除してください。」に従い、`phos` から
  `claude` 登録を削除。`despawn.sh` は live actas lock なし、`reset.sh "$(pwd)" claude-code
claude` が 1 registration を削除。最終 `team.sh phos` は `codex` / `codex2` / `codex3` /
  `codex4` の4名のみ。
- land: codex2 の `R55-ADMIN-JOBS-PAGE-SUSPENSE-LOADING-LABEL` を coordinator 再検証後に
  `66ae881e refactor(admin): name jobs route loading status` として scoped commit。
- 変更: `src/app/(dashboard)/admin/jobs/page.tsx` の route-shell `Suspense` fallback を
  screen-specific `Loading label="ジョブ監視を読み込み中..."` に変更し、`page.test.tsx` で
  suspended content 時の named `role=status` と旧 generic status 不在を固定。
- 検証: focused Vitest `2/2` green、targeted ESLint green、targeted Prettier check green、
  targeted `git diff --check` green。
- 次: codex2=`R55-ADMIN-MASTER-PAGE-SUSPENSE-LOADING-LABELS`、codex3=`R55-DRUG-MASTER-IMPORT-HISTORY-LOADING-SKELETON`、
  codex4=backend/business-domain top2 read-only triage を割当済み。

## 2026-07-04 R55 admin master + drug-master loading f0029164 / fd065171

- 分類: UI pattern convergence / R55 loading-state cleanup。
- land: codex2 の `R55-ADMIN-MASTER-PAGE-SUSPENSE-LOADING-LABELS` を coordinator
  再検証後に `f0029164 refactor(admin): name master loading statuses` として scoped commit。
  coordinator 側で `packaging-methods` / `business-holidays` page tests を追加し、
  Suspense fallback の screen-specific `role=status` と旧 generic status 不在を固定。
- land: codex3 の `R55-DRUG-MASTER-IMPORT-HISTORY-LOADING-SKELETON` を coordinator
  再検証後に `fd065171 refactor(drug-masters): skeletonize import history loading` として
  scoped commit。取込履歴 loading を named skeleton にし、error/empty 分岐は維持。
- 検証: admin master focused Vitest `2 files / 4 tests` green、drug-master focused
  Vitest `1 file / 86 tests` green、両スライスとも exact ESLint / exact Prettier check /
  exact `git diff --check` green。
- 安全性: API/DB/auth/authorization/PHI/billing/import/deploy は不変。R22b infra deletion と
  ledger dirt は混ぜず別スライスとして保持。
- 次: codex2=`R55-SCHEDULE-OPERATIONAL-TASKS-LOADING-SKELETON`、codex3=`R21-SONNER-MOCK-SMALL-WAVE` を
  exact path で割当済み。codex4 backend/business-domain triage 待ち。

## 2026-07-04 W3-B9 emergency category fail-closed d535b4f6

- 分類: billing correctness / emergency category source fail-closed。
- land: codex4 read-only triage の candidate1 を coordinator 側で実装し、
  `d535b4f6 fix(billing): fail closed missing emergency rule category` として scoped commit。
- 変更: `rule-engine` は emergency visit の `emergencyCategory` が null/undefined の場合に
  fee2(`other_exacerbation`) を推定しない。manual emergency candidate も同条件では出さない。
  evidence 側 cbef13f4 の `emergency_category_source_missing` blocker と整合。
- 検証: focused Vitest
  `rule-engine.test.ts` + `rule-engine-emergency.test.ts` + `billing-evidence/core.test.ts`
  `3 files / 106 tests` green、targeted ESLint green、targeted Prettier check green、
  targeted `git diff --check` green。
- 安全性: DB/migration/auth/authorization/PHI/API payload は不変。算定根拠欠落時の過請求防止のみ。
- 次: codex4 は W3-B9 candidate2 として `monthly_cap_shared` が rule-engine で未消費の問題を
  read-only で公式根拠確認し、care online 46単位 / medical online 59点の shared cap 実装スライスを提案する。

## 2026-07-04 R55 schedule loading + R21 sonner mock 932d3d22/a54484d3

- land: codex3 の `R21-SONNER-MOCK-SMALL-WAVE` を coordinator 再検証後に
  `932d3d22 test(reports): use shared sonner mock` として scoped commit。
  `report-delivery-dashboard.test.tsx` の local partial `sonner` mock を既存
  `createSonnerToastMock()` helper に置換。test-only で product runtime は不変。
- land: codex2 の `R55-SCHEDULE-OPERATIONAL-TASKS-LOADING-SKELETON` を coordinator
  再検証後に `a54484d3 refactor(schedules): skeletonize operational task loading` として
  scoped commit。再架電タスク / 運用タスク loading を visible plain text から named
  `role=status` skeleton に置換し、false-empty 分離を test 固定。
- 検証: report delivery dashboard focused Vitest `1 file / 9 tests` green、schedule
  operational tasks focused Vitest `1 file / 8 tests` green、両スライスとも exact ESLint /
  exact Prettier check / exact `git diff --check` green。
- 安全性: report slice は test-only。schedule slice は query/action/API/DB/auth/billing/audit/PHI
  と empty-state semantics 不変。R22b infra deletion / AWS timeout/env-catalog dirt は混ぜず別スライスとして保持。

## 2026-07-04 R22b orphaned websocket infra deletion 96ead96b

- land: `R22b` の残りとして、`96ead96b refactor(infra): remove orphaned websocket stack`
  を scoped commit。`tools/infra/websocket/**` の orphaned SAM/Yjs WebSocket stack を削除し、
  infra README / AWS cost docs / env catalog / code map / repository inventory / staging docs /
  AWS client timeout contract から stale websocket/Yjs 参照を除去。
- 検証: `src/tools/aws-client-timeout-contract.test.ts` focused Vitest `1 file / 3 tests` green、
  targeted ESLint green、exact docs/tooling Prettier check green、targeted `git diff --check` green、
  websocket/Yjs/env residual `rg` no live refs、`NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck` green。
- 安全性: app runtime/API/DB/auth/authorization/PHI/audit/billing/deploy は不変。削除対象は tracked
  infra tooling の未参照 stack のみ。`refactor-instructions.md` の広範な Markdown formatting churn は
  commit に含めず未処理として残置。

## 2026-07-04 R21 comment-thread sonner mock 7bb192e9

- 分類: test-harness cleanup / R21 sonner mock residual。
- land: `7bb192e9 test(comments): use shared sonner mock`。`comment-thread.test.tsx` の
  local partial `sonner` mock を既存 `createSonnerToastMock()` helper に置換。
- 検証: focused Vitest `comment-thread.test.tsx` + `sonner-test-utils.test.ts` が
  `2 files / 12 tests` green。exact ESLint / Prettier check / `git diff --check` green。
- 安全性: test-only。runtime component/API/DB/auth/authorization/PHI/audit/billing/deploy/payload は不変。
  `pnpm exec` により一時的に `@aws-sdk/client-apigatewaymanagementapi` の package/lock diff が出たが、
  out-of-scope 副作用として復元済み。

## 2026-07-04 R22 websocket reference refresh 91bca6fb

- 分類: R22 docs/tooling stale-reference cleanup。
- land: `91bca6fb docs(refactor): refresh websocket cleanup references`。
  R22b 後に残っていた WebSocket/Yjs 表現を、現在の presence-only / Redis-backed realtime
  前提へ整合。
- 変更: `REFACTOR_REPORT.md`、`docs/env-catalog.md`、
  `docs/operations/aws-cost-minimal-deployment.md`、`ops/refactor/BACKLOG.md`、
  `ops/refactor/CODE_MAP.md`、`tools/aws-cost-minimal-scenarios.json`。
- 検証: exact docs/tooling Prettier check green、targeted `git diff --check` green。
  `docs/env-catalog.md` の key row count は `134`。
- 安全性: docs/tooling-only。package dependencies、app runtime/API/DB/auth/authorization/PHI/audit/billing/deploy
  は不変。`refactor-instructions.md` の広範な Markdown formatting churn は未コミットのまま残置。

## 2026-07-04 W3-B9 online shared monthly cap ae81a9f7

- 分類: billing correctness / online monthly cap sharing。
- land: `ae81a9f7 fix(billing): apply shared online monthly caps`。
  `monthly_cap_shared` の base rule が explicit `monthly_cap` を持たない場合も、通常月4回・特別患者月8回/週2回の
  shared cap を rule-engine 側で適用。
- 変更: `src/server/services/billing-rules/rule-engine.ts` と
  `src/server/services/billing-rules/rule-engine.test.ts`。医療オンライン59点、介護オンライン46単位、
  null special-cap 値からの fallback を focused test で固定。
- 検証: billing focused Vitest `3 files / 109 tests` green、exact ESLint green、exact
  Prettier check green、targeted `git diff --check` green、full `pnpm typecheck` green。
- 安全性: DB/migration/auth/authorization/API payload/PHI logging/deploy/package dependencies は不変。
  算定上限の過小適用を防ぐ fail-closed 寄りの修正。

## 2026-07-04 Codex CLI 0.142.5 / subagent persona optimization

- 分類: developer/runtime operations / Codex CLI profile and custom-agent persona。
- update: `/Users/yusuke/.nvm/versions/node/v24.16.0/bin/codex update` は成功。
  実バージョンは `codex-cli 0.142.5` のままで、最新版としてローカル整合。
- 変更:
  - `~/.codex/config.toml`: bare `codex` 既定を `gpt-5.5` + low reasoning +
    cached web + `service_tier="fast"` に調整し、`agents.max_depth=1`。
  - `~/.codex/implement.config.toml` / `~/.codex/plan.config.toml`:
    direct subagent delegation only の `max_depth=1`。
  - `~/.codex/agents/*.toml`: 共通 persona contract を v3(Codex 0.142+)へ更新。
  - `.codex/agents/*.toml`: direct child / no recursive fan-out / explicit verdict rule を追加。
  - `AGENTS.md`、`.agent-loop/README.md`、`.codex/config.toml`、本 STATE:
    agmsg/codex2/codex3/codex4/Claude なし、Codex CLI direct subagents ありの運用へ整合。
- 検証: official Codex manual fetch current、Codex strict doctor `16 ok / 0 fail`、
  TOML `63 files` parse ok、Markdown Prettier ok、targeted `git diff --check` ok。
  Prettier は TOML parser 不在のため TOML には使わず、`tomllib` + strict doctor を採用。
- 安全性: product source/API/DB/auth/authorization/PHI/billing/deploy/package dependency は不変。
  ローカル Codex config と operator/persona 文書のみ。

## 2026-07-04 R21 report edit form sonner mock

- 分類: test-harness cleanup / R21 sonner mock residual。
- 実施: `src/components/features/reports/report-edit-form.test.tsx` の local partial `sonner`
  mock を既存 `createSonnerToastMock()` helper へ置換。
- 変更ファイル: `src/components/features/reports/report-edit-form.test.tsx`。
- 削除したコード: test-local の `success` / `error` のみの partial mock。
- 共通化した処理: sonner toast mock surface を `src/test/sonner-test-utils.ts` に統一。
- 挙動変更: なし。test-only で product runtime source は不変。
- FE/BE整合性への影響: なし。
- UI配置への影響: なし。
- 性能への影響: なし。
- 検証: focused Vitest `2 files / 7 tests` green、exact ESLint green、exact
  Prettier check green、targeted `git diff --check` green。
- 残課題: R21 の他の sonner mock residual は引き続き段階移行対象。
- 次アクション: 単独 Codex 運用で、次の安全な R21/R55/R40 系 slice を選ぶ。

## 2026-07-04 Single Codex operation switch

- 分類: operator workflow / agmsg multi-agent shutdown。
- 実施: ユーザー指示に従い、現行 SSOT を Codex 単独運用へ更新。
  agmsg、codex2/codex3/codex4、Claude、subagent、PATCH_REPORT 待ち、外部
  maker/checker handoff はユーザーが明示的に再有効化するまで使わない。
- 変更: `AGENTS.md`、`.agent-loop/README.md`、`ops/refactor/STATE.md`。
  17:53 の Codex CLI/subagent persona 記録は履歴として残すが、現行運用はこの単独運用設定を優先。
- 検証: `git diff --check -- AGENTS.md ops/refactor/STATE.md .agent-loop/README.md` green、
  `./node_modules/.bin/prettier --check AGENTS.md ops/refactor/STATE.md .agent-loop/README.md` green。
- 安全性: process/docs-only。product source/API/DB/auth/authorization/PHI/billing/deploy/package dependency は不変。
- 残課題: `.codex/config.toml` / `.codex/agents/*.toml` /
  `src/components/features/reports/report-edit-form.test.tsx` / `refactor-instructions.md` の dirty diff は
  別スライスとして保持し、この切替には混ぜない。

## 2026-07-04 R21/R32 billing workflow test harness cleanup

- 分類: test-harness cleanup / R21 sonner mock residual + R32 QueryClient wrapper duplication。
- 実施:
  - `src/test/query-client-test-utils.tsx` を追加し、test QueryClient の retry=false 既定と
    wrapper provider を共有化。
  - `billing-candidates-content.test.tsx` と `pharmacy-cooperation-workflow-content.test.tsx` の
    local QueryClient wrapper を共有 helper に置換。
  - 両テストの local partial `sonner` mock を `createSonnerToastMock()` helper に置換。

## 2026-07-04 Codex-only design SSOT / W3-E2 sync

- 分類: operator workflow / design SSOT / W3-E2 documentation sync。
- 実施:
  - 新規追加された `design-taste-frontend` skill を PH-OS 用の監査チェックリストとして読み、landing /
    portfolio 向け規範は採用せず、`docs/ui-ux-design-guidelines.md` の既存 PH-OS SSOT に従う方針を確認。
  - `ops/refactor/STATE.md` と `.agent-loop/README.md` の現行体制を、agmsg / external worker lanes /
    subagents 禁止の Codex 単独運用へ整合。
  - `.codex/hooks.json` の agmsg session start/end hooks を無効化。
  - `Plans.md` の W3-E2 を current-code scan ベースで完了へ同期し、workflow DataTable test comment の
    「変換前」表現を更新。
- 安全性: docs/config/test-comment only。product source/API/DB/auth/authorization/PHI/billing/deploy/package
  dependency は不変。
- 検証: residual wording scan no matches、W3-E2 raw-table scan no matches、focused workflow Vitest
  `1 file / 3 tests` green、targeted Prettier green、targeted `git diff --check` green。

- 変更ファイル:
  - `src/test/query-client-test-utils.tsx`
  - `src/app/(dashboard)/billing/candidates/billing-candidates-content.test.tsx`
  - `src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx`
- 削除したコード: 各テスト内の local QueryClientProvider wrapper と `success` / `error` のみの
  partial toast mock。
- 共通化した処理: React Query test wrapper と sonner mock surface。
- 挙動変更: なし。test-only で product runtime source は不変。
- FE/BE整合性への影響: なし。
- UI配置への影響: なし。
- 性能への影響: なし。
- 検証: focused Vitest `2 files / 37 tests` green、exact ESLint green、exact
  Prettier check green、targeted `git diff --check` green。
- 残課題: R21/R32 の他 residual は引き続き narrow wave で移行する。
- 次アクション: R43 route-compare `jsonResponse` helper 収束、または R55 schedule proposals
  loading skeleton 化を次候補として再評価する。

## 2026-07-04 R43 route-compare jsonResponse helper cleanup

- 分類: test-harness cleanup / R43 fetch response helper duplication。
- 実施: `src/app/(dashboard)/schedules/route-compare/route-compare-content.test.tsx` の
  local `jsonResponse` helper を既存 `src/test/fetch-test-utils.ts` の shared helper に置換。
- 変更ファイル: `src/app/(dashboard)/schedules/route-compare/route-compare-content.test.tsx`。
- 削除したコード: test-local の JSON Response helper。
- 共通化した処理: JSON stringify、`content-type: application/json`、status/ResponseInit handling。
- 挙動変更: なし。test-only で product runtime source は不変。
- FE/BE整合性への影響: なし。
- UI配置への影響: なし。
- 性能への影響: なし。
- 検証: focused Vitest `1 file / 4 tests` green、exact ESLint green、exact
  Prettier check green、targeted `git diff --check` green。
- 残課題: R43 の他 fetch/mock helper residual は引き続き narrow wave で移行する。
- 次アクション: R55 schedule proposals loading/error 表示収束、または R40/R44 saved-views
  `readApiJson` 収束を再評価する。

## 2026-07-04 OPS direct subagent policy reconciliation

- 分類: operator workflow / Codex CLI direct-subagent enablement。
- 背景: `cf0f994c` で一度すべての subagent を無効化したが、最新ユーザー指示は
  「Codex CLI の最新版に最適化」「サブエージェントのペルソナ強化」。そのため、外部 worker lane は
  引き続き無効のまま、Codex CLI の direct child subagents だけを bounded helper として再有効化する。
- 変更:
  - `.agent-loop/README.md`: single Codex operation のまま、direct Codex CLI subagents を
    mapping / planning / review / verification 用の direct child helper として許可。
  - `ops/refactor/STATE.md`: SSOT を Codex 単独統括 + direct subagents 体制へ戻し、
    recursive fan-out と commit ownership は禁止。
  - `.codex/ralph-state.md` / `CODEX_GOAL_PROGRESS.md` / 本 LOG: 検証済みの運用差分として記録。
- 安全性: docs/ledger only。product source/API/DB/auth/authorization/PHI/billing/deploy/package dependency は不変。
- 検証: `NODE_OPTIONS=--max-old-space-size=8192 pnpm prettier --check .agent-loop/README.md ops/refactor/STATE.md`
  green、`git diff --check -- .agent-loop/README.md ops/refactor/STATE.md` green。
- 残課題: `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は別スライスとして保持し、
  この commit には混ぜない。

## 2026-07-04 R55 schedule proposals loading skeleton

- 分類: UI loading-state cleanup / R55 visible loading residual。
- 実施:
  - `schedule-proposals-content.tsx` のケース検索、訪問候補一覧、確定フロー Sheet の可視
    plain loading copy を領域固有 `role="status"` + skeleton へ置換。
  - `schedule-weekly-optimizer.tsx` のケース検索と週間ボード loading を領域固有
    `role="status"` + skeleton へ置換。
  - 各テストへ named status と旧 plain loading copy 不在の assertion を追加。
- 挙動変更: loading presentation のみ。query key、enabled 条件、error/empty branch、retry action、
  selection/bulk/action disabled、route/billing/API payload は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の loading / error / empty 分離、可視 generic loading copy
  禁止、`SkeletonRows status={false}` を単一 named status region 配下に置く契約へ整合。
- 安全性: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は不変。
- 検証: focused Vitest `2 files / 48 tests` green、targeted ESLint green、targeted Prettier check
  green、targeted `git diff --check` green、`pnpm typecheck` green、`pnpm build` green、
  `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck:no-unused` green。
- 残課題: source/test は `8fee04d8` で land 済み。`refactor-instructions.md`、
  `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 schedule proposals false-empty guard

- 分類: UI false-empty prevention / patient-safety and privacy-state guard。
- 実施:
  - `schedule-proposals-content.tsx` の case/patient search result panel に
    `casesQuery.isError` 分岐を追加し、`/api/cases` 取得失敗時に
    `一致するケースはありません。` を表示しないようにした。
  - `ErrorState` + assertive live region + `casesQuery.refetch()` retry を使い、PHI-free の
    cause / next action / safety detail copy を表示。
  - 既存 detail sheet error branch に `role="alert"` を追加し、取得失敗が loading ではなく
    blocking error として支援技術にも伝わるようにした。
  - `schedule-proposals-content.test.tsx` に case-search error retry と detail error retry の回帰
    coverage を追加。検索語・住所・電話・薬剤/処方詳細を error copy に出さないことも固定。
- 挙動変更: error UI のみ。query key、enabled 条件、fetch path、payload、selection、bulk action、
  route/billing/API/DB/auth/authorization/PHI persistence は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の False-empty prevention と状態5分離に整合。
- safety/privacy review: Codex-local review で false-empty / PHI-free copy /
  retryability を確認。
- 検証:
  - focused Vitest `1 file / 39 tests` green。
  - schedule proposals + weekly optimizer Vitest `2 files / 48 tests` green。
  - scoped ESLint green、scoped Prettier check green、targeted `git diff --check` green。
  - `pnpm typecheck` green、`pnpm build` green。
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck:no-unused` green
    （`pnpm build` で Next route type artifacts を再生成後に実行）。
- 残課題: source/test は `8fee04d8` で land 済み。`refactor-instructions.md` と
  `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 report delivery analytics loading skeleton

- 分類: UI loading-state cleanup / R55 visible loading residual。
- 実施:
  - `report-delivery-dashboard.tsx` の初回 loading 中に、KPI・未確認報告一覧・月別/医師別/チャネル別
    小集計へ領域固有 `role="status"` + skeleton を表示するようにした。
  - loading 中の可視 empty 代替文言 `未確認報告を集計しています…` と `集計中です…` を削除し、
    真の empty copy は analytics data が取得できた後だけ表示するよう分離。
  - `report-delivery-dashboard.test.tsx` へ named status region と旧 plain loading copy 不在の
    assertion を追加。
- 挙動変更: loading presentation のみ。query key、fetch path、org headers、mutation payload、
  reminder disabled 条件、error/empty branch、リンク生成、API/DB/auth/authorization/billing/audit は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の 5状態分離、false-empty/false-zero 防止、
  領域固有 loading label、可視 generic loading copy 禁止に整合。
- 安全性: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は不変。
  Loading/disabled copy は PHI-free で、患者名・report id・org id・連絡先・raw error を出さない。
- 検証: focused Vitest `1 file / 9 tests` green、targeted ESLint green、targeted Prettier
  check green、targeted `git diff --check` green、`pnpm typecheck` green。
- 残課題: R55 残として current-code scan で `operating-hours` loading state が次候補。
  既存 dirty の `Plans.md` / `.codex/hooks.json` / `refactor-instructions.md` /
  `workflow-dashboard-view.test.tsx` / `.agents/skills/**` は別スライスとして保持する。

## 2026-07-04 R55 operating-hours loading skeleton

- 分類: UI loading-state cleanup / R55 visible loading residual。
- 実施:
  - `operating-hours-content.tsx` の拠点一覧 bootstrap、週次営業時間 editor、稼働日カレンダーで
    generic `Loading` をやめ、領域固有 `role="status"` + skeleton へ置換。
  - loading 中に generic `読み込み中...` status へ戻らないこと、稼働日カレンダーの stats を
    unavailable な状態で表示しないことをテストに追加。
- 挙動変更: loading presentation のみ。query key、fetch path、org headers、mutation payload、
  conflict retry/reload、error/empty branch、API/DB/auth/authorization/billing/audit は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の 5状態分離、false-empty/false-zero 防止、
  領域固有 loading label、可視 generic loading copy 禁止に整合。
- 安全性: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は不変。
  Loading copy は PHI-free で、site id・org id・患者情報・raw error・未取得のカレンダー集計を出さない。
- 検証: focused Vitest `1 file / 11 tests` green、targeted ESLint green、targeted Prettier
  check green、targeted `git diff --check` green、`pnpm typecheck` green。
- 残課題: broad Plans.md / R55 residual scan は継続。`refactor-instructions.md` と
  `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 patient card workspace loading skeleton

- 分類: UI loading-state cleanup / R55 visible loading residual。
- 実施:
  - `patients/[id]/card-workspace.tsx` の org 未解決 / patient overview loading 分岐で使っていた
    generic `Loading` return を、処方カード作業台の heading・actions・main workspace・side rail の形を保つ
    領域固有 `role="status"` + skeleton へ置換。
  - 同ファイルの初回訪問文書・交付記録パネル loading を、panel context を保つ
    領域固有 `role="status"` + skeleton へ置換。
  - loading 中に generic `読み込み中...` status、患者名、error/not-found copy、印刷プレビュー link、
    最終文書 label が出ないことを `card-workspace.test.tsx` に追加。
- 挙動変更: loading presentation のみ。query key、fetcher、org header、enabled behavior、
  patient API helper、document fetch、mutation payload、cache invalidation、navigation helper、
  API/DB/auth/authorization/billing/audit は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の高頻度優先（患者詳細）、5状態分離、
  領域固有 loading label、generic loading copy 禁止、患者作業台 shape に沿う skeleton loading に整合。
- 安全性: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は不変。
  Loading copy は PHI-free で、patient name・patient id・contact detail・document label/status・prescription content・billing collection detail・MCS note・conference note・org id・raw error
  を出さない。
- 検証: focused card-workspace Vitest `1 file / 69 tests` green、targeted ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `1cf761b4` (`fix(patients): show skeleton for card workspace loading`)。
- 残課題: broad Plans.md / R55 residual scan は継続。`refactor-instructions.md` と
  `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 dispense-audit stats loading skeleton

- 分類: UI loading-state cleanup / R55 visible loading residual。
- 実施:
  - `admin/dispense-audit-stats/page.tsx` の stats query loading 分岐で使っていた
    generic `Loading` を、概要KPIと理由コード別内訳カードの形を保つ領域固有
    `role="status"` + skeleton へ置換。
  - loading 中に旧 ellipsis label、generic `読み込み中...` status、最終集計値、理由ラベル、
    true-empty copy が出ないことを `page.test.tsx` に追加。
- 挙動変更: loading presentation のみ。query key、fetcher、org header、period selector、
  reject-reason calculation、billing/audit semantics、API/DB/auth/authorization は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の 5状態分離、領域固有 loading label、
  generic loading copy 禁止、分析カード shape に沿う skeleton loading に整合。
- 安全性: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は不変。
  Loading copy は PHI-free で、patient identifier・dispense result detail・reject count・reason label・org id・raw error
  を出さない。
- 検証: focused dispense-audit stats Vitest `1 file / 5 tests` green、targeted ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `d9a68f06` (`fix(admin): show skeleton for dispense audit stats loading`)。
- 残課題: broad Plans.md / R55 residual scan は継続。`refactor-instructions.md` と
  `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 operating-hours route loading label

- 分類: UI loading-state cleanup / R55 route-shell fallback residual。
- 実施:
  - `admin/operating-hours/page.tsx` の route-level Suspense fallback を generic
    `Loading` から `Loading label="稼働日設定を読み込み中..."` に変更。
  - page shell test を追加し、header が残ること、screen-specific status が出ること、
    generic `読み込み中...` と suspended content が出ないことを固定。
- 挙動変更: route-shell loading presentation のみ。content query、pharmacy-operating-hours API、
  org header、site selector、calendar calculation、save mutation、API/DB/auth/authorization/billing/audit は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の 5状態分離、領域固有 loading label、
  Next loading/Suspense docs の meaningful loading UI 方針に整合。
- 安全性: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は不変。
  Loading copy は PHI-free で、site id・org id・schedule detail・holiday data・operating-hour value・raw error
  を出さない。
- 検証: focused operating-hours page Vitest `1 file / 2 tests` green、targeted ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `25132627` (`fix(admin): name operating hours route loading`)。
- 残課題: broad Plans.md / R55 residual scan は継続。`refactor-instructions.md` と
  `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 users route loading label

- 分類: UI loading-state cleanup / R55 route-shell fallback residual。
- 実施:
  - `admin/users/page.tsx` の route-level Suspense fallback を generic
    `Loading` から `Loading label="ユーザー管理を読み込み中..."` に変更。
  - page shell test を追加し、header が残ること、screen-specific status が出ること、
    generic `読み込み中...` と suspended users content が出ないことを固定。
- 挙動変更: route-shell loading presentation のみ。users content query、pharmacist/users API、
  org header、invite、role/status mutation、activation/deactivation、API/DB/auth/authorization/audit は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の 5状態分離、領域固有 loading label、
  Next loading/Suspense docs の meaningful loading UI 方針に整合。
- 安全性: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は不変。
  Loading copy は PHI-free で、user name・email・phone・role・site id・org id・account state・raw error
  を出さない。
- 検証: focused users page Vitest `1 file / 2 tests` green、targeted ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `a504a8e5` (`fix(admin): name users route loading`)。
- 残課題: broad Plans.md / R55 residual scan は継続。`refactor-instructions.md` と
  `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 visit-record form loading skeleton

- 分類: UI loading-state cleanup / R55 visible loading residual。
- 実施:
  - `visits/[id]/record/visit-record-form.tsx` の org 未解決 / schedule loading 分岐で使っていた
    visible generic `読み込み中...` paragraph を、step navigation と form の形を保つ領域固有
    `role="status"` + skeleton へ置換。
  - loading 中に generic `読み込み中...` text、訪問完了 button、medication management section、訪問時チェックが出ないことを
    `visit-record-form.test.tsx` に追加。
- 挙動変更: loading presentation のみ。fetch path、org header、visit preparation/CDS query behavior、
  offline sync behavior、form state、submit payload、cache invalidation、API/DB/auth/authorization/billing/audit は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の 5状態分離、領域固有 loading label、
  generic loading copy 禁止、visit-record form shape に沿う skeleton loading に整合。
- 安全性: Loading copy は PHI-free で、patient name・schedule detail・medication management content・visit note・carry-item status・org id・raw error
  を出さない。
- 検証: focused visit-record form Vitest `1 file / 22 tests` green、targeted ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `8d4bf6ed` (`fix(visits): show skeleton for visit record loading`)。
- 残課題: broad Plans.md / R55 residual scan は継続。`refactor-instructions.md` と
  `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 patient MCS loading skeleton

- 分類: UI loading-state cleanup / R55 visible loading residual。
- 実施:
  - `patients/[id]/mcs/mcs-content.tsx` の org 未解決 / MCS messages loading 分岐で使っていた
    generic `Loading` returns を、sync/profile/message の形を保つ領域固有 `role="status"` + skeleton へ置換。
  - loading 中に generic `読み込み中...` status、MCS headings/actions、MCS author name、message body が出ないことを
    `mcs-content.test.tsx` に追加。
- 挙動変更: loading presentation のみ。query key、fetcher、patient API path helper、org header、
  sync/check-log/profile mutations、clipboard behavior、cache invalidation、API/DB/auth/authorization/billing/audit は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の 5状態分離、領域固有 loading label、
  generic loading copy 禁止、MCS workspace 形状に沿う skeleton loading に整合。
- 安全性: Loading copy は PHI-free で、MCS author name・message body・clinical content・patient id・source URL・sync error・org id・raw error
  を出さない。
- 検証: focused MCS Vitest `1 file / 12 tests` green、targeted ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `a2180de4` (`fix(patients): show skeleton for mcs loading`)。
- 残課題: broad Plans.md / R55 residual scan は継続。`refactor-instructions.md` と
  `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 report print audit loading skeleton

- 分類: UI loading-state cleanup / R55 visible loading residual。
- 実施:
  - `reports/[id]/print/page.tsx` の preview-rendered print audit loading 分岐で使っていた generic
    `Loading label="印刷監査を記録中..."` を、print report outline の形を保つ領域固有
    `role="status"` + skeleton へ置換。
  - loading 中に generic `印刷監査を記録中...` status、最終 print layout、患者名、報告本文、手動印刷ボタンが出ないことを
    `page.test.tsx` に追加。
- 挙動変更: loading presentation のみ。query key、print-audit POST payload、org header、
  fail-closed audit behavior、auto-print timing、manual print audit behavior、navigation helper、
  API/DB/auth/authorization/billing/audit semantics は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の 5状態分離、領域固有 loading label、
  generic loading copy 禁止、print report shape に沿う skeleton loading に整合。
- 安全性: Loading copy は PHI-free で、patient name・report body・pharmacist name・report id・patient id・visit date・prescription content・org id・raw error
  を出さない。
- 検証: focused report print Vitest `1 file / 20 tests` green、targeted ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `994c459f` (`fix(reports): show skeleton for print audit loading`)。
- 残課題: broad Plans.md / R55 residual scan は継続。`refactor-instructions.md` と
  `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 report detail loading skeleton

- 分類: UI loading-state cleanup / R55 visible loading residual。
- 実施:
  - `reports/[id]/page.tsx` の org 未解決 / care-report loading 分岐で使っていた generic
    `Loading` return を、intro・患者識別 band・report body・readiness・delivery history の形を保つ
    領域固有 `role="status"` + skeleton へ置換。
  - loading 中に generic `読み込み中...` status、最終 report workspace、患者 header、患者名、薬剤名、送付ボタンが出ないことを
    `page.test.tsx` に追加。
- 挙動変更: loading presentation のみ。query key、fetcher、org header、enabled behavior、
  report navigation、send/resend logic、composer behavior、mutation/cache invalidation、
  API/DB/auth/authorization/billing/audit は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の 5状態分離、領域固有 loading label、
  generic loading copy 禁止、report detail workspace 形状に沿う skeleton loading に整合。
- 安全性: Loading copy は PHI-free で、patient name・drug name・report body・report id・patient id・visit date・delivery recipient・org id・raw error
  を出さない。
- 検証: focused report-detail Vitest `1 file / 37 tests` green、targeted ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `76c799e6` (`fix(reports): show skeleton for report detail loading`)。
- 残課題: broad Plans.md / R55 residual scan は継続。`refactor-instructions.md` と
  `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 QR scan draft loading skeleton

- 分類: UI loading-state cleanup / R55 visible loading residual。
- 実施:
  - `prescriptions/qr-drafts/[id]/page.tsx` の org 未解決 / QR scan draft loading 分岐で使っていた
    generic `Loading` return を、draft form と side panel の形を保つ領域固有 `role="status"` + skeleton へ置換。
  - loading 中に generic `読み込み中...` status、患者名、薬剤名、確定ボタンが出ないことを
    `page.test.tsx` に追加。
- 挙動変更: loading presentation のみ。query key、fetcher、org header、enabled behavior、
  draft confirmation、case matching、mutation/cache invalidation、navigation behavior、
  API/DB/auth/authorization/billing/audit は不変。
- SSOT: 2026-07-04 ユーザー明示の「必要なら product API / DB / auth / authorization /
  PHI / billing / deploy / package dependency も変更対象」は `ops/refactor/STATE.md` と
  `CODEX_GOAL_PROGRESS.md` に記録済み。本 slice では不要だったため不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の 5状態分離、領域固有 loading label、
  generic loading copy 禁止、workspace 形状に沿う skeleton loading に整合。
- 安全性: Loading copy は PHI-free で、patient name・drug name・prescription detail・draft id・case id・org id・raw error
  を出さない。
- 検証: focused QR draft Vitest `1 file / 8 tests` green、targeted ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `d9c64e41` (`fix(prescriptions): show skeleton for qr draft loading`)。
- 残課題: broad Plans.md / R55 residual scan は継続。`refactor-instructions.md` と
  `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 interprofessional report-share loading skeleton

- 分類: UI loading-state cleanup / R55 visible loading residual。
- 実施:
  - `reports/[id]/share/interprofessional-share-content.tsx` の org 未解決 / report loading 分岐で使っていた
    generic `Loading` return を、intro・audience・preview・reply/action columns の形を保つ
    領域固有 `role="status"` + skeleton へ置換。
  - loading 中に generic `読み込み中...` status、最終共有 workspace、患者名、報告 title、返信依頼ボタンが出ないことを
    `interprofessional-share-content.test.tsx` に追加。
- 挙動変更: loading presentation のみ。query key、fetcher、org header、enabled behavior、
  report/share navigation、communication-request creation、task creation、mutation/cache invalidation、
  API/DB/auth/authorization/billing/audit は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の 5状態分離、領域固有 loading label、
  generic loading copy 禁止、3カラム workspace 形状に沿う skeleton loading に整合。
- 安全性: Loading copy は PHI-free で、patient name・report title・medication summary・care-team name・reply content・request id・org id・raw error
  を出さない。
- 検証: focused interprofessional share Vitest `1 file / 28 tests` green、targeted ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `b7ab4166` (`fix(reports): show skeleton for interprofessional share loading`)。
- 残課題: broad Plans.md / R55 residual scan は継続。`refactor-instructions.md` と
  `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 patient MCS summary loading skeleton

- 分類: UI loading-state cleanup / R55 visible loading residual。
- 実施:
  - `patient-mcs-summary-section.tsx` の generic `Loading` return を、既存カード shell 内の
    領域固有 `role="status"` + skeleton へ置換。
  - loading 中に generic `読み込み中...` status や未取得時の empty copy が出ないことをテストに追加。
- 挙動変更: loading presentation のみ。query key、fetcher、cache timing、error/restricted/empty
  branch、リンク生成、API/DB/auth/authorization/billing/audit は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の 5状態分離、領域固有 loading label、
  generic loading copy 禁止に整合。
- 安全性: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は不変。
  Loading copy は PHI-free で、患者名・MCS本文・patient id・org id・sync error を出さない。
- 検証: focused Vitest `1 file / 6 tests` green、targeted ESLint green、targeted Prettier
  check green、targeted `git diff --check` green、`pnpm typecheck` green。
- 残課題: broad Plans.md / R55 residual scan は継続。`refactor-instructions.md` と
  `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 workflow stage timeline loading skeleton

- 分類: UI loading-state cleanup / R55 visible loading residual。
- 実施:
  - `stage-timeline.tsx` の generic `Loading` return を、timeline shape に沿った領域固有
    `role="status"` + skeleton へ置換。
  - loading 中に generic `読み込み中...` status や未取得時の empty copy が出ないことを
    `workflow-history.test.tsx` に追加。
- 挙動変更: loading presentation のみ。query key、fetcher、cache timing、realtime invalidation、
  error/empty branch、API/DB/auth/authorization/billing/audit は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の 5状態分離、領域固有 loading label、
  generic loading copy 禁止に整合。
- 安全性: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は不変。
  Loading copy は PHI-free で、actor name・note・patient identifier・org id・raw error を出さない。
- 検証: focused workflow history Vitest `2 files / 7 tests` green、targeted ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `cc422338` (`fix(workflow): show skeleton for stage timeline loading`)。
- 残課題: broad Plans.md / R55 residual scan は継続。`refactor-instructions.md` と
  `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 patient visit brief loading skeleton

- 分類: UI loading-state cleanup / R55 visible loading residual。
- 実施:
  - `patient-visit-brief-section.tsx` の generic `Loading` return を、訪問前要約用の領域固有
    `role="status"` + skeleton へ置換。
  - loading 中に generic `読み込み中...` status や未取得の visit brief card が出ないことを
    `patient-visit-brief-section.test.tsx` に追加。
- 挙動変更: loading presentation のみ。query key、fetcher、org header、cache timing、
  error retry、API/DB/auth/authorization/billing/audit は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の 5状態分離、領域固有 loading label、
  generic loading copy 禁止に整合。
- 安全性: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は不変。
  Loading copy は PHI-free で、patient identifier・visit brief body・org id・raw error を出さない。
- 検証: focused patient visit brief Vitest `1 file / 3 tests` green、targeted ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `77b2eafa` (`fix(visit-brief): show skeleton while summary loads`)。
- 残課題: broad Plans.md / R55 residual scan は継続。`refactor-instructions.md` と
  `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 patient field revision loading skeleton

- 分類: UI loading-state cleanup / R55 visible loading residual。
- 実施:
  - `patient-field-revision-timeline.tsx` の generic `Loading` return を、変更履歴用の領域固有
    `role="status"` + skeleton へ置換。
  - loading 中に generic `読み込み中...` status、empty copy、error copy が出ないことを
    `patient-field-revision-timeline.test.tsx` に追加。
- 挙動変更: loading presentation のみ。query key、fetcher、org header、filter behavior、
  cache timing、API/DB/auth/authorization/billing/audit は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の 5状態分離、領域固有 loading label、
  generic loading copy 禁止に整合。
- 安全性: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は不変。
  Loading copy は PHI-free で、patient identifier・field value・updater name・source id・org id・raw error
  を出さない。
- 検証: focused patient field revision timeline Vitest `1 file / 5 tests` green、targeted ESLint
  green、targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `53f22742` (`fix(patients): show skeleton for field revision loading`)。
- 残課題: broad Plans.md / R55 residual scan は継続。`refactor-instructions.md` と
  `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 patient readiness loading skeleton

- 分類: UI loading-state cleanup / R55 visible loading residual。
- 実施:
  - `patient-readiness-card.tsx` の unresolved-org / query-loading 分岐で使っていた
    spinner-style `Loading` を、既存カード shell 内の領域固有 `role="status"` + skeleton へ置換。
  - loading 中に generic `読み込み中...` status、empty copy、error copy が出ないことを
    `patient-readiness-card.test.tsx` に追加。
- 挙動変更: loading presentation のみ。query key、fetcher、org header、enabled behavior、
  cache timing、API/DB/auth/authorization/billing/audit は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の 5状態分離、領域固有 loading label、
  generic loading copy 禁止に整合。
- 安全性: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は不変。
  Loading copy は PHI-free で、patient identifier・readiness item label・case status・org id・raw error
  を出さない。
- 検証: focused patient readiness card Vitest `1 file / 6 tests` green、targeted ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `72f397dc` (`fix(patients): show skeleton for readiness loading`)。
- 残課題: broad Plans.md / R55 residual scan は継続。`refactor-instructions.md` と
  `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 patient workflow preview loading skeleton

- 分類: UI loading-state cleanup / R55 visible loading residual。
- 実施:
  - `patient-workflow-preview-card.tsx` の spinner-style `Loading` を、訪問/報告/連携の
    3区画構造に沿う領域固有 `role="status"` + skeleton へ置換。
  - loading 中に generic `読み込み中...` status、error copy、最終 preview section heading が出ないことを
    `patient-workflow-preview-card.test.tsx` に追加。
- 挙動変更: loading presentation のみ。query key、fetcher、org header、enabled behavior、
  link helper usage、cache timing、API/DB/auth/authorization/billing/audit は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の 5状態分離、領域固有 loading label、
  generic loading copy 禁止に整合。
- 安全性: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は不変。
  Loading copy は PHI-free で、patient identifier・contact name・phone number・report recipient・baseline context・org id・raw error
  を出さない。
- 検証: focused patient workflow preview Vitest `1 file / 8 tests` green、targeted ESLint
  green、targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `437cfeb6` (`fix(patients): show skeleton for workflow preview loading`)。
- 残課題: broad Plans.md / R55 residual scan は継続。`refactor-instructions.md` と
  `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 prescription detail loading skeleton + product boundary SSOT

- 分類: UI loading-state cleanup / R55 visible loading residual + operating SSOT clarification。
- 実施:
  - `prescription-detail-content.tsx` の generic `Loading` return を、処方受付詳細の workflow
    page shell に沿う領域固有 `role="status"` + skeleton へ置換。
  - loading 中に generic `読み込み中...` status、error copy、患者名を含む最終 detail content が
    出ないことを `prescription-detail-content.test.tsx` に追加。
  - 2026-07-04 ユーザー明示を `AGENTS.md` / `ops/refactor/STATE.md` /
    `docs/ui-ux-design-guidelines.md` に反映。active objective 達成に必要なら product API / DB /
    auth / authorization / PHI / billing / deploy / package dependency も変更対象に含める。
- 挙動変更: loading presentation と SSOT 文書のみ。query key、fetcher、org header、enabled behavior、
  route helper、cache timing、API/DB/auth/authorization/billing/deploy/package dependency は本 slice では不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の 5状態分離、領域固有 loading label、
  generic loading copy 禁止、backend/API/UI 連動責任に整合。
- 安全性: Loading copy は PHI-free で、patient name・intake id・cycle id・prescription line・prescriber detail・org id・raw error
  を出さない。SSOT 上も migration 適用・deploy・secret rotation・production data mutation・destructive operation・push は
  current-task の明示許可が必要と明記。
- 検証: focused prescription detail Vitest `1 file / 7 tests` green、targeted ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `b779a867` (`fix(prescriptions): show skeleton for detail loading`)。
- 残課題: broad Plans.md / R55 residual scan は継続。`refactor-instructions.md` と
  `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 notifications inbox loading skeleton

- 分類: UI loading-state cleanup / R55 visible loading residual。
- 実施:
  - `notifications-content.tsx` の org 未解決 / query-loading 分岐で使っていた
    generic `Loading` return を、通知ページの heading・bulk action・filter chip・list card の
    形を保つ領域固有 `role="status"` + skeleton へ置換。
  - loading 中に generic `読み込み中...` status、error copy、最終通知カード content が出ないことを
    `notifications-content.test.tsx` に追加。
- 挙動変更: loading presentation のみ。query key、realtime event wiring、fetcher、org header、
  enabled behavior、offline-store refresh、cache timing、mutation behavior、API/DB/auth/authorization/billing/audit は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の 5状態分離、領域固有 loading label、
  generic loading copy 禁止、ヘッダを消さない skeleton loading に整合。
- 安全性: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は不変。
  Loading copy は PHI-free で、patient name・notification message・link・pending sync count・org id・raw error
  を出さない。
- 検証: focused notifications Vitest `1 file / 11 tests` green、targeted ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `38ad97d2` (`fix(notifications): show skeleton for inbox loading`)。
- 残課題: broad Plans.md / R55 residual scan は継続。`refactor-instructions.md` と
  `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 prescription history loading skeleton

- 分類: UI loading-state cleanup / R55 visible loading residual。
- 実施:
  - `prescription-history-content.tsx` の main query loading 分岐で使っていた generic
    `Loading` return を、patient header・stats・filter・intake card の形を保つ領域固有
    `role="status"` + skeleton へ置換。
  - loading 中に generic `読み込み中...` status、error copy、最終処方履歴 content が出ないことを
    `prescription-history-content.test.tsx` に追加。
- 挙動変更: loading presentation のみ。query key、fetcher、org header、enabled behavior、
  drug-master enrichment、mutation behavior、cache timing、print behavior、API/DB/auth/authorization/billing/audit は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の 5状態分離、領域固有 loading label、
  generic loading copy 禁止、ヘッダを消さない skeleton loading に整合。
- 安全性: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は不変。
  Loading copy は PHI-free で、patient name・kana・prescriber name・drug name・prescription line・intake id・cycle id・org id・raw error
  を出さない。
- 検証: focused prescription history Vitest `1 file / 27 tests` green、targeted ESLint
  green、targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `39087d5c` (`fix(patients): show skeleton for prescription history loading`)。
- 残課題: broad Plans.md / R55 residual scan は継続。`refactor-instructions.md` と
  `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 patient edit loading skeleton

- 分類: UI loading-state cleanup / R55 visible loading residual。
- 実施:
  - `patient-edit-content.tsx` の org 未解決 / patient overview loading 分岐で使っていた
    generic `Loading` return を、patient edit form の section・field・action layout を保つ
    領域固有 `role="status"` + skeleton へ置換。
  - loading 中に generic `読み込み中...` status、最終 form content、`PatientForm` が出ないことを
    `patient-edit-content.fetch.test.tsx` に追加。
- 挙動変更: loading presentation のみ。query key、fetcher、org header、enabled behavior、
  refetch settings、patient form defaults、redirect helper、validation logic、API/DB/auth/authorization/billing/audit は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の 5状態分離、領域固有 loading label、
  generic loading copy 禁止、実フォーム形状に沿う skeleton loading に整合。
- 安全性: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は不変。
  Loading copy は PHI-free で、patient name・address・insurance identifier・phone number・allergy detail・requester contact・clinical note・org id・raw error
  を出さない。
- 検証: focused patient edit Vitest `2 files / 8 tests` green、targeted ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `4792e87c` (`fix(patients): show skeleton for edit loading`)。
- 残課題: broad Plans.md / R55 residual scan は継続。`refactor-instructions.md` と
  `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 medication print loading skeleton

- 分類: UI loading-state cleanup / R55 visible loading residual。
- 実施:
  - `medications/print/page.tsx` の org / patient / medication print data loading 分岐で使っていた
    generic `Loading` return を、print toolbar と medication table の形を保つ領域固有
    `role="status"` + skeleton へ置換。
  - loading 中に generic `読み込み中...` status、最終 print layout、患者名が出ないことを
    `medications/print/page.test.tsx` に追加。
- 挙動変更: loading presentation のみ。query key、fetcher、org header、enabled behavior、
  no-store cache setting、print readiness、auto-print timing、URL helper usage、medication query params、
  API/DB/auth/authorization/billing/audit は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の 5状態分離、領域固有 loading label、
  generic loading copy 禁止、印刷表形状に沿う skeleton loading に整合。
- 安全性: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は不変。
  Loading copy は PHI-free で、patient name・patient id・kana・birth date・drug name・dose・frequency・prescriber name・pharmacy name・org id・raw error
  を出さない。
- 検証: focused medication print Vitest `1 file / 4 tests` green、targeted ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `4ba53160` (`fix(patients): show skeleton for medication print loading`)。
- 残課題: broad Plans.md / R55 residual scan は継続。`refactor-instructions.md` と
  `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 visit-record print loading skeleton

- 分類: UI loading-state cleanup / R55 visible loading residual。
- 実施:
  - `visit-records/print/page.tsx` の org / patient / visit-record print data loading 分岐で使っていた
    generic `Loading` return を、print toolbar・patient summary table・visit-record table の形を保つ
    領域固有 `role="status"` + skeleton へ置換。
  - loading 中に generic `読み込み中...` status、toolbar back link、患者名が出ないことを
    `visit-records/print/page.test.tsx` に追加。
- 挙動変更: loading presentation のみ。query key、fetcher、org header、enabled behavior、
  no-store cache setting、date filters、print readiness、auto-print timing、URL helper usage、visit-record query params、
  API/DB/auth/authorization/billing/audit は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の 5状態分離、領域固有 loading label、
  generic loading copy 禁止、印刷表形状に沿う skeleton loading に整合。
- 安全性: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は不変。
  Loading copy は PHI-free で、patient name・patient id・kana・birth date・visit date・SOAP note・outcome label・schedule data・pharmacy name・org id・raw error
  を出さない。
- 検証: focused visit-record print Vitest `1 file / 9 tests` green、targeted ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `ac6fc8f2` (`fix(patients): show skeleton for visit record print loading`)。
- 残課題: broad Plans.md / R55 residual scan は継続。`refactor-instructions.md` と
  `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 management-plan print loading skeleton

- 分類: UI loading-state cleanup / R55 visible loading residual。
- 実施:
  - `management-plan/print/page.tsx` の patient / management-plan / case print data loading 分岐で使っていた
    generic `Loading` return を、print toolbar・patient summary table・plan section の形を保つ
    領域固有 `role="status"` + skeleton へ置換。
  - loading 中に generic `読み込み中...` status、最終 print layout、患者名、plan title が出ないことを
    `management-plan/print/page.test.tsx` に追加。
- 挙動変更: loading presentation のみ。query key、fetcher、org header、enabled behavior、
  no-store cache setting、patient-plan association validation、print readiness、auto-print timing、
  URL helper usage、path encoding、API/DB/auth/authorization/billing/audit は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の 5状態分離、領域固有 loading label、
  generic loading copy 禁止、印刷表/section 形状に沿う skeleton loading に整合。
- 安全性: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は不変。
  Loading copy は PHI-free で、patient name・plan title・plan summary・plan section content・case id・plan id・version/status detail・org id・raw error
  を出さない。
- 検証: focused management-plan print Vitest `1 file / 12 tests` green、targeted ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `a3877ee2` (`fix(patients): show skeleton for management plan print loading`)。
- 残課題: broad Plans.md / R55 residual scan は継続。`refactor-instructions.md` と
  `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 patient external-share loading skeleton

- 分類: UI loading-state cleanup / R55 visible loading residual。
- 実施:
  - `external-share-content.tsx` の org 未解決 / overview loading 分岐で使っていた generic
    `Loading` return を、warning・audience/setup・preview・reply/request の 3 カラム構成を保つ
    領域固有 `role="status"` + skeleton へ置換。
  - loading 中に generic `読み込み中...` status、共有設定 heading、共有先名が出ないことを
    `external-share-content.test.tsx` に追加。
- 挙動変更: loading presentation のみ。query key、fetcher、org header、enabled behavior、
  share generation、communication-request creation、task creation、mutation/cache invalidation、
  navigation helper usage、clipboard behavior、API/DB/auth/authorization/billing/audit は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の 5状態分離、領域固有 loading label、
  generic loading copy 禁止、3カラム workspace 形状に沿う skeleton loading に整合。
- 安全性: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は不変。
  Loading copy は PHI-free で、patient name・share recipient name・self-report subject・medication name・schedule date・care-report status・request id・reply content・contact detail・org id・raw error
  を出さない。
- 検証: focused external-share Vitest `1 file / 11 tests` green、targeted ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `c716a9e2` (`fix(patients): show skeleton for external share loading`)。
- 残課題: broad Plans.md / R55 residual scan は継続。`refactor-instructions.md` と
  `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 admin settings route loading label

- 分類: UI loading-state cleanup / R55 route-shell generic loading residual。
- 実施:
  - `admin/settings/page.tsx` の route-level Suspense fallback を generic `Loading` から
    `管理設定を読み込み中...` の画面固有 status へ変更。
  - `admin/settings/page.test.tsx` を追加し、header shell が維持されること、generic
    `読み込み中...` が出ないこと、suspended content が出ないことを固定。
- 挙動変更: route-shell loading label のみ。settings content query、health monitor query、
  settings mutation、org/site/user profile fetch、validation rules、API/DB/auth/authorization/billing/audit は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の Clear state / false-empty prevention と
  route fallback は軽量で意味のある loading UI にする Next loading/Suspense guidance に整合。
- 安全性: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は不変。
  Loading copy は PHI-free で、setting key/value・user name・site id・org id・health detail・raw error
  を出さない。
- 検証: focused settings route Vitest `1 file / 2 tests` green、targeted ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `6ee51a5a` (`fix(admin): name settings route loading`)。
- 残課題: broad Plans.md / R55 residual scan は継続。`refactor-instructions.md` と
  `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 admin facilities route loading label

- 分類: UI loading-state cleanup / R55 route-shell generic loading residual。
- 実施:
  - `admin/facilities/page.tsx` の route-level Suspense fallback を generic `Loading` から
    `施設マスターを読み込み中...` の画面固有 status へ変更。
  - `admin/facilities/page.test.tsx` を追加し、header shell が維持されること、generic
    `読み込み中...` が出ないこと、suspended content が出ないことを固定。
- 挙動変更: route-shell loading label のみ。facilities content query、facility/unit fetch、
  mutation、org header、contact profile linkage、validation rules、API/DB/auth/authorization/billing/audit は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の Clear state / false-empty prevention と
  route fallback は軽量で意味のある loading UI にする Next loading/Suspense guidance に整合。
- 安全性: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は不変。
  Loading copy は PHI-free で、facility/unit/contact name・address・phone/fax・site id・org id・raw error
  を出さない。
- 検証: focused facilities route Vitest `1 file / 2 tests` green、targeted ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `e248ba1e` (`fix(admin): name facilities route loading`)。
- 残課題: broad Plans.md / R55 residual scan は継続。`refactor-instructions.md` と
  `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 admin contact-profiles route loading label

- 分類: UI loading-state cleanup / R55 route-shell generic loading residual。
- 実施:
  - `admin/contact-profiles/page.tsx` の route-level Suspense fallback を generic `Loading` から
    `連携先プロファイルを読み込み中...` の画面固有 status へ変更。
  - `admin/contact-profiles/page.test.tsx` を追加し、header shell が維持されること、generic
    `読み込み中...` が出ないこと、suspended content が出ないことを固定。
- 挙動変更: route-shell loading label のみ。contact profiles content query、API path builder、
  org header、patch mutation、contact method preference、API/DB/auth/authorization/billing/audit は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の Clear state / false-empty prevention と
  route fallback は軽量で意味のある loading UI にする Next loading/Suspense guidance に整合。
- 安全性: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は不変。
  Loading copy は PHI-free で、contact name・phone/fax・email・patient count・pending response count・org id・raw error
  を出さない。
- 検証: focused contact-profiles route Vitest `1 file / 2 tests` green、targeted ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `ba35d4be` (`fix(admin): name contact profiles route loading`)。
- 残課題: broad Plans.md / R55 residual scan は継続。`refactor-instructions.md` と
  `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 admin pharmacist-credentials route loading label

- 分類: UI loading-state cleanup / R55 route-shell generic loading residual。
- 実施:
  - `admin/pharmacist-credentials/page.tsx` の route-level Suspense fallback を generic `Loading` から
    `かかりつけ薬剤師管理を読み込み中...` の画面固有 status へ変更。
  - 既存 `admin/pharmacist-credentials/page.test.tsx` を拡張し、header shell が維持されること、
    generic `読み込み中...` が出ないこと、suspended content が出ないことを固定。
- 挙動変更: route-shell loading label のみ。pharmacist credential content query、
  expiry calculation、staff link、credential update、API/DB/auth/authorization/billing/audit は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の Clear state / false-empty prevention と
  route fallback は軽量で意味のある loading UI にする Next loading/Suspense guidance に整合。
- 安全性: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は不変。
  Loading copy は PHI-free で、pharmacist name・license number・certification date・staff/site/org id・raw error
  を出さない。
- 検証: focused pharmacist-credentials route Vitest `1 file / 2 tests` green、targeted ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `a821ded7` (`fix(admin): name pharmacist credentials route loading`)。
- 残課題: broad Plans.md / R55 residual scan は継続。`refactor-instructions.md` と
  `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 admin master route loading labels

- 分類: UI loading-state cleanup / R55 route-shell generic loading residual。
- 実施:
  - `admin/external-professionals/page.tsx` の route-level Suspense fallback を generic `Loading` から
    `他職種マスターを読み込み中...` の画面固有 status へ変更。
  - `admin/vehicles/page.tsx` の route-level Suspense fallback を generic `Loading` から
    `車両マスターを読み込み中...` の画面固有 status へ変更。
  - `admin/external-professionals/page.test.tsx` を追加し、`admin/vehicles/page.test.tsx` を拡張して、
    header shell が維持されること、generic `読み込み中...` が出ないこと、suspended content が出ないことを固定。
- 挙動変更: route-shell loading label のみ。external professional / vehicle content query、API path builder、
  org header、create/update/delete mutation、patient linkage、schedule proposal integration、
  API/DB/auth/authorization/billing/audit は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の Clear state / false-empty prevention と
  route fallback は軽量で意味のある loading UI にする Next loading/Suspense guidance に整合。
- 安全性: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は不変。
  Loading copy は PHI-free で、professional name・vehicle name・license plate・contact detail・linked patient data・site/org id・raw error
  を出さない。
- 検証: focused external-professionals + vehicles route Vitest `2 files / 4 tests` green、
  targeted ESLint green、targeted Prettier check green、targeted `git diff --check` green、
  `pnpm typecheck` green。
- commit: `6c74f719` (`fix(admin): name master route loading`)。
- 残課題: broad Plans.md / R55 residual scan は継続。`refactor-instructions.md` と
  `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 admin staff and shifts route loading labels

- 分類: UI loading-state cleanup / R55 route-shell generic loading residual。
- 実施:
  - `admin/staff/page.tsx` の route-level Suspense fallback を generic `Loading` から
    `スタッフ管理を読み込み中...` の画面固有 status へ変更。
  - `admin/shifts/page.tsx` の route-level Suspense fallback を generic `Loading` から
    `薬剤師シフト管理を読み込み中...` の画面固有 status へ変更。
  - `admin/staff/page.test.tsx` を追加し、`admin/shifts/page.test.tsx` を拡張して、
    header shell が維持されること、generic `読み込み中...` が出ないこと、suspended content が出ないことを固定。
- 挙動変更: route-shell loading label のみ。staff KPI、users content query、shifts content query、
  user invite、role/status mutation、schedule/holiday/template logic、
  API/DB/auth/authorization/billing/audit は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の Clear state / false-empty prevention と
  route fallback は軽量で意味のある loading UI にする Next loading/Suspense guidance に整合。
- 安全性: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は不変。
  Loading copy は PHI-free で、staff/pharmacist name・shift date/time・site/org id・role/status value・raw error
  を出さない。
- 検証: focused staff + shifts route Vitest `2 files / 4 tests` green、targeted ESLint green、
  targeted `git diff --check` green。初回 Prettier check は `shifts/page.test.tsx` を指摘したため、
  targeted `prettier --write` 後に focused tests / Prettier check を再実行して green。
  `pnpm typecheck` green。
- commit: `c4965984` (`fix(admin): name staff shift route loading`)。
- 残課題: broad Plans.md / R55 residual scan は継続。`refactor-instructions.md` と
  `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 admin site/institution/facility route loading labels

- 分類: UI loading-state cleanup / R55 route-shell generic loading residual。
- 実施:
  - `admin/pharmacy-sites/page.tsx` の route-level Suspense fallback を generic `Loading` から
    `薬局情報管理を読み込み中...` の画面固有 status へ変更。
  - `admin/institutions/page.tsx` の route-level Suspense fallback を generic `Loading` から
    `医療機関マスターを読み込み中...` の画面固有 status へ変更。
  - `admin/facility-standards/page.tsx` の route-level Suspense fallback を generic `Loading` から
    `施設基準管理を読み込み中...` の画面固有 status へ変更。
  - `admin/pharmacy-sites/page.test.tsx` / `admin/institutions/page.test.tsx` を拡張し、
    `admin/facility-standards/page.test.tsx` を追加して、header shell が維持されること、
    generic `読み込み中...` が出ないこと、suspended content が出ないことを固定。
- 挙動変更: route-shell loading label のみ。pharmacy site / institution / facility standards
  content query、API path builder、org header、insurance config、master mutation、
  facility-criteria calculation、API/DB/auth/authorization/billing/audit は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の Clear state / false-empty prevention と
  route fallback は軽量で意味のある loading UI にする Next loading/Suspense guidance に整合。
- 安全性: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は不変。
  Loading copy は PHI-free で、pharmacy/site name・institution name・facility standard detail・insurance config・contact detail・site/org id・raw error
  を出さない。
- 検証: focused pharmacy-sites + institutions + facility-standards route Vitest `3 files / 6 tests`
  green、targeted ESLint green、targeted `git diff --check` green。初回 Prettier check は
  `facility-standards/page.test.tsx` を指摘したため、targeted `prettier --write` 後に
  focused tests / Prettier check を再実行して green。`pnpm typecheck` green。
- commit: `7b030707` (`fix(admin): name site institution loading`)。
- 残課題: broad Plans.md / R55 residual scan は継続。`refactor-instructions.md` と
  `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 admin route-shell fallback closure

- 分類: UI loading-state cleanup / R55 route-shell generic loading residual closure。
- 実施:
  - `admin/page.tsx` の route-level Suspense fallback を generic `Loading` から
    `マスターを読み込み中...` の画面固有 status へ変更。
  - `admin/analytics/page.tsx` を `KPI分析ダッシュボードを読み込み中...`、`admin/metrics/page.tsx` を
    `経営指標ダッシュボードを読み込み中...`、`admin/audit-logs/page.tsx` を
    `監査ログを読み込み中...`、`admin/pca-pumps/page.tsx` を
    `PCAポンプレンタルを読み込み中...`、`admin/pharmacy-cooperation/page.tsx` を
    `薬局間協力設定を読み込み中...` に変更。
  - `admin/page.test.tsx` / `admin/analytics/page.test.tsx` / `admin/metrics/page.test.tsx` /
    `admin/audit-logs/page.test.tsx` を追加し、既存 `admin/pca-pumps/page.test.tsx` /
    `admin/pharmacy-cooperation/page.test.tsx` を拡張して、generic `読み込み中...` が出ないこと、
    suspended content が出ないことを固定。
- 挙動変更: route-shell loading label のみ。admin master hub、analytics/metrics/audit content query、
  PCA pump content query、pharmacy cooperation setup query、route link contract、API path builder、
  org header、mutation、billing semantics、API/DB/auth/authorization/audit は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の Clear state / false-empty prevention と
  route fallback は軽量で意味のある loading UI にする Next loading/Suspense guidance に整合。
- 安全性: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は不変。
  Loading copy は PHI-free で、KPI value・audit actor・patient data・pump serial・pharmacy/cooperation contract detail・site/org id・raw error
  を出さない。
- 検証: focused final admin route fallback Vitest `6 files / 12 tests` green、targeted ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
  `rg -n "<Suspense fallback=\\{<Loading />\\}" 'src/app/(dashboard)/admin' --glob 'page.tsx'`
  は no matches。
- commit: `f26b0bfd` (`fix(admin): close route loading fallbacks`)。
- 残課題: admin route-shell generic fallback は closure。broad Plans.md / R55 residual scan は継続。
  `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 billing route-shell fallback closure

- 分類: UI loading-state cleanup / R55 route-shell generic loading residual closure。
- 実施:
  - `billing/page.tsx` の route-level Suspense fallback を generic `Loading` から
    `算定チェックを読み込み中...` の画面固有 status へ変更。
  - `billing/partner-cooperation/page.tsx` を `薬局間協力 月次処理を読み込み中...`、
    `billing/candidates/page.tsx` を `月次請求候補を読み込み中...` に変更。
  - 3 route の page test を追加し、generic `読み込み中...` が出ないこと、suspended content が出ないこと、
    `billing/candidates` の search param wiring が保持されることを固定。
- 挙動変更: route-shell loading label のみ。billing check content query、partner cooperation monthly logic、
  candidate search param parsing、validation/export behavior、API path、org header、mutation、
  API/DB/auth/authorization/billing semantics/audit は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の Clear state / false-empty prevention と
  route fallback は軽量で意味のある loading UI にする Next loading/Suspense guidance に整合。
- 安全性: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は不変。
  Loading copy は PHI-free で、patient name・candidate id・visit record id・billing month detail・fee value・partner pharmacy detail・org id・raw error
  を出さない。
- 検証: focused billing route fallback Vitest `3 files / 6 tests` green、targeted ESLint green、
  targeted `git diff --check` green。初回 Prettier check は
  `billing/partner-cooperation/page.test.tsx` を指摘したため、targeted `prettier --write` 後に
  focused tests / Prettier check を再実行して green。`pnpm typecheck` green。
  `rg -n "<Suspense fallback=\\{<Loading />\\}" 'src/app/(dashboard)/billing' --glob 'page.tsx'`
  は no matches。
- commit: `8f673aa4` (`fix(billing): close route loading fallbacks`)。
- 残課題: billing route-shell generic fallback は closure。broad Plans.md / R55 residual scan は継続。
  `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 generic visible loading closure

- 分類: UI loading-state cleanup / R55 component-level generic visible loading residual closure。
- 実施:
  - `DataTable` の load-more pending label を generic `読み込み中...` から
    `追加行を読み込み中...` へ変更。
  - platform tenant data explorer の model selector loading copy を
    `データモデルを読み込み中...` へ変更。
  - `data-table.test.tsx` と `data-explorer-panel.test.tsx` で、画面/領域固有 loading label と
    generic copy absence を固定。
- 挙動変更: loading label のみ。DataTable pagination/filter/export behavior、platform break-glass requirement、
  tenant data explorer query、API path、org header、API/DB/auth/authorization/billing/audit は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の Clear state / false-empty prevention と
  loading は画面/領域固有 label を持つ規範に整合。
- 安全性: product API/DB/auth/authorization/PHI projection/billing/deploy/package dependency は不変。
  Loading copy は PHI-free で、row value・patient identifier・table data・tenant/org id・request detail・raw error・billing value・break-glass reason
  を出さない。
- 検証: focused DataTable/platform data explorer Vitest `2 files / 16 tests` green、
  targeted ESLint green、targeted Prettier check green、targeted `git diff --check` green、
  `pnpm typecheck` green。targeted generic visible loading scan は no matches。
- commit: `07696837` (`fix(loading): close generic visible labels`)。
- 残課題: targeted R55 generic visible loading residual は closure。broad Plans.md は継続。
  `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 component loading copy closure

- 分類: UI loading-state cleanup / R55 component-level generic visible loading residual。
- 実施:
  - `external/external-viewer-content.tsx` の panel skeleton status を generic
    `読み込み中` から `外部連携パネルを読み込み中` へ変更。
  - `billing/candidates/billing-candidates-content.tsx` の load-more pending label を
    `月次請求候補を読み込み中...` へ変更。
  - `prescriptions/prescriptions-workspace.tsx` の load-more pending label を
    `処方一覧を読み込み中...` へ変更。
  - 3 component test を追加/拡張し、画面固有 loading label が出ることと generic
    `読み込み中` / `読み込み中...` が出ないことを固定。
- 挙動変更: loading label のみ。external collaboration query、billing candidates API/export preview semantics、
  prescription list infinite query、API path、org header、API/DB/auth/authorization/billing/audit は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の Clear state / false-empty prevention と
  loading UI は軽量で意味のある state にする Next loading/Suspense guidance に整合。
- 安全性: product API/DB/auth/authorization/PHI projection/billing/deploy/package dependency は不変。
  Loading copy は PHI-free で、patient name/id・prescription detail・billing candidate value・external collaboration request detail・billing amount・org id・raw error
  を出さない。
- 検証: focused external/billing/prescriptions component Vitest `3 files / 24 tests` green、
  targeted ESLint green、targeted Prettier check は `billing-candidates-content.test.tsx` と
  `prescriptions-workspace.tsx` の targeted format 後 green、targeted `git diff --check` green、
  `pnpm typecheck` green。residual generic visible loading scan は
  `src/app/platform/tenants/[orgId]/data-explorer-panel.tsx` と `src/components/ui/data-table.tsx`
  のみ。
- commit: `1bbc9ca6` (`fix(loading): name list loading states`)。
- 残課題: component-level generic visible loading residual は platform data explorer と shared
  DataTable default `loadingLabel` の別 triage が必要。broad Plans.md は継続。
  `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 workflow and tasks route loading labels

- 分類: UI loading-state cleanup / R55 route-shell generic loading residual。
- 実施:
  - `workflow/page.tsx` の route-level Suspense fallback を generic `Loading` から
    `ワークフローダッシュボードを読み込み中...` の画面固有 status へ変更。
  - `workflow/pharmacy-cooperation/page.tsx` を
    `薬局間協力ワークフローを読み込み中...`、`tasks/page.tsx` を
    `タスクを読み込み中...` に変更。
  - 3 route の page test を追加し、generic `読み込み中...` が出ないこと、suspended content が出ないこと、
    workflow/tasks の search param wiring が保持されることを固定。
- 挙動変更: route-shell loading label のみ。workflow dashboard content query、
  pharmacy-cooperation workflow content query、task list query、task mutation、
  work-request creation flow、search param parsing semantics、API path、org header、
  API/DB/auth/authorization/billing/audit は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の Clear state / false-empty prevention と
  route fallback は軽量で意味のある loading UI にする Next loading/Suspense guidance に整合。
- 安全性: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は不変。
  Loading copy は PHI-free で、workflow item detail・patient identifier・task title/description・partner pharmacy detail・billing value・org id・raw error
  を出さない。
- 検証: focused workflow/tasks route fallback Vitest `3 files / 6 tests` green、
  targeted ESLint green、targeted Prettier check green、targeted `git diff --check` green、
  `pnpm typecheck` green。
  `rg -n "<Suspense fallback=\\{<Loading />\\}" 'src/app/(dashboard)/workflow' 'src/app/(dashboard)/tasks' --glob 'page.tsx'`
  は no matches。
- commit: `d172cd27` (`fix(workflow): name route loading fallbacks`)。
- 残課題: workflow/tasks route-shell generic fallback は closure。dashboard-wide generic fallback scan は
  workflow/tasks 外で `15` matches。broad Plans.md / R55 residual scan は継続。
  `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 general route loading labels

- 分類: UI loading-state cleanup / R55 route-shell generic loading residual。
- 実施:
  - `reports/analytics/page.tsx` の route-level Suspense fallback を
    `報告書送達分析を読み込み中...` の画面固有 status へ変更。
  - `communications/requests/page.tsx` を `依頼・照会一覧を読み込み中...`、
    `notifications/page.tsx` を `お知らせを読み込み中...`、`search/page.tsx` を
    `全体検索を読み込み中...`、`external/page.tsx` を `外部連携ビューを読み込み中...`、
    `conferences/page.tsx` を `カンファレンスノートを読み込み中...`、`settings/page.tsx` を
    `設定を読み込み中...` に変更。
  - 7 route の page test を追加/拡張し、generic `読み込み中...` が出ないこと、suspended content が出ないこと、
    search param wiring がある route ではそれが保持されることを固定。
- 挙動変更: route-shell loading label のみ。report delivery query、communication request query、
  notification query、search behavior、external viewer query、conference query、
  operational policy content behavior、search param parsing semantics、API path、org header、
  API/DB/auth/authorization/billing/audit は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の Clear state / false-empty prevention と
  route fallback は軽量で意味のある loading UI にする Next loading/Suspense guidance に整合。
- 安全性: product API/DB/auth/authorization/PHI/billing/deploy/package dependency は不変。
  Loading copy は PHI-free で、report recipient・request detail・notification content・search result detail・external-share detail・conference-note content・policy value・patient identifier・billing value・org id・raw error
  を出さない。
- 検証: focused general route fallback Vitest `7 files / 14 tests` green、
  targeted ESLint green、targeted Prettier check は `communications/requests/page.test.tsx` の
  targeted format 後 green、targeted `git diff --check` green、`pnpm typecheck` green。
  対象7 route の generic fallback scan は no matches。dashboard-wide generic fallback scan は
  patient / prescription / schedule route shell に `8` matches。
- commit: `147c81bb` (`fix(routes): name general loading fallbacks`)。
- 残課題: general route-shell generic fallback は closure。broad Plans.md / R55 residual scan は継続。
  `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 patient/prescription/schedule route loading closure

- 分類: UI loading-state cleanup / R55 route-shell generic loading residual closure。
- 実施:
  - `prescriptions/[id]/page.tsx` の route-level Suspense fallback を
    `処方受付詳細を読み込み中...` の画面固有 status へ変更。
  - `prescriptions/intake/page.tsx` を `処方取込を読み込み中...`、`schedules/page.tsx` の
    calendar boundary を `訪問カレンダーを読み込み中...`、`patients/compare/page.tsx` を
    `患者カード比較を読み込み中...`、`patients/[id]/page.tsx` を
    `患者カードを読み込み中...`、`patients/[id]/share/page.tsx` を
    `他職種向け共有ページを読み込み中...`、`patients/[id]/collaboration/page.tsx` を
    `共同編集状況を読み込み中...`、`patients/[id]/safety-check/page.tsx` を
    `薬の安全チェックを読み込み中...` に変更。
  - 8 route の page test を追加/拡張し、generic `読み込み中...` が出ないこと、suspended content が出ないこと、
    route param/search param wiring が保持されることを固定。
- 挙動変更: route-shell loading label のみ。prescription detail query、intake triage query、
  schedule board/calendar query、patient compare query、patient card overview resolution semantics、
  external share query、collaboration query、safety-check query、route helper、search param parsing、
  API path、org header、API/DB/auth/authorization/billing/audit は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の Clear state / false-empty prevention と
  route fallback は軽量で意味のある loading UI にする Next loading/Suspense guidance に整合。
- 安全性: product API/DB/auth/authorization/PHI projection/billing/deploy/package dependency は不変。
  Loading copy は PHI-free で、patient name/id・prescription detail・intake id・medication name・schedule date・visit detail・external-share recipient・collaboration note・safety-check finding・billing value・org id・raw error
  を出さない。
- 検証: focused patient/prescription/schedule route fallback Vitest `8 files / 16 tests` green、
  targeted ESLint green、targeted Prettier check green、targeted `git diff --check` green、
  `pnpm typecheck` green。dashboard-wide
  `rg -n "<Suspense fallback=\\{<Loading />\\}" 'src/app/(dashboard)' --glob 'page.tsx'`
  は no matches。
- commit: `eec7e953` (`fix(routes): close patient loading fallbacks`)。
- 残課題: dashboard route-level generic fallback は closure。broad Plans.md / R55 residual scan は継続。
  `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R55 generic Loading component closure

- 分類: UI loading-state cleanup / R55 generic Loading residual。
- 実施:
  - `shared/[token]/page.tsx` の external shared viewer Suspense fallback を generic
    `<Loading />` から `共有ページを読み込み中...` の画面固有 status へ変更。
  - `admin/pca-pumps/loading.tsx` の segment loading file を generic `<Loading />` から
    `PCAポンプレンタルを読み込み中...` へ変更。
  - 2 route/loading file の tests を追加し、generic `読み込み中...` が出ないこと、
    suspended content が出ないこと、route token wiring が保持されることを固定。
- 挙動変更: loading label のみ。external shared viewer query、OTP redirect behavior、
  token handling、shared content projection、PCA pump query、API path、org header、
  API/DB/auth/authorization/billing/audit は不変。
- UI/UX根拠: `docs/ui-ux-design-guidelines.md` の Clear state / false-empty prevention と
  loading UI は軽量で意味のある state にする Next loading/Suspense guidance に整合。
- 安全性: product API/DB/auth/authorization/PHI projection/billing/deploy/package dependency は不変。
  Loading copy は PHI-free で、token value・patient name・medication detail・visit schedule・self-report content・recipient・billing value・org id・raw error
  を出さない。
- 検証: focused shared/PCA loading Vitest `2 files / 3 tests` green、targeted ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
  targeted generic `<Loading />` scan と whole app/component generic `<Loading />` scan は no matches。
- commit: `40ce6f25` (`fix(loading): name remaining loading states`)。
- 残課題: raw `<Loading />` は closure。R55 は component-level generic visible `読み込み中...` と
  non-skeleton loading copy の再triageを継続。`refactor-instructions.md` と
  `.agents/skills/**` / `skills-lock.json` は別スライスとして保持する。

## 2026-07-04 R33 billing-evidence date-boundary convergence

- 分類: dup-helper / billing-evidence month boundary helper convergence。
- 実施:
  - `src/server/services/billing-evidence/core.ts` の private JST offset/month-part 計算を削除し、
    `src/lib/utils/date-boundary.ts` の `japanDateKey` / `japanMonthInstantRange` /
    `utcMonthDateRange` 経由へ収束。
  - 既存公開 helper (`startOfMonth` / `endOfMonth` / `billingMonthForJapanTimestamp` /
    `japanMonthRangeForBillingMonth`) の名前と返却 shape は維持。
  - `billingMonthForJapanTimestamp` が UTC runtime の JST 月初境界
    (`2026-05-31T15:00:00.000Z`) で正しい canonical billing month を返す回帰テストを追加。
- 挙動変更: helper 実装元の統合のみ。billing candidate/evidence API shape、DB query predicate shape、
  billing amount/rule semantics、auth、authorization、PHI projection、audit、deployment、
  package dependency は不変。
- 安全性: billing 隣接 refactor のため、JST 月境界の過大/過少請求リスクを focused test で固定。
  PHI、secret、raw payload、patient identifier の新規露出なし。migration/deploy/live DB operation は未実施。
- 検証: `billing-evidence/core.test.ts` 単体 `80 tests` green。関連 billing/API focused Vitest
  `9 files / 163 tests` green。scoped ESLint、targeted Prettier check、targeted `git diff --check`、
  `pnpm typecheck` green。
- commit: `4561a33d` (`refactor(billing): use date boundary month helpers`)。
- 残課題: R33 は closure。broad Plans.md objective は継続。未所有
  `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-04 R35 ErrorState/EmptyState renderer convergence

- 分類: type-drift / UI state renderer convergence。
- 実施:
  - `src/components/ui/state-elements.tsx` を追加し、state UI 共通の
    `StateHeading` / `StateActionButton` / `StateAction` を定義。
  - `ErrorState` の local `renderAction` / `ErrorStateHeading` を削除し、共有 helper へ移行。
  - `EmptyState` の local `EmptyStateHeading` と href/onClick action 分岐を削除し、共有 helper へ移行。
  - `EmptyState` の既定 action size は従来どおり `sm`、`ErrorState` の既定 action size は
    従来どおり `default` に維持。
- 挙動変更: UI component 内部の renderer convergence のみ。既存 props、heading level、
  link/button action rendering、live-region behavior、copy、DOM contract は維持。
- 安全性: product API、DB、auth、authorization、PHI projection、billing、audit、deployment、
  package dependency、live DB operation、external send、secret handling、push、destructive operation は不変。
- 検証: focused `error-state.test.tsx` + `empty-state.test.tsx` は `2 files / 8 tests` green。
  duplicate local renderer scan は no matches。scoped ESLint、targeted Prettier check、
  targeted `git diff --check`、`pnpm typecheck` green。
- commit: `80a77b03` (`refactor(ui): share state action renderers`)。
- 残課題: R35 は closure。broad Plans.md objective は継続。未所有
  `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-04 R25 admin ErrorState retry shorthand slice

- 分類: pattern-inconsistency / ErrorState retry action convergence。
- 実施:
  - `ErrorState` に `retryLabel` を追加し、既存 `onRetry` shorthand で「再読み込み」などの
    画面固有 retry copy を維持できるようにした。
  - `admin/analytics` の初回失敗 ErrorState 2箇所を
    `action={{ label: '再読み込み', onClick }}` から `onRetry` + `retryLabel` へ移行。
  - `admin/realtime` の ErrorState 3箇所を同じ shorthand へ移行。
  - explicit `action` が指定された場合は従来どおり `onRetry` より優先される契約を維持。
- 挙動変更: ErrorState retry prop shape の追加と呼び出し側の定型句整理のみ。表示ラベル、
  click handler、live-region behavior、copy、admin analytics/realtime query behavior は維持。
- 安全性: UI presentation/refactor only。product API、DB、auth、authorization、PHI projection、
  billing、audit、deployment、package dependency、live DB operation、external send、secret handling、
  push、destructive operation は不変。
- 検証: focused Vitest `error-state.test.tsx` + `admin/analytics/analytics-content.test.tsx` +
  `admin/realtime/page.test.tsx` は `3 files / 28 tests` green。対象2画面の hand-rolled
  `action={{ label: '再読み込み' ... }}` scan は no matches。scoped ESLint、targeted Prettier check、
  targeted `git diff --check`、`pnpm typecheck` green。
- commit: `2e8589a4` (`refactor(ui): route admin error retries through shorthand`)。
- 残課題: R25 は partial。admin analytics/realtime 以外の ErrorState retry action は段階移行を継続。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R24/R46 billing-candidates cursor helper slice

- 分類: pattern-inconsistency / 手組み cursor page assembly → `buildCursorPage` 収束。
- 実施:
  - `/api/billing-candidates` GET の route-local `hasMore` / `slice` / `nextCursor`
    assembly を `src/lib/api/pagination.ts` の `buildCursorPage` へ移行。
  - additive `summary` は従来どおり page envelope に併合し、`data` / `hasMore` /
    `nextCursor` / `summary` の overflow response contract を test-lock。
  - `limit=1` で `take: 2`、visible row 1件、hidden overflow row 非露出、
    `nextCursor: candidate_1` を route test に追加。
- 挙動変更: API内部の重複 helper 収束のみ。外部 response envelope、billing candidate
  list semantics、summary semantics、POST generation behavior は維持。
- 安全性: `canManageBilling`、RLS `withOrgContext`、query validation、sensitive no-store、
  billing-domain/month/status behavior、PHI-minimizing source snapshot sanitization、DB query
  shape、schema/migrations/data、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation は不変。
- 検証: focused billing-candidates/pagination Vitest `2 files / 48 tests` green、scoped ESLint
  green、targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `b4185e59` (`refactor(api): reuse cursor page helper in billing candidates`)。
- 残課題: R24/R46 は partial。`meta.has_more`、keyset cursor encoding、scan-window、
  hidden-count、summary/count metadata を持つ route は route-specific analysis 後に継続。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R24/R46 medication-cycles cursor helper slice

- 分類: pattern-inconsistency / 手組み offset cursor page assembly → `buildCursorPage` 収束。
- 実施:
  - `/api/medication-cycles` GET の route-local `hasMore` / `slice` / numeric
    `nextCursor` assembly を `buildCursorPage` へ移行。
  - `cursorOf` は行IDではなく既存 contract の `String(offset + limit)` を返す closure にし、
    numeric offset cursor semantics を維持。
  - `limit=1` で `take: 2`、visible cycle id 1件、`totalCount` 維持、
    `nextCursor: "1"` を route test に追加。
- 挙動変更: API内部の重複 helper 収束のみ。外部 response envelope/key order、offset cursor
  semantics、GET filter behavior、POST create behavior は維持。
- 安全性: `canDispense`、assignment-scope filtering、strict status/case/patient filter validation、
  sensitive no-store、count behavior、DB query shape、schema/migrations/data、billing、deployment、
  package dependency、live DB operation、external send、secret handling、push、destructive operation は不変。
- 検証: focused medication-cycles/pagination Vitest `2 files / 33 tests` green、scoped ESLint
  green、targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `c8f03405` (`refactor(api): reuse cursor page helper in medication cycles`)。
- 残課題: R24/R46 は partial。`meta.has_more`、keyset cursor encoding、scan-window、
  hidden-count、route-specific metadata を持つ route は個別分析後に継続。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R24/R46 consent-records cursor helper slice

- 分類: pattern-inconsistency / 手組み cursor page assembly → `buildCursorPage` 収束。
- 実施:
  - `/api/consent-records` GET の route-local `hasMore` / `slice` / `nextCursor`
    assembly を `buildCursorPage` へ移行。
  - `limit=1` overflow で visible consent 1件、`nextCursor: consent_1`、`totalCount` 維持、
    document URL redaction、view-audit が visible record metadata のみを受け取ることを test-lock。
- 挙動変更: API内部の重複 helper 収束のみ。外部 response envelope/key order、consent list
  semantics、GET audit behavior、POST create behavior は維持。
- 安全性: `canVisit`、request auth context、patient access checks、consent-type/is-active/cursor behavior、
  sensitive no-store、document URL redaction、view-audit fail-closed behavior、visible-record-only
  audit metadata、DB query shape、schema/migrations/data、billing、deployment、package dependency、
  live DB operation、external send、secret handling、push、destructive operation は不変。
- 検証: focused consent-records/pagination Vitest `2 files / 23 tests` green、scoped ESLint
  green、targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `fd774353` (`refactor(api): reuse cursor page helper in consent records`)。
- 残課題: R24/R46 は partial。`meta.has_more`、keyset cursor encoding、scan-window、
  hidden-count、route-specific metadata を持つ route は個別分析後に継続。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R24/R46 correction-requests audit cursor helper slice

- 分類: pattern-inconsistency / view-audit visible-row slicing → `buildCursorPage` 収束。
- 実施:
  - `/api/patient-share-cases/[id]/correction-requests` GET で、response page と view-audit
    metadata が同じ `buildCursorPage` 結果を共有するよう変更。
  - `limit=1` overflow で visible correction request 1件、`nextCursor: correction_1`、
    audit の `correction_request_ids/statuses/has_more` が visible page と一致することを test-lock。
- 挙動変更: API内部の重複 helper 収束のみ。外部 response page contract、share-case scoping、
  status filter behavior、GET audit behavior、POST behavior は維持。
- 安全性: `canVisit`、`withOrgContext`、share-case scoping、sensitive no-store、response PHI
  minimization、view-audit fail-closed behavior、visible-row-only audit metadata、DB query shape、
  schema/migrations/data、billing、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation は不変。
- 検証: focused correction-requests/pagination Vitest `2 files / 25 tests` green、scoped ESLint
  green、targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `5febff57` (`refactor(api): reuse cursor page helper in correction request audits`)。
- 残課題: R24/R46 は partial。`meta.has_more`、keyset cursor encoding、scan-window、
  hidden-count、route-specific metadata を持つ route は個別分析後に継続。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R24/R46 admin-facilities search cursor helper slice

- 分類: pattern-inconsistency / 手組み visible-row selection → `buildCursorPage` 収束。
- 実施:
  - `/api/admin/facilities` GET search mode の `facilities.length > limit` と
    `slice(0, limit)` を `buildCursorPage` へ移行。
  - route-specific contract として `nextCursor` は外部に出さず、`hasMore || hidden_count > 0`、
    total/visible/hidden/truncated metadata、patient-count enrichment を維持。
- 挙動変更: API内部の重複 helper 収束のみ。外部 response shape、facility search semantics、
  no-store、POST behavior は維持。
- 安全性: `canVisit`、search query normalization、minimal facility projection、count/truncated metadata、
  DB query shape、auth/authorization、PHI projection、billing、deployment、package dependency、
  live DB operation、external send、secret handling、push、destructive operation は不変。
- 検証: focused admin-facilities/pagination Vitest `2 files / 16 tests` green、scoped ESLint
  green、targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
  stderr は既存 sanitized-500 ケースの logger 出力で、テストは raw error 非露出を確認済み。
- commit: `44cb279a` (`refactor(api): reuse cursor page helper in facility search`)。
- 残課題: R24/R46 は partial。`meta.has_more`、keyset cursor encoding、scan-window、
  hidden-count、route-specific metadata を持つ route は個別分析後に継続。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R24/R46 share-consents audit cursor helper slice

- 分類: pattern-inconsistency / view-audit visible-row slicing → `buildCursorPage` 収束。
- 実施:
  - `/api/patient-share-cases/[id]/consents` GET で、response page と view-audit metadata が
    同じ `buildCursorPage` 結果を共有するよう変更。
  - `limit=1` overflow で visible consent 1件、`nextCursor: share_consent_1`、raw consent
    person 非露出、audit の visible consent ids/counts が response page と一致することを test-lock。
- 挙動変更: API内部の重複 helper 収束のみ。外部 response page contract、share-case scoping、
  GET audit behavior、POST validation/link checks は維持。
- 安全性: `canVisit`、`withOrgContext`、share-case scoping、sensitive no-store、response PHI
  minimization、view-audit fail-closed behavior、visible-row-only audit metadata、DB query shape、
  schema/migrations/data、billing、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation は不変。
- 検証: focused share-consents/pagination Vitest `2 files / 17 tests` green、scoped ESLint
  green、targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `95ed181d` (`refactor(api): reuse cursor page helper in share consent audits`)。
- 残課題: R24/R46 は partial。`meta.has_more`、keyset cursor encoding、scan-window、
  hidden-count、route-specific metadata を持つ route は個別分析後に継続。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R24/R46 available-shifts cursor helper slice

- 分類: pattern-inconsistency / 手組み visible-row selection → `buildCursorPage` 収束。
- 実施:
  - `/api/pharmacist-shifts/available` GET の `shifts.length > limit` と `slice(0, limit)` を
    `buildCursorPage` へ移行。
  - route-specific contract として `meta: { limit, has_more }` を維持し、org-wide closure の
    empty response は従来通り。
- 挙動変更: API内部の重複 helper 収束のみ。外部 response shape、business-holiday closure filtering、
  time-window filtering、RLS request context、no-store は維持。
- 安全性: `canVisit`、request auth context、RLS request context、DB query shape、auth/authorization、
  PHI projection、billing、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation は不変。
- 検証: focused available-shifts/pagination Vitest `2 files / 21 tests` green、scoped ESLint
  green、targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `14904154` (`refactor(api): reuse cursor page helper in available shifts`)。
- 残課題: R24/R46 は partial。keyset cursor encoding、scan-window、hidden-count、
  route-specific metadata を持つ route は個別分析後に継続。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R24/R46 pca-pumps search cursor helper slice

- 分類: pattern-inconsistency / q-filtered visible-row selection → `buildCursorPage` 収束。
- 実施:
  - `/api/pca-pumps` GET q-filtered search の `slice(0, limit)` と `length > limit` を
    `buildCursorPage` へ移行。
  - unfiltered full-ledger response は `meta` なしのまま維持し、q-filtered response は
    `meta: { limit, has_more }` のまま維持。
- 挙動変更: API内部の重複 helper 収束のみ。外部 response shape、q/status filter behavior、
  PCA pump serialization、POST create/audit behavior は維持。
- 安全性: `canReport`、request auth context、RLS request context、DB query shape、
  auth/authorization、PHI projection、billing、deployment、package dependency、live DB operation、
  external send、secret handling、push、destructive operation は不変。
- 検証: focused pca-pumps/pagination Vitest `2 files / 22 tests` green、scoped ESLint
  green、targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `682a17cc` (`refactor(api): reuse cursor page helper in pca pump search`)。
- 残課題: R24/R46 は partial。keyset cursor encoding、scan-window、hidden-count、
  route-specific metadata を持つ route は個別分析後に継続。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R24/R46 prescriber-institutions search cursor helper slice

- 分類: pattern-inconsistency / q-filtered visible-row selection → `buildCursorPage` 収束。
- 実施:
  - `/api/prescriber-institutions` GET q-filtered search の `slice(0, limit)` と
    `length > limit` を `buildCursorPage` へ移行。
  - unfiltered full-list response は `meta` なしのまま維持し、q-filtered response は
    `meta: { limit, has_more }` のまま維持。
- 挙動変更: API内部の重複 helper 収束のみ。外部 response shape、q filter behavior、
  prescriber institution serialization、POST create behavior は維持。
- 安全性: `canReport`、request auth context、RLS org filtering、DB query shape、
  auth/authorization、PHI projection、billing、deployment、package dependency、live DB operation、
  external send、secret handling、push、destructive operation は不変。
- 検証: focused prescriber-institutions/pagination Vitest `2 files / 21 tests` green、
  scoped ESLint green、targeted Prettier check green、targeted `git diff --check` green、
  `pnpm typecheck` green。
- commit: `900d0c1d` (`refactor(api): reuse cursor page helper in prescriber institutions`)。
- 残課題: R24/R46 は partial。keyset cursor encoding、scan-window、hidden-count、
  optional-limit semantics、route-specific metadata を持つ route は個別分析後に継続。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R24/R46 me-sites cursor helper slice

- 分類: pattern-inconsistency / visible-row selection → `buildCursorPage` 収束。
- 実施:
  - `/api/me/sites` GET の `sites.length > limit` と `slice(0, limit)` を
    `buildCursorPage` へ移行。
  - returned site ids を元に visit count を集計する trim-before-count semantics と
    `meta: { limit, has_more }` は維持。
- 挙動変更: API内部の重複 helper 収束のみ。外部 response shape、membership scoping、
  today visit count scope、default-site flag behavior は維持。
- 安全性: `withAuthContext`、membership scoping、org filtering、DB query shape、
  auth/authorization、PHI projection、billing、deployment、package dependency、live DB operation、
  external send、secret handling、push、destructive operation は不変。
- 検証: focused me-sites/pagination Vitest `2 files / 15 tests` green、scoped ESLint
  green、targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `bff89499` (`refactor(api): reuse cursor page helper in my sites`)。
- 残課題: R24/R46 は partial。keyset cursor encoding、scan-window、hidden-count、
  optional-limit semantics、route-specific metadata を持つ route は個別分析後に継続。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R24/R46 pharmacist-shifts cursor helper slice

- 分類: pattern-inconsistency / explicit-limit visible-row selection → `buildCursorPage` 収束。
- 実施:
  - `/api/pharmacist-shifts` GET の explicit `limit` 指定時の `shifts.length > limit` と
    `slice(0, limit)` を `buildCursorPage` へ移行。
  - no-limit request は従来通り `take` なし、full-list response、`meta` なしのまま維持。
- 挙動変更: API内部の重複 helper 収束のみ。外部 response shape、month/date/user/site filters、
  no-limit/no-meta contract、POST create behavior は維持。
- 安全性: `canVisit`、request auth context、RLS request context、DB query shape、
  auth/authorization、PHI projection、billing、deployment、package dependency、live DB operation、
  external send、secret handling、push、destructive operation は不変。
- 検証: focused pharmacist-shifts/pagination Vitest `2 files / 26 tests` green、
  scoped ESLint green、targeted Prettier check green、targeted `git diff --check` green、
  `pnpm typecheck` green。
- commit: `53b069b6` (`refactor(api): reuse cursor page helper in pharmacist shifts`)。
- 残課題: R24/R46 は partial。keyset cursor encoding、scan-window、hidden-count、
  route-specific metadata を持つ route は個別分析後に継続。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R24/R46 inquiry-records cursor helper slice

- 分類: pattern-inconsistency / explicit-limit visible-row selection → `buildCursorPage` 収束。
- 実施:
  - `/api/inquiry-records` GET の explicit `limit` 指定時の `records.length > limit` と
    `slice(0, limit)` を `buildCursorPage` へ移行。
  - no-limit request は従来通り `take` なし、full-list response、`meta` なしのまま維持。
- 挙動変更: API内部の重複 helper 収束のみ。外部 response shape、cycle/patient/status filters、
  medication-cycle assignment access filter、no-limit/no-meta contract、POST create/audit/task
  behavior は維持。
- 安全性: `canVisit`、request auth context、authorization/access filter、DB query shape、
  auth/authorization、PHI projection、billing、deployment、package dependency、live DB operation、
  external send、secret handling、push、destructive operation は不変。
- 検証: focused inquiry-records/pagination Vitest `2 files / 27 tests` green、
  scoped ESLint green、targeted Prettier check green、targeted `git diff --check` green、
  `pnpm typecheck` green。
- commit: `b05e1880` (`refactor(api): reuse cursor page helper in inquiry records`)。
- 残課題: R24/R46 は partial。keyset cursor encoding、scan-window、hidden-count、
  route-specific metadata を持つ route は個別分析後に継続。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R24/R46 facility-patients cursor helper slice

- 分類: pattern-inconsistency / hidden-count visible-row selection → `buildCursorPage` 収束。
- 実施:
  - `/api/facilities/[id]/patients` GET の `fetchedResidences.length > limit` と
    `slice(0, limit)` を `buildCursorPage` へ移行。
  - `metadata.total_count`、`visible_count`、`hidden_count`、
    `has_more = page overflow || hidden_count > 0` は維持。
- 挙動変更: API内部の重複 helper 収束のみ。外部 response shape、facility/org scoping、
  archive filters、care-case assignment access filter、sensitive no-store は維持。
- 安全性: `canVisit`、authorization/access filter、DB query shape、auth/authorization、
  PHI projection、billing、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation は不変。
- 検証: focused facility-patients/pagination Vitest `2 files / 13 tests` green、
  scoped ESLint green、targeted Prettier check green、targeted `git diff --check` green、
  `pnpm typecheck` green。
- commit: `af10fb35` (`refactor(api): reuse cursor page helper in facility patients`)。
- 残課題: R24/R46 は partial。keyset cursor encoding、scan-window、hidden-count variants、
  route-specific metadata を持つ route は個別分析後に継続。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R24/R46 external-professional-patients cursor helper slice

- 分類: pattern-inconsistency / hidden-count visible-row selection → `buildCursorPage` 収束。
- 実施:
  - `/api/admin/external-professionals/[id]/patients` GET の `fetchedLinks.length > limit` と
    `slice(0, limit)` を `buildCursorPage` へ移行。
  - `metadata.total_count`、`visible_count`、`hidden_count`、
    `has_more = page overflow || hidden_count > 0` は維持。
- 挙動変更: API内部の重複 helper 収束のみ。外部 response shape、
  external-professional/org scoping、archive filters、care-case assignment access filter、
  sensitive no-store は維持。
- 安全性: `canReport`、authorization/access filter、DB query shape、auth/authorization、
  PHI projection、billing、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation は不変。
- 検証: focused external-professional-patients/pagination Vitest `2 files / 12 tests` green、
  scoped ESLint green、targeted Prettier check green、targeted `git diff --check` green、
  `pnpm typecheck` green。
- commit: `94aedb79`
  (`refactor(api): reuse cursor page helper in external professional patients`)。
- 残課題: R24/R46 は partial。keyset cursor encoding、scan-window、hidden-count variants、
  route-specific metadata を持つ route は個別分析後に継続。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R24/R46 pharmacy-drug-stocks cursor helper slice

- 分類: pattern-inconsistency / hidden-count visible-row selection → `buildCursorPage` 収束。
- 実施:
  - `/api/pharmacy-drug-stocks` GET の `fetchedStocks.length > limit` と
    `slice(0, limit)` を `buildCursorPage` へ移行。
  - `metadata.total_count`、`visible_count`、`hidden_count`、
    `has_more = page overflow || hidden_count > 0`、site/q/review_due/missing_reorder_point
    filters は維持。
- 挙動変更: API内部の重複 helper 収束のみ。外部 response shape、site/org scoping、
  stock filters、sensitive no-store、sanitized 500 behavior は維持。
- 安全性: `canAdmin`、authorization/access filter、DB query shape、auth/authorization、
  PHI projection、billing、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation は不変。
- 検証: focused pharmacy-drug-stocks/pagination Vitest `2 files / 22 tests` green
  (sanitized 500 test の expected logger stderr あり)、scoped ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `c5563371` (`refactor(api): reuse cursor page helper in pharmacy drug stocks`)。
- 残課題: R24/R46 は partial。keyset cursor encoding、scan-window、hidden-count variants、
  summary/route-specific metadata を持つ route は個別分析後に継続。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R24/R46 drug-masters cursor helper slice

- 分類: pattern-inconsistency / search visible-row selection → `buildCursorPage` 収束。
- 実施:
  - `/api/drug-masters` GET search result の `drugs.length > limit` と `slice(0, limit)` を
    `buildCursorPage` へ移行。
  - visible rows に対する generic price comparison lookup、optional site stock lookup、
    `hasMore`、`nextCursor`、`totalCount`、org-independent search cache semantics は維持。
- 挙動変更: API内部の重複 helper 収束のみ。外部 response shape、search/filter/sort/cursor params、
  includeTotal behavior、cache key behavior、no-store は維持。
- 安全性: request auth context、RLS request context、DB query shape、auth/authorization、
  PHI projection、billing、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation は不変。
- 検証: focused drug-masters/pagination Vitest `2 files / 22 tests` green、
  scoped ESLint green、targeted Prettier check green、targeted `git diff --check` green、
  `pnpm typecheck` green。
- commit: `d37b26fa` (`refactor(api): reuse cursor page helper in drug masters`)。
- 残課題: R24/R46 は partial。keyset cursor encoding、scan-window、summary/route-specific
  metadata を持つ route は個別分析後に継続。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R24/R46 patient-prescriptions cursor helper slice

- 分類: pattern-inconsistency / keyset visible-row selection → `buildCursorPage` 収束。
- 実施:
  - `/api/patients/[id]/prescriptions` GET の `intakes.length > limit`、`slice(0, limit)`、
    last visible row の keyset cursor assembly を `buildCursorPage` へ移行。
  - decoded cursor filtering、first-page diff-review/diff-meta semantics、
    `hasMore`、keyset `nextCursor` は維持。
- 挙動変更: API内部の重複 helper 収束のみ。外部 response shape、patient/case assignment access
  filter、RLS request context、sensitive no-store は維持。
- 安全性: `canViewMedication`、authorization/access filter、DB query shape、auth/authorization、
  PHI projection、billing、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation は不変。
- 検証: focused patient-prescriptions/pagination Vitest `2 files / 26 tests` green、
  scoped ESLint green、targeted Prettier check green、targeted `git diff --check` green、
  `pnpm typecheck` green。
- commit: `7771e6db` (`refactor(api): reuse cursor page helper in patient prescriptions`)。
- 残課題: R24/R46 は partial。scan-window、summary/route-specific metadata を持つ route は
  個別分析後に継続。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R24/R46 visit-records cursor helper slice

- 分類: pattern-inconsistency / keyset visible-row selection → `buildCursorPage` 収束。
- 実施:
  - `/api/visit-records` GET の `records.length > limit`、`slice(0, limit)`、
    last visible row の keyset cursor assembly を `buildCursorPage` へ移行。
  - decoded cursor filtering、history-summary visible-row semantics、
    evidence-gallery visible-row semantics、`hasMore`、keyset `nextCursor` は維持。
- 挙動変更: API内部の重複 helper 収束のみ。外部 response shape、visit schedule assignment
  access filter、RLS/request context、sensitive no-store は維持。
- 安全性: auth context、authorization/access filter、DB query shape、auth/authorization、
  PHI projection、billing、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation は不変。
- 検証: focused visit-records/pagination Vitest `2 files / 90 tests` green、
  scoped ESLint green、targeted Prettier check green、targeted `git diff --check` green、
  `pnpm typecheck` green。
- commit: `048a55c4` (`refactor(api): reuse cursor page helper in visit records`)。
- 残課題: R24/R46 は partial。scan-window、summary/route-specific metadata を持つ route は
  個別分析後に継続。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R24/R46 care-reports cursor helper slice

- 分類: pattern-inconsistency / palette + regular/keyword visible-row selection →
  `buildCursorPage` 収束。
- 実施:
  - `/api/care-reports` GET の palette path に残っていた
    `reports.length > resolvedPaletteLimit` と `slice(0, limit)` を `buildCursorPage` へ移行。
  - regular/keyword path の `paginated.length > limit`、`slice(0, limit)`、
    last visible row の `nextCursor` assembly を `buildCursorPage` へ移行。
  - patient name enrichment、content output policy、keyword filtering、`deliverySummary`、
    `hasMore`、`nextCursor` は維持。
- 挙動変更: API内部の重複 helper 収束のみ。外部 response shape、care-report access filter、
  RLS request context、palette unsupported-filter gate、sensitive no-store は維持。
- 安全性: auth context、authorization/access filter、DB query shape、auth/authorization、
  PHI projection、billing、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation は不変。
- 検証: focused care-reports/pagination Vitest `2 files / 75 tests` green、
  scoped ESLint green、targeted Prettier check green、targeted `git diff --check` green、
  `pnpm typecheck` green。
- commit: `bedc3197` (`refactor(api): reuse cursor page helper in care reports`)。
- 残課題: R24/R46 は partial。conference-notes scan-window と
  admin/external-professionals count-based q search は個別分析後に継続。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R24/R46 visit-schedule-proposals cursor helper slice

- 分類: pattern-inconsistency / palette visible-row selection → `buildCursorPage` 収束。
- 実施:
  - `/api/visit-schedule-proposals` GET palette path の
    `proposals.length > paletteLimit` と `slice(0, paletteLimit)` を
    `buildCursorPage` へ移行。
  - minimal palette select、assignment access filtering、pharmacist name-only
    enrichment、PHI redaction/no sensitive projection、`hasMore` は維持。
- 挙動変更: API内部の重複 helper 収束のみ。外部 response shape、
  visit schedule proposal palette semantics、sensitive no-store は維持。
- 安全性: auth context、authorization/access filter、DB query shape、auth/authorization、
  PHI projection、billing、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation は不変。
- 検証: focused visit-schedule-proposals/pagination Vitest `2 files / 97 tests` green
  (sanitized 500 test の expected logger stderr あり)、scoped ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `a8bdd918`
  (`refactor(api): reuse cursor page helper in visit schedule proposals`)。
- 残課題: R24/R46 は partial。conference-notes scan-window と
  admin/external-professionals count-based q search は個別分析後に継続。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R24/R46 conference-notes cursor helper slice

- 分類: pattern-inconsistency / billing-filtered scan-window visible-row selection →
  `buildCursorPage` 収束。
- 実施:
  - `/api/conference-notes` GET の billing-filtered path に残っていた
    `filteredRecords.length > limit`、`slice(0, limit)`、next-cursor assembly を
    `buildCursorPage` へ移行。
  - filter 後の visible page が under-fill しても scan window に overflow がある場合、
    `nextCursor` は scan-window 末尾 row id のままにする契約を test-lock。
- 挙動変更: API内部の重複 helper 収束のみ。外部 response shape、stable DB keyset cursor、
  summary projection、billing eligibility filtering、scan-window cursor semantics、
  sensitive no-store は維持。
- 安全性: `canReport`、auth context、authorization/access filter、DB query shape、
  auth/authorization、PHI projection、billing、deployment、package dependency、
  live DB operation、external send、secret handling、push、destructive operation は不変。
- 検証: focused conference-notes/pagination Vitest `2 files / 53 tests` green、
  scoped ESLint green、targeted Prettier check green、targeted `git diff --check` green、
  `pnpm typecheck` green。
- commit: `aa56ad04` (`refactor(api): reuse cursor page helper in conference notes`)。
- 残課題: R24/R46 は partial。admin/external-professionals count-based q search は
  個別分析後に継続。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R24/R46 external-professionals cursor helper slice

- 分類: pattern-inconsistency / count-based q-filtered visible-row selection →
  `buildCursorPage` 収束。
- 実施:
  - `/api/admin/external-professionals` GET の q-filtered path で `take: limit + 1`
    の overflow row を取得し、visible-row selection を `buildCursorPage` へ移行。
  - exact `count` に基づく `total_count` / `visible_count` / `hidden_count` /
    `truncated` / `meta.has_more`、filters、org scoping、public re-export smoke は維持。
- 挙動変更: API内部の重複 helper 収束のみ。外部 response shape、
  external professional search semantics、sensitive no-store は維持。
- 安全性: `canReport`、auth context、DB query filters、auth/authorization、
  PHI projection、billing、deployment、package dependency、live DB operation、
  external send、secret handling、push、destructive operation は不変。
- 検証: focused admin/public external-professionals/pagination Vitest
  `3 files / 27 tests` green、scoped ESLint green、targeted Prettier check green、
  targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `9e2a5204`
  (`refactor(api): reuse cursor page helper in external professionals`)。
- 残課題: R24/R46 の既知 backlog 文言はほぼ消化。current-code scan の残 hit は
  management-plans safety-limit、fixed-size admin utility list、external-access 専用 pagination
  などに分類し、別候補として扱う。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R24/R46 uat-feedback cursor helper slice

- 分類: pattern-inconsistency / fixed-limit visible-row selection → `buildCursorPage` 収束。
- 実施:
  - `/api/admin/uat-feedback` GET の固定上限 list で
    `feedback.length > UAT_FEEDBACK_LIST_LIMIT` と `slice(0, limit)` を
    `buildCursorPage` へ移行。
  - fixed `limit: 100`、`meta.has_more`、org scoping、sensitive no-store、
    POST/create audit behavior は維持。
- 挙動変更: API内部の重複 helper 収束のみ。外部 response shape と UAT feedback semantics は維持。
- 安全性: `canAdmin`、auth context、DB query shape、auth/authorization、PHI projection、
  billing、deployment、package dependency、live DB operation、external send、secret handling、
  push、destructive operation は不変。
- 検証: focused UAT feedback/pagination Vitest `2 files / 15 tests` green、
  scoped ESLint green、targeted Prettier check green、targeted `git diff --check` green、
  `pnpm typecheck` green。
- commit: `dd0a2022` (`refactor(api): reuse cursor page helper in uat feedback`)。
- 残課題: R24/R46 current-code residual hits は management-plans safety cap、
  external-access grant page helper、dashboard/export/domain-specific preview limit など
  intentional/specialized truncation として別分類を継続。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R40/R44 dashboard readApiJson slice

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 実施:
  - billing check dashboard fetcher の `if (!res.ok) throw` + `res.json()` を
    `readApiJson<{ data: BillingCheckResponse }>` へ移行。
  - clerk support dashboard fetcher の `if (!res.ok) throw` + `res.json()` を
    `readApiJson<{ data: ClerkSupportResponse }>` へ移行。
  - billing fetcher test の簡易 Response mock を既存 `jsonResponse` helper に変更し、
    `readApiJson` が使う標準 `Response.text()` contract に合わせた。
- 挙動変更: fetch 実装内部の helper 収束のみ。API path、`buildOrgHeaders`、React Query key、
  envelope unwrapping、画面表示は維持。
- 安全性: product UI fetch internals のみ変更。DB/schema、auth/authorization、PHI projection、
  billing/domain calculation、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation は不変。
  `use-nav-badges` は failed response body を読まない PHI-safe contract がテスト固定されていたため、
  今回の helper 化対象から除外。
- 検証: focused billing/clerk-support Vitest `2 files / 13 tests` green、
  scoped ESLint green、targeted Prettier check green、targeted `git diff --check` green、
  `pnpm typecheck` green。
- commit: `ad86ed34` (`refactor(ui): reuse readApiJson in dashboard fetchers`)。
- 残課題: R40/R44 は broad。追加の client fetcher は response body read が PHI-safe かを
  個別確認してから段階移行する。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R40/R44 dashboard cockpit readApiJson slice

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 実施:
  - dashboard cockpit fetcher の `if (!res.ok) throw` + `res.json()` を
    `readApiJson<{ data: DashboardCockpitResponse }>` へ移行。
- 挙動変更: fetch 実装内部の helper 収束のみ。scope query construction、API path、
  `buildOrgHeaders`、React Query key、envelope unwrapping、画面表示は維持。
- 安全性: product UI fetch internals のみ変更。DB/schema、auth/authorization、PHI projection、
  billing、deployment、package dependency、live DB operation、external send、secret handling、
  push、destructive operation は不変。
- 検証: focused dashboard cockpit Vitest `1 file / 15 tests` green、
  scoped ESLint green、targeted Prettier check green、targeted `git diff --check` green、
  `pnpm typecheck` green。
- commit: `200d24a0` (`refactor(ui): reuse readApiJson in dashboard cockpit`)。
- 残課題: R40/R44 は broad。追加の client fetcher は response body read が PHI-safe かを
  個別確認してから段階移行する。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R40/R44 workflow dashboard readApiJson slice

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 実施:
  - workflow dashboard GET query fetcher の `if (!res.ok) throw` + `res.json()` を
    `readApiJson<{ data: WorkflowData }>` へ移行。
  - queryFn contract test を追加し、既存 `stubJsonFetch` の標準 Response で API path、
    `x-org-id` header、query key、envelope を固定。
- 挙動変更: read fetch 実装内部の helper 収束のみ。API path、`buildOrgHeaders`、
  React Query key、envelope unwrapping、画面表示、mutation behavior は維持。
- 安全性: product UI read fetch internals のみ変更。DB/schema、auth/authorization、
  PHI projection、billing、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation は不変。mutation の server-message parsing は
  route-specific error message 消費のため今回は維持。
- 検証: focused workflow dashboard Vitest `1 file / 8 tests` green、
  scoped ESLint green、targeted Prettier check green、targeted `git diff --check` green、
  `pnpm typecheck` green。
- commit: `f739f085` (`refactor(ui): reuse readApiJson in workflow dashboard`)。
- 残課題: R40/R44 は broad。追加の client fetcher は response body read が PHI-safe かを
  個別確認してから段階移行する。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R40/R44 intake triage readApiJson slice

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 実施:
  - prescription intake triage GET fetcher の `if (!res.ok) throw` + `res.json()` を
    `readApiJson<{ data: IntakeTriageResponse }>` へ移行。
  - 同ページの cockpit rail GET fetcher も
    `readApiJson<{ data: DashboardCockpitResponse }>` へ移行。
  - queryFn contract test を追加し、標準 Response mock で2 endpoint の API path、
    `x-org-id` header、query key、envelope を固定。
- 挙動変更: read fetch 実装内部の helper 収束のみ。API paths、`buildOrgHeaders`、
  React Query keys、envelope unwrapping、画面表示は維持。
- 安全性: product UI read fetch internals のみ変更。DB/schema、auth/authorization、
  PHI projection、billing、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation は不変。
- 検証: focused intake triage Vitest `1 file / 6 tests` green、
  scoped ESLint green、targeted Prettier check green、targeted `git diff --check` green、
  `pnpm typecheck` green。
- commit: `6a6a2390` (`refactor(ui): reuse readApiJson in intake triage`)。
- 残課題: R40/R44 は broad。追加の client fetcher は response body read が PHI-safe かを
  個別確認してから段階移行する。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R40/R44 schedule planner hooks readApiJson slice

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 実施:
  - schedule day planner の vehicle resources GET fetcher を
    `readApiJson<VisitVehicleResourceScheduleOptionsResponse>` へ移行。
  - schedule day planner の billing preview GET fetcher を
    `readApiJson<VisitScheduleBillingPreview>` へ移行。
- 挙動変更: read fetch 実装内部の helper 収束のみ。API paths、`buildOrgHeaders`、
  React Query keys、planner selection logic、billing preview semantics、画面表示は維持。
- 安全性: product UI read fetch internals のみ変更。DB/schema、auth/authorization、
  PHI projection、billing、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation は不変。
- 検証: focused schedule planner hooks Vitest `1 file / 4 tests` green、
  scoped ESLint green、targeted Prettier check green、targeted `git diff --check` green、
  `pnpm typecheck` green。
- commit: `5b7e6dea` (`refactor(ui): reuse readApiJson in schedule planner hooks`)。
- 残課題: R40/R44 は broad。追加の client fetcher は response body read が PHI-safe かを
  個別確認してから段階移行する。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R40/R44 operational policy readApiJson slice

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 実施:
  - settings operational-policy GET fetcher の `if (!res.ok) throw` +
    `res.json()` を `readApiJson<{ data: OperationalPolicyResponse }>` へ移行。
  - settings rail cockpit GET fetcher の `if (!res.ok) throw` + `res.json()` を
    `readApiJson<{ data: DashboardCockpitResponse }>` へ移行。
  - queryFn contract test を強化し、標準 Response mock で2 endpoint の API path、
    `buildOrgHeaders` header identity、query key、`data` envelope unwrap を固定。
- 挙動変更: read fetch 実装内部の helper 収束のみ。API paths、`buildOrgHeaders`、
  React Query keys、envelope unwrapping、画面表示、PATCH mutation の route-specific error
  message parsing は維持。
- 安全性: product UI read fetch internals のみ変更。DB/schema、auth/authorization、
  PHI projection、billing、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation は不変。SSOT では必要時の product
  API/DB/auth/authorization/PHI/billing/deploy/package dependency 変更許可を確認済みだが、
  この slice では不要。
- 検証: focused operational-policy Vitest `1 file / 7 tests` green、
  scoped ESLint green、targeted Prettier check green、targeted `git diff --check` green、
  `pnpm typecheck` green。
- commit: `057a14f2` (`refactor(ui): reuse readApiJson in operational policy`)。
- 残課題: R40/R44 は broad。追加の client fetcher は response body read が PHI-safe かを
  個別確認してから段階移行する。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R40/R44 service areas readApiJson slice

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 実施:
  - admin service-areas の `/api/pharmacy-sites` GET fetcher を
    `readApiJson<{ data: PharmacySite[] }>` へ移行。
  - admin service-areas の `SERVICE_AREAS_API_PATH` GET fetcher を
    `readApiJson<ServiceAreasResponse>` へ移行。
  - false-empty 防止テストは、既存 `readApiJson` 契約どおり server-provided message を
    surface する期待へ更新。
- 挙動変更: read fetch 実装内部の helper 収束のみ。API paths、`buildOrgHeaders`、
  React Query keys、response envelopes/count metadata、loading/error/empty 分岐、
  form validation、POST/PATCH/DELETE mutation、path helper encode/fail-closed semantics は維持。
- 安全性: product UI read fetch internals のみ変更。DB/schema、auth/authorization、
  PHI projection、billing、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation は不変。SSOT では必要時の product
  API/DB/auth/authorization/PHI/billing/deploy/package dependency 変更許可を確認済みだが、
  この slice では不要。
- 検証: focused service-areas Vitest `1 file / 15 tests` green、
  scoped ESLint green、targeted Prettier check green、targeted `git diff --check` green、
  `pnpm typecheck` green。
- commit: `87f34d8a` (`refactor(ui): reuse readApiJson in service areas`)。
- 残課題: R40/R44 は broad。追加の client fetcher は response body read が PHI-safe かを
  個別確認してから段階移行する。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R40/R44 business holidays readApiJson slice

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 実施:
  - admin business-holidays の `buildBusinessHolidaysApiPath(params)` GET fetcher を
    `readApiJson<{ data: Holiday[] }>` へ移行。
  - admin business-holidays の `/api/pharmacy-sites` GET fetcher を
    `readApiJson<{ data: SiteOption[] }>` へ移行。
- 挙動変更: read fetch 実装内部の helper 収束のみ。API paths、date/site params、
  `buildOrgHeaders`、React Query keys、response envelopes、static false-empty error UI、
  calendar/list/stat rendering、form validation、POST/PATCH/DELETE mutation、
  path helper encode/fail-closed semantics は維持。
- 安全性: product UI read fetch internals のみ変更。DB/schema、auth/authorization、
  PHI projection、billing、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation は不変。SSOT では必要時の product
  API/DB/auth/authorization/PHI/billing/deploy/package dependency 変更許可を確認済みだが、
  この slice では不要。
- 検証: focused business-holidays Vitest `1 file / 14 tests` green、
  scoped ESLint green、targeted Prettier check green、targeted `git diff --check` green、
  `pnpm typecheck` green。
- commit: `b557f856` (`refactor(ui): reuse readApiJson in business holidays`)。
- 残課題: R40/R44 は broad。追加の client fetcher は response body read が PHI-safe かを
  個別確認してから段階移行する。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R40/R44 institutions readApiJson slice

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 実施:
  - admin institutions の `buildPrescriberInstitutionsApiPath(params)` GET fetcher を
    `readApiJson<{ data: Institution[] }>` へ移行。
- 挙動変更: read fetch 実装内部の helper 収束のみ。API path helper、debounced search
  params、`buildOrgHeaders`、React Query key、response envelope、DataTable false-empty
  error state、admin action gating、contact copy、POST/PATCH/DELETE mutation、
  path helper encode/fail-closed semantics は維持。
- 安全性: product UI read fetch internals のみ変更。DB/schema、auth/authorization、
  PHI projection、billing、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation は不変。SSOT では必要時の product
  API/DB/auth/authorization/PHI/billing/deploy/package dependency 変更許可を確認済みだが、
  この slice では不要。
- 検証: focused institutions Vitest `1 file / 21 tests` green、
  scoped ESLint green、targeted Prettier check green、targeted `git diff --check` green、
  `pnpm typecheck` green。
- commit: `9d3f1755` (`refactor(ui): reuse readApiJson in institutions`)。
- 残課題: R40/R44 は broad。追加の client fetcher は response body read が PHI-safe かを
  個別確認してから段階移行する。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R40/R44 vehicles readApiJson slice

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 実施:
  - admin vehicles の `buildListPath()` / `buildVisitVehicleResourcesApiPath(params)` GET
    fetcher を `readApiJson<VisitVehicleResourcesResponse>` へ移行。
  - admin vehicles の `PHARMACY_SITES_API_PATH` GET fetcher を
    `readApiJson<PharmacySitesResponse>` へ移行。
- 挙動変更: read fetch 実装内部の helper 収束のみ。API path helpers、limit param、
  `buildOrgHeaders`、React Query keys、response envelopes/count metadata、DataTable
  false-empty error state、form validation、POST/PATCH mutation、path helper
  encode/fail-closed semantics は維持。
- 安全性: product UI read fetch internals のみ変更。DB/schema、auth/authorization、
  PHI projection、billing、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation は不変。SSOT では必要時の product
  API/DB/auth/authorization/PHI/billing/deploy/package dependency 変更許可を確認済みだが、
  この slice では不要。
- 検証: focused vehicles Vitest `1 file / 9 tests` green、scoped ESLint green、
  targeted Prettier check green（changed file format 後）、targeted `git diff --check`
  green、`pnpm typecheck` green。
- commit: `8b264fb7` (`refactor(ui): reuse readApiJson in vehicles`)。
- 残課題: R40/R44 は broad。追加の client fetcher は response body read が PHI-safe かを
  個別確認してから段階移行する。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R40/R44 facilities readApiJson slice

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 実施:
  - admin facilities の `buildAdminFacilitiesApiPath(new URLSearchParams())` GET fetcher を
    `readApiJson<FacilitiesResponse>` へ移行。
  - admin facilities の `buildAdminFacilityUnitsApiPath(editingFacility.id)` GET fetcher を
    `readApiJson<FacilityUnitsResponse>` へ移行。
- 挙動変更: read fetch 実装内部の helper 収束のみ。API path helpers、`buildOrgHeaders`、
  React Query keys、response envelopes/count metadata、DataTable false-empty error state、
  named units loading state、facility/contact/unit rendering、POST/PATCH/DELETE mutation、
  path helper encode/fail-closed semantics は維持。
- 安全性: product UI read fetch internals のみ変更。DB/schema、auth/authorization、
  PHI projection、billing、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation は不変。SSOT では必要時の product
  API/DB/auth/authorization/PHI/billing/deploy/package dependency 変更許可を確認済みだが、
  この slice では不要。
- 検証: focused facilities Vitest `1 file / 11 tests` green、scoped ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `51c53180` (`refactor(ui): reuse readApiJson in facilities`)。
- 残課題: R40/R44 は broad。追加の client fetcher は response body read が PHI-safe かを
  個別確認してから段階移行する。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R40/R44 operating hours readApiJson slice

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 実施:
  - admin operating-hours の `/api/pharmacy-sites` GET fetcher を
    `readApiJson<{ data: SiteOption[] }>` へ移行。
  - admin operating-hours の `/api/pharmacy-operating-hours?...` GET fetcher を
    `readApiJson<OperatingHoursResponse>` へ移行。
- 挙動変更: read fetch 実装内部の helper 収束のみ。API paths、date/site params、
  `buildOrgHeaders`、React Query keys、response envelopes、active-site selection、
  weekly draft sync、resolved-day calendar、named loading states、false-zero calendar
  error state、stale-save conflict behavior、PUT save mutation は維持。
- 安全性: product UI read fetch internals のみ変更。DB/schema、auth/authorization、
  PHI projection、billing、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation は不変。SSOT では必要時の product
  API/DB/auth/authorization/PHI/billing/deploy/package dependency 変更許可を確認済みだが、
  この slice では不要。
- 検証: focused operating-hours Vitest `1 file / 11 tests` green、scoped ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `3cec07f8` (`refactor(ui): reuse readApiJson in operating hours`)。
- 残課題: R40/R44 は broad。追加の client fetcher は response body read が PHI-safe かを
  個別確認してから段階移行する。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R40/R44 pharmacy sites readApiJson slice

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 実施:
  - admin pharmacy-sites の `PHARMACY_SITES_API_PATH` GET fetcher を
    `readApiJson<{ data: PharmacySite[] }>` へ移行。
  - admin pharmacy-sites の `buildPharmacySiteInsuranceConfigsApiPath(configSiteId)` GET
    fetcher を `readApiJson<{ data: InsuranceConfig[] }>` へ移行。
- 挙動変更: read fetch 実装内部の helper 収束のみ。API path helpers、
  `buildOrgHeaders`、React Query keys、response envelopes、admin role gate、
  false-empty error states、insurance-config billing semantics、site edit mutation、
  insurance-config create/update/delete mutation、path helper encode/fail-closed semantics
  は維持。
- 安全性: product UI read fetch internals のみ変更。DB/schema、auth/authorization、
  PHI projection、billing、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation は不変。SSOT では必要時の product
  API/DB/auth/authorization/PHI/billing/deploy/package dependency 変更許可を確認済みだが、
  この slice では不要。
- 検証: focused pharmacy-sites Vitest `1 file / 21 tests` green、scoped ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `ec83c0e1` (`refactor(ui): reuse readApiJson in pharmacy sites`)。
- 残課題: R40/R44 は broad。追加の client fetcher は response body read が PHI-safe かを
  個別確認してから段階移行する。

## 2026-07-05 R40/R44 pharmacist credentials readApiJson slice

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 実施:
  - admin pharmacist-credentials の `PHARMACIST_CREDENTIALS_API_PATH` GET fetcher を
    `readApiJson<PharmacistCredentialListResponse>` へ移行。
  - admin pharmacist-credentials の `buildPharmacistsApiPath()` GET fetcher を
    `readApiJson<{ data: PharmacistOption[] }>` へ移行。
- 挙動変更: read fetch 実装内部の helper 収束のみ。API path helpers、
  `buildOrgHeaders`、React Query keys、response envelopes/count metadata、
  credential/staff false-empty error states、staff selector、POST/PATCH/DELETE mutation、
  path helper encode/fail-closed semantics は維持。
- 安全性: product UI read fetch internals のみ変更。DB/schema、auth/authorization、
  PHI projection、staff credential/personnel display semantics、billing、deployment、
  package dependency、live DB operation、external send、secret handling、push、
  destructive operation は不変。SSOT では必要時の product
  API/DB/auth/authorization/PHI/billing/deploy/package dependency 変更許可を確認済みだが、
  この slice では不要。
- 検証: focused pharmacist-credentials Vitest `1 file / 17 tests` green、
  scoped ESLint green、targeted Prettier check green、targeted `git diff --check` green、
  `pnpm typecheck` green。
- commit: `ac1a88d1` (`refactor(ui): reuse readApiJson in pharmacist credentials`)。
- 残課題: R40/R44 は broad。追加の client fetcher は response body read が PHI-safe かを
  個別確認してから段階移行する。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R40/R44 document templates readApiJson slice

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 実施:
  - admin document-templates の `buildDocumentTemplatesApiPath(params)` GET fetcher を
    `readApiJson<DocumentTemplatesResponse>` へ移行。
- 挙動変更: read fetch 実装内部の helper 収束のみ。API path helper、filter params、
  `buildOrgHeaders`、React Query key、response envelope/count metadata、false-empty error state、
  body editor mapping、delivery-rule manager、create/update/delete mutations、
  path helper encode/fail-closed semantics は維持。
- 安全性: product UI read fetch internals のみ変更。DB/schema、auth/authorization、
  PHI projection、billing、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation は不変。SSOT では必要時の product
  API/DB/auth/authorization/PHI/billing/deploy/package dependency 変更許可を確認済みだが、
  この slice では不要。
- 検証: focused document-templates Vitest `1 file / 9 tests` green、
  scoped ESLint green、targeted Prettier check green、targeted `git diff --check` green、
  `pnpm typecheck` green。
- commit: `416e9fd5` (`refactor(ui): reuse readApiJson in document templates`)。
- 残課題: R40/R44 は broad。追加の client fetcher は response body read が PHI-safe かを
  個別確認してから段階移行する。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R40/R44 admin users readApiJson slice

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 実施:
  - admin users の `buildPharmacistsApiPath(...include_collaborators=true)` GET fetcher を
    `readApiJson<UsersListResponse>` へ移行。
  - admin users の `PHARMACY_SITES_API_PATH` GET fetcher を
    `readApiJson<{ data: SiteOption[] }>` へ移行。
  - 関連 test の DataTable mock を Prettier 整形し、targeted Prettier gate を green 化。
- 挙動変更: read fetch 実装内部の helper 収束のみ。API path helpers、
  `buildOrgHeaders`、React Query keys、response envelope/count metadata、user/site table 表示、
  filters、invite/update/status mutations、path helper encode/fail-closed semantics は維持。
- 安全性: product UI read fetch internals のみ変更。DB/schema、auth/authorization、
  PHI/personnel projection、billing、deployment、package dependency、live DB operation、
  external send、secret handling、push、destructive operation は不変。SSOT では必要時の product
  API/DB/auth/authorization/PHI/billing/deploy/package dependency 変更許可を確認済みだが、
  この slice では不要。
- 検証: focused admin users Vitest `1 file / 12 tests` green、scoped ESLint green、
  targeted Prettier check は関連 test の既存 formatting で一度 fail 後、整形して green、
  targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `56b8d130` (`refactor(ui): reuse readApiJson in admin users`)。
- 残課題: R40/R44 は broad。追加の client fetcher は response body read が PHI-safe かを
  個別確認してから段階移行する。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R40/R44 admin shifts readApiJson slice

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 実施:
  - admin shifts の pharmacy-site / pharmacist member / shift / business-holiday /
    shift-template GET fetchers を `readApiJson` へ移行。
  - queryFn contract test を追加し、5つの read endpoints と org-scoped headers を固定。
- 挙動変更: read fetch 実装内部の helper 収束のみ。endpoints/search params、month/date range、
  `limit` values、`buildOrgHeaders`、React Query keys、supporting-master error UI、loading
  skeleton、refetch behavior、mutation behavior は維持。
- 安全性: product UI read fetch internals のみ変更。DB/schema、auth/authorization、
  PHI projection、billing、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation、shift edit/copy/apply mutations、holiday
  mutations、template mutations、pharmacist action mutations は不変。SSOT では必要時の product
  API/DB/auth/authorization/PHI/billing/deploy/package dependency 変更許可を確認済みだが、
  この slice では不要。
- 検証: focused admin shifts Vitest `1 file / 14 tests` green、scoped ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `5cca843d` (`Converge shift reads on shared JSON helper`)。
- 残課題: R40/R44 は broad。追加の client fetcher は response body read が PHI-safe かを
  個別確認してから段階移行する。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R40/R44 admin incidents readApiJson slice

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 実施:
  - admin incidents の incident-report list GET fetcher を `readApiJson` へ移行。
  - 既存 focused test で collection endpoint と org-scoped header contract を継続固定。
- 挙動変更: read fetch 実装内部の helper 収束のみ。collection endpoint、
  `buildOrgHeaders`、React Query key、response envelope unwrap、loading/error UI、
  refetch behavior、memo/status PATCH、create POST は維持。
- 安全性: product UI read fetch internals のみ変更。DB/schema、auth/authorization、
  PHI projection、billing、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation、mutation/server behavior は不変。SSOT では
  必要時の product API/DB/auth/authorization/PHI/billing/deploy/package dependency
  変更許可を確認済みだが、この slice では不要。
- 検証: focused admin incidents Vitest `1 file / 15 tests` green、scoped ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `f8a1e025` (`Converge incident reads on shared JSON helper`)。
- 残課題: R40/R44 は broad。追加の client fetcher は response body read が PHI-safe かを
  個別確認してから段階移行する。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R40/R44 notification settings readApiJson slice

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 実施:
  - notification settings の notification-rule / escalation-rule list GET effects を
    `readApiJson` へ移行。
  - 既存 focused tests で shared path helper と org-scoped header contract を継続固定。
- 挙動変更: read fetch 実装内部の helper 収束のみ。path helpers、`buildOrgHeaders`、
  response envelope/list metadata、loading/error UI、reload keys、active-effect cleanup、
  notification-rule mutations、escalation-rule mutations は維持。
- 安全性: product UI read fetch internals のみ変更。DB/schema、auth/authorization、
  PHI projection、billing、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation、mutation/server behavior は不変。SSOT では
  必要時の product API/DB/auth/authorization/PHI/billing/deploy/package dependency
  変更許可を確認済みだが、この slice では不要。
- 検証: focused notification-settings Vitest `1 file / 12 tests` green、scoped ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `3d6219bf` (`Converge notification setting reads on shared JSON helper`)。
- 残課題: R40/R44 は broad。追加の client fetcher は response body read が PHI-safe かを
  個別確認してから段階移行する。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R40/R44 billing rules readApiJson slice

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 実施:
  - admin billing-rules の collection GET helper を `readApiJson` へ移行。
  - 既存 focused test で collection endpoint と mutation/path contracts を継続固定。
- 挙動変更: read fetch 実装内部の helper 収束のみ。`BILLING_RULES_API_PATH`、
  React Query key、staleTime、response envelope/source/summary、false-empty retryable error UI、
  SSOT sync POST、custom-rule create/update/delete、hostile-id encode/fail-closed detail path は維持。
- 安全性: billing surface は read-only helper のみ変更。DB/schema、auth/authorization、
  PHI projection、billing rule calculation、deployment、package dependency、live DB operation、
  external send、secret handling、push、destructive operation、mutation/server behavior は不変。
  SSOT では必要時の product API/DB/auth/authorization/PHI/billing/deploy/package dependency
  変更許可を確認済みだが、この slice では不要。
- 検証: focused billing-rules Vitest `1 file / 14 tests` green、scoped ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `31b5ff99` (`Converge billing rule reads on shared JSON helper`)。
- 残課題: R40/R44 は broad。追加の client fetcher は response body read が PHI-safe かを
  個別確認してから段階移行する。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R40/R44 admin UAT readApiJson slice

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 実施:
  - admin UAT の org-scoped local JSON fetch helper を `readApiJson` へ移行。
  - queryFn contract test を追加し、6つの read endpoints と org-scoped headers を固定。
- 挙動変更: fetch 実装内部の helper 収束のみ。UAT feedback/readiness/summary/
  collaborators/org-audit/launch-dossier endpoints、`buildOrgHeaders`、query keys、
  loading/error UI、POST/PATCH payloads、invalidation keys は維持。
- 安全性: product UI fetch internals のみ変更。DB/schema、auth/authorization、
  PHI projection、billing、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation、mutation/server behavior は不変。SSOT では
  必要時の product API/DB/auth/authorization/PHI/billing/deploy/package dependency
  変更許可を確認済みだが、この slice では不要。
- 検証: focused UAT Vitest `1 file / 4 tests` green、scoped ESLint green、targeted
  Prettier check は touched test formatting 後 green、targeted `git diff --check` green、
  `pnpm typecheck` green。
- commit: `b3d64bc4` (`Converge UAT JSON fetches on shared helper`)。
- 残課題: R40/R44 は broad。追加の client fetcher は response body read が PHI-safe かを
  個別確認してから段階移行する。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R40/R44 external professionals readApiJson slice

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 実施:
  - external professional list / facility options / linked patients GET fetchers を
    `readApiJson` へ移行。
  - 既存 focused tests で real fetch responses、org headers、linked-patient metadata、
    patient navigation helper、query failure false-empty prevention を継続検証。
- 挙動変更: read fetch 実装内部の helper 収束のみ。admin external professional path helpers、
  facility path helper、linked-patient path helper、`buildOrgHeaders`、React Query keys、
  linked-patient limit、response envelopes、false-empty/error UI、mutation behavior は維持。
- 安全性: product UI read fetch internals のみ変更。DB/schema、auth/authorization、
  PHI projection、billing、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation、path helper encode/fail-closed semantics、
  server/mutation behavior は不変。SSOT では必要時の product
  API/DB/auth/authorization/PHI/billing/deploy/package dependency 変更許可を確認済みだが、
  この slice では不要。
- 検証: focused external-professionals Vitest `1 file / 13 tests` green、scoped ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `512e2c34` (`Converge external professional reads on shared JSON helper`)。
- 残課題: R40/R44 は broad。追加の client fetcher は response body read が PHI-safe かを
  個別確認してから段階移行する。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R40/R44 PCA pumps readApiJson slice

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 実施:
  - PCA pump inventory / open rentals / return-inspection pending rentals /
    prescriber institutions GET fetchers を `readApiJson` へ移行。
  - 既存 queryFn contract test で4つの read fetcher の shared path helper と org-scoped headers を
    継続固定。
- 挙動変更: read fetch 実装内部の helper 収束のみ。shared PCA path helpers、prescriber
  institutions static path、`buildOrgHeaders`、React Query keys、debounce behavior、
  response envelopes、false-empty/error UI、mutation behavior は維持。
- 安全性: product UI read fetch internals のみ変更。DB/schema、auth/authorization、
  PHI projection、billing、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation、path helper encode/fail-closed semantics、
  server/mutation behavior は不変。SSOT では必要時の product
  API/DB/auth/authorization/PHI/billing/deploy/package dependency 変更許可を確認済みだが、
  この slice では不要。
- 検証: focused PCA pumps Vitest `1 file / 21 tests` green、scoped ESLint green、
  targeted Prettier check は touched implementation formatting 後 green、targeted
  `git diff --check` green、`pnpm typecheck` green。
- commit: `87712a79` (`Converge PCA pump reads on shared JSON helper`)。
- 残課題: R40/R44 は broad。追加の client fetcher は response body read が PHI-safe かを
  個別確認してから段階移行する。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R40/R44 admin performance readApiJson slice

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 実施:
  - admin performance の workflow/schedules/proposals/runtime metrics GET fetchers を
    `readApiJson` へ移行。
  - queryFn contract test を追加し、4つの read endpoints と org-scoped headers を固定。
- 挙動変更: read fetch 実装内部の helper 収束のみ。endpoint paths/search params、
  `buildOrgHeaders`、React Query keys、realtime invalidation events、fallback refetch intervals、
  runtime polling、response envelopes、false-zero ErrorState、update button refetch behavior は維持。
- 安全性: product UI read fetch internals のみ変更。DB/schema、auth/authorization、
  PHI projection、billing、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation、server/mutation behavior は不変。SSOT では必要時の
  product API/DB/auth/authorization/PHI/billing/deploy/package dependency 変更許可を確認済みだが、
  この slice では不要。
- 検証: focused admin performance Vitest `1 file / 6 tests` green、scoped ESLint green、
  targeted Prettier check は touched test formatting 後 green、targeted `git diff --check`
  green、`pnpm typecheck` green。
- commit: `7168e8a9` (`Converge admin performance reads on shared JSON helper`)。
- 残課題: R40/R44 は broad。追加の client fetcher は response body read が PHI-safe かを
  個別確認してから段階移行する。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R40/R44 admin settings readApiJson slice

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 実施:
  - admin settings の `/api/settings?scope=...` GET fetcher を
    `readApiJson<SettingResponse>` へ移行。
  - admin settings の `/api/me/profile` と `/api/pharmacy-sites` GET fetchers を
    `readApiJson` へ移行。
  - queryFn contract test を追加し、settings/profile/site endpoints と org-scoped
    settings/site headers を固定。
- 挙動変更: read fetch 実装内部の helper 収束のみ。endpoint paths/search params、
  `buildOrgHeaders`、React Query keys、response envelopes、selected-site fallback、
  retryable site-list error UI、settings range validation、save mutation、health monitor
  503-as-payload semantics、polling cadence は維持。
- 安全性: product UI read fetch internals のみ変更。DB/schema、auth/authorization、
  PHI projection、billing、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation は不変。SSOT では必要時の product
  API/DB/auth/authorization/PHI/billing/deploy/package dependency 変更許可を確認済みだが、
  この slice では不要。
- 検証: focused admin settings Vitest `1 file / 10 tests` green、scoped ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `4ffa10db` (`Converge admin settings reads on shared JSON helper`)。
- 残課題: R40/R44 は broad。追加の client fetcher は response body read が PHI-safe かを
  個別確認してから段階移行する。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R40/R44 admin realtime readApiJson slice

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 実施:
  - admin realtime の `/api/dashboard/workflow?view=realtime` GET fetcher を
    `readApiJson<{ data: WorkflowSnapshot }>` へ移行。
  - admin realtime の `/api/notifications?limit=12&is_read=false` GET fetcher を
    `readApiJson<{ data: Notification[] }>` へ移行。
  - queryFn contract test を追加し、org-scoped endpoint/header と response envelope を固定。
- 挙動変更: read fetch 実装内部の helper 収束のみ。endpoint paths、
  `buildOrgHeaders`、React Query keys、realtime invalidation、SSE notification merge、
  response envelopes、false-empty ErrorState は維持。
- 安全性: product UI read fetch internals のみ変更。DB/schema、auth/authorization、
  PHI/personnel projection、billing、deployment、package dependency、live DB operation、
  external send、secret handling、push、destructive operation は不変。SSOT では必要時の product
  API/DB/auth/authorization/PHI/billing/deploy/package dependency 変更許可を確認済みだが、
  この slice では不要。
- 検証: focused admin realtime Vitest `1 file / 13 tests` green、scoped ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `628df9dc` (`refactor(ui): reuse readApiJson in admin realtime`)。
- 残課題: R40/R44 は broad。追加の client fetcher は response body read が PHI-safe かを
  個別確認してから段階移行する。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R40/R44 data explorer readApiJson slice

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 実施:
  - admin data-explorer の `/api/admin/data-explorer/models` GET fetcher を
    `readApiJson<{ data: ExplorerModel[] }>` へ移行。
  - admin data-explorer の table rows GET fetcher を
    `readApiJson<{ data: ExplorerRowsPayload }>` へ移行。
  - queryFn contract test を追加し、org-scoped endpoint/header と response envelope を固定。
- 挙動変更: read fetch 実装内部の helper 収束のみ。endpoint paths/search params、
  org-scoped headers、session-scoped empty-org fallback、React Query keys、response envelopes、
  false-empty ErrorState、PHI-free row selection accessible names、editor permission behavior、
  update mutation は維持。
- 安全性: product UI read fetch internals のみ変更。DB/schema、auth/authorization、
  PHI projection、billing、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation は不変。SSOT では必要時の product
  API/DB/auth/authorization/PHI/billing/deploy/package dependency 変更許可を確認済みだが、
  この slice では不要。
- 検証: focused admin data-explorer Vitest `1 file / 10 tests` green、scoped ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `e3d7cd4b` (`refactor(ui): reuse readApiJson in data explorer`)。
- 残課題: R40/R44 は broad。追加の client fetcher は response body read が PHI-safe かを
  個別確認してから段階移行する。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R40/R44 alert rules readApiJson slice

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 実施:
  - admin alert-rules page の `DRUG_ALERT_RULES_API_PATH` GET fetcher を
    `readApiJson<DrugAlertRulesResponse>` へ移行。
  - admin alert-rules signal tuning panel の `DRUG_ALERT_RULES_API_PATH` GET fetcher を
    `readApiJson<DrugAlertRulesResponse>` へ移行。
- 挙動変更: read fetch 実装内部の helper 収束のみ。static collection path、
  `buildOrgHeaders`、React Query keys、staleTime、response envelope/count metadata、
  signal tuning `data ?? []` mapping、false-empty ErrorState、patient-safety false-default
  prevention、create/update/delete mutations、path helper encode/fail-closed semantics は維持。
- 安全性: product UI read fetch internals のみ変更。DB/schema、auth/authorization、
  PHI projection、billing、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation は不変。SSOT では必要時の product
  API/DB/auth/authorization/PHI/billing/deploy/package dependency 変更許可を確認済みだが、
  この slice では不要。
- 検証: focused alert-rules Vitest `2 files / 24 tests` green、scoped ESLint green、
  targeted Prettier check は touched page formatting 後 green、targeted `git diff --check`
  green、`pnpm typecheck` green。
- commit: `0d9788d6` (`refactor(ui): reuse readApiJson in alert rules`)。
- 残課題: R40/R44 は broad。追加の client fetcher は response body read が PHI-safe かを
  個別確認してから段階移行する。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R40/R44 document delivery rules readApiJson slice

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 実施:
  - admin document-delivery-rule manager の `buildDocumentDeliveryRulesApiPath()` GET fetcher を
    `readApiJson<DocumentDeliveryRulesResponse>` へ移行。
- 挙動変更: read fetch 実装内部の helper 収束のみ。API path helper、
  `buildOrgHeaders`、React Query key、response envelope/count metadata、false-empty ErrorState、
  create/update/delete mutations、path helper encode/fail-closed semantics は維持。
- 安全性: product UI read fetch internals のみ変更。DB/schema、auth/authorization、
  PHI projection、billing、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation は不変。SSOT では必要時の product
  API/DB/auth/authorization/PHI/billing/deploy/package dependency 変更許可を確認済みだが、
  この slice では不要。
- 検証: focused document-delivery-rule-manager Vitest `1 file / 11 tests` green、
  scoped ESLint green、targeted Prettier check green、targeted `git diff --check` green、
  `pnpm typecheck` green。
- commit: `9570edef` (`refactor(ui): reuse readApiJson in delivery rules`)。
- 残課題: R40/R44 は broad。追加の client fetcher は response body read が PHI-safe かを
  個別確認してから段階移行する。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R40/R44 patient packaging readApiJson slice

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 実施:
  - patient packaging settings の `buildPatientApiPath(patientId, '/packaging')` GET fetcher を
    `readApiJson<PackagingResponse>` へ移行。
  - failed GET の API JSON `message` が queryFn から表面化する契約テストを追加。
- 挙動変更: read fetch 実装内部の helper 収束のみ。patient path helper、
  `buildOrgHeaders`、React Query key、enabled gate、hostile-id encoding、dot-segment fail-closed、
  response envelope、ErrorState の編集停止、save mutation、invalidation contract は維持。
- 安全性: product UI read fetch internals のみ変更。DB/schema、auth/authorization、
  PHI projection、billing、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation は不変。SSOT では必要時の product
  API/DB/auth/authorization/PHI/billing/deploy/package dependency 変更許可を確認済みだが、
  この slice では不要。
- 検証: focused patient packaging Vitest `1 file / 8 tests` green、scoped ESLint green、
  targeted Prettier check は touched test formatting 後 green、targeted `git diff --check`
  green、`pnpm typecheck` green。
- commit: `8f2217cd` (`refactor(ui): reuse readApiJson in patient packaging`)。
- 残課題: R40/R44 は broad。追加の client fetcher は response body read が PHI-safe かを
  個別確認してから段階移行する。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R40/R44 visit constraints readApiJson slice

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 実施:
  - visit constraints の `buildPatientApiPath(patientId, '/visit-constraints')` GET fetcher を
    `readApiJson<VisitConstraintsResponse>` へ移行。
  - focused fetch mock を標準 `Response` へ更新し、failed GET の API JSON `message` が
    queryFn から表面化する契約テストを追加。
- 挙動変更: read fetch 実装内部の helper 収束のみ。patient path helper、
  `buildOrgHeaders`、React Query key、enabled gate、hostile-id encoding、dot-segment fail-closed、
  response envelope、ErrorState の編集停止、save mutation、raw patient-id invalidation は維持。
- 安全性: product UI read fetch internals のみ変更。DB/schema、auth/authorization、
  PHI projection、billing、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation は不変。SSOT では必要時の product
  API/DB/auth/authorization/PHI/billing/deploy/package dependency 変更許可を確認済みだが、
  この slice では不要。
- 検証: focused visit constraints Vitest `1 file / 9 tests` green、scoped ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `9b4aef59` (`refactor(ui): reuse readApiJson in visit constraints`)。
- 残課題: R40/R44 は broad。追加の client fetcher は response body read が PHI-safe かを
  個別確認してから段階移行する。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R40/R44 patient labs readApiJson slice

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 実施:
  - patient labs の `buildPatientApiPath(patientId, '/labs')?limit=30` GET fetcher を
    `readApiJson<LabsResponse>` へ移行。
  - failed GET の API JSON `message` が queryFn から表面化する契約テストを追加。
- 挙動変更: read fetch 実装内部の helper 収束のみ。patient path helper、`?limit=30`,
  `buildOrgHeaders`、React Query key、enabled gate、hostile-id encoding、dot-segment fail-closed、
  response envelope、POST/PATCH mutations、raw patient-id invalidation、visit-record source link は維持。
- 安全性: product UI read fetch internals のみ変更。DB/schema、auth/authorization、
  PHI projection、billing、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation は不変。SSOT では必要時の product
  API/DB/auth/authorization/PHI/billing/deploy/package dependency 変更許可を確認済みだが、
  この slice では不要。
- 検証: focused patient labs Vitest `1 file / 13 tests` green、scoped ESLint green、
  targeted Prettier check は touched test formatting 後 green、targeted `git diff --check`
  green、`pnpm typecheck` green。
- commit: `cad9ae1e` (`refactor(ui): reuse readApiJson in patient labs`)。
- 残課題: R40/R44 は broad。追加の client fetcher は response body read が PHI-safe かを
  個別確認してから段階移行する。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R40/R44 care team panel readApiJson slice

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 実施:
  - care team panel の `/api/admin/external-professionals` GET fetcher を
    `readApiJson<ExternalProfessionalOptionsResponse>` へ移行。
  - failed GET の API JSON `message` が queryFn から表面化する契約テストを追加。
- 挙動変更: read fetch 実装内部の helper 収束のみ。static endpoint、`buildOrgHeaders`、
  React Query key、enabled gate、response envelope/count metadata、truncated-option warning、
  retryable error UI、quick-create mutation、care-team save mutation、raw patient-id invalidation は維持。
- 安全性: product UI read fetch internals のみ変更。DB/schema、auth/authorization、
  PHI projection、billing、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation は不変。SSOT では必要時の product
  API/DB/auth/authorization/PHI/billing/deploy/package dependency 変更許可を確認済みだが、
  この slice では不要。
- 検証: focused care team panel Vitest `1 file / 11 tests` green、scoped ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `8149d2cd` (`refactor(ui): reuse readApiJson in care team panel`)。
- 残課題: R40/R44 は broad。追加の client fetcher は response body read が PHI-safe かを
  個別確認してから段階移行する。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。

## 2026-07-05 R40/R44 patient insurance readApiJson slice

- 分類: query-helper / client fetch error handling → `readApiJson` 収束。
- 実施:
  - patient insurance の `buildPatientApiPath(patientId, '/insurance')` GET fetcher を
    `readApiJson<InsuranceResponse>` へ移行。
  - focused fetch mock を標準 `Response` へ更新し、failed GET の API JSON `message` が
    queryFn から表面化する契約テストを追加。
- 挙動変更: read fetch 実装内部の helper 収束のみ。patient path helper、`buildOrgHeaders`、
  React Query key、enabled gate、hostile patient/insurance id encoding、dot-segment fail-closed、
  response envelope、save/delete mutations、stale-delete `expected_updated_at`、raw patient-id
  invalidation は維持。
- 安全性: product UI read fetch internals のみ変更。DB/schema、auth/authorization、
  PHI projection、billing、deployment、package dependency、live DB operation、external send、
  secret handling、push、destructive operation は不変。SSOT では必要時の product
  API/DB/auth/authorization/PHI/billing/deploy/package dependency 変更許可を確認済みだが、
  この slice では不要。
- 検証: focused patient insurance Vitest `1 file / 12 tests` green、scoped ESLint green、
  targeted Prettier check green、targeted `git diff --check` green、`pnpm typecheck` green。
- commit: `872a9aac` (`refactor(ui): reuse readApiJson in patient insurance`)。
- 残課題: R40/R44 は broad。追加の client fetcher は response body read が PHI-safe かを
  個別確認してから段階移行する。
  未所有 `refactor-instructions.md` と `.agents/skills/**` / `skills-lock.json` は保持。
