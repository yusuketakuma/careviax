# STATE — 現在地（スリム版・~100行上限）

> 2026-07-03 台帳再編。アクティブ台帳は **STATE.md / BACKLOG.md / LOG.md**（+参照用 CODE_MAP.md）の
> 3+1 のみ。旧台帳・巨大ログは `archive/` に凍結（新規追記禁止）。
> 再開手順: このファイル → LOG.md 末尾 → BACKLOG.md → `git status` / `git log --oneline -15`。

## 体制（2026-07-04 ユーザー指示）

- 現行は Codex 単独運用。codex が Plans 棚卸し、実装、validation、台帳更新、scoped commit、
  例外処理を一貫して担当する。
- agmsg / codex2 / codex3 / codex4 / Claude / subagent / PATCH_REPORT 待ちは使わない。
  ユーザーが明示的に再有効化しない限り、過去の multi-agent 記述は歴史的記録として扱う。
- 規律: `git status --short --untracked-files=all` → 対象 diff 確認 → 小スライス実装 →
  focused validation → 台帳更新 → explicit path staging → scoped commit。
- gate: lint / typecheck / typecheck:no-unused / format:check / test / build / colors:check
  （build と typecheck は並列禁止。長い Next.js gate は同時実行しない）
- 2026-07-04 ユーザー明示: active objective 達成に必要なら product API / DB / auth /
  authorization / PHI / billing / deploy / package dependency も変更対象に含めてよい。
  ただし安全ゲートは緩和しない。migration 適用、deploy、secret rotation、production data mutation、
  destructive operation、push は current-task の明示許可が必要。

## Codex 単独運用の自律待機方針（2026-07-04 ユーザー指示）

- review待ち、land待ち、狭い blocker、担当slice hold中でも、完全停止しない。
- まず dirty tree を確認し、既存 user/peer dirty・危険領域を避ける。
- 編集できない場合も Codex 本体で read-only recon、衝突表、候補scoring、focused validation、次に安全な作業の棚卸しを続ける。
- 編集可能な候補が見つかった場合は、小さく reviewable な差分だけ実装する。
- 人間承認、billing/算定/PHI隣接/authorization、migration/deploy/destructive gate は迂回しない。

## Phase

- Goal Mode Phase A（監査スキャン）: **完了**（2026-07-03、commit 78022195）
- Phase B（REFACTOR_PLAN v2 = BACKLOG のスコア順実装計画）: 実行中
- Phase C（実装ループ）: Codex 単独運用体制（2026-07-04〜）。
  現在の供給源は `Plans.md` 未完了40件（open 37 + partial 3）。即時実装は W3-E1/E2 の低リスクUI、
  read-only recon は W3-B9/B3/B4/B6/ID 残、外部/human gate は staging/AWS/PMDA/backup/ISMS/UAT/legal。

## 直近の land（本日・要点）

- coordinator mode refresh(0164b797) / agmsg turn hook(025ee516) / W3-E1 shifts RHF(c5ec2727)
  / W3-E2 DataTable selectable-listbox contract(757ca20c) / prescriptions-table DataTable migration(2d0d80b4)
  / W3-E1 facilities RHF(a18abc1c) — coordinator review + focused validation green。DataTable contract は
  typecheck / typecheck:no-unused / build まで中央gate green。
- Wave 2 完了 / W3-C2/E2/E3 / W3-B4 中核(52ce1f66) / B6 設計ラティファイ(3a39f69e) / v0.2 実証
- codex lane: BE-1 / RT1 / RR-QP-A/B / JOB1/2 / CW1 / BM1(5be6ebca) / 9d1567ba /
  PERF-01(981f1a58) / MFA1(f7bf2e97) / F84(c22c7fe3) / CE17(5205fc48) / R07(f3733036) /
  DR-DUP1(2e0c7fdb) / PERF-02(60469cd1) / CE20(66d65f99) / ID-1b(0a3b910c, e2a8b414)
  / ID-2-W1(898c0d6a) / ID-2-W2(90a1276e) / ID-2-W3(8c7e34e7) / ID-2-W4(7e18fcb2)
  / FIX-CATALOG-IDSEQ(a42065fa) / R21-SONNER1(68688360) / ID-2-W5(86d9d273) / ID-2-W6(d2bcde00)
  / R21 comment-thread sonner(7bb192e9) — 全 opus/committer APPROVE
- codex2 lane: R16-MIN(da5889f0) / R16-SWEEP(6f26c04c) / FE-FALSEEMPTY(27496917) /
  R55 admin-jobs route loading label(66ae881e) / R55 admin master loading labels(f0029164) —
  coordinator validation green。R55 schedule operational task loading(a54484d3) — focused validation green
- codex3 lane: R22-EXEC(759b4dbc) / R22b websocket infra deletion(96ead96b) /
  R22 docs refresh(91bca6fb) / R08-EXEC(cee20c66) /
  R55 drug-master import-history skeleton(fd065171) / R21 report delivery sonner mock(932d3d22) —
  coordinator validation green
- codex4 lane: W3-B9 evidence-side missing emergency category blocker(cbef13f4) /
  W3-B9 rule-engine missing emergency category fail-closed(d535b4f6) — focused validation green
- legacy Claude/Opus lane（削除前の履歴）: X01(e02cec50) / CE19(2136c93a) / N18(ad0ff309) /
  R03(3b31cec1) / A1-CRC(eebda8c3) land
- 全量 gate green: test 13035 passed（2026-07-03 夜、F84/CE19/N18/R03後）
- codex: R55 schedule proposals loading/error states(8fee04d8) land。focused Vitest 48、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck`、`pnpm build`、memory-expanded
  `pnpm typecheck:no-unused` green。
- codex: R40/R44 prescriptions-workspace readApiJson slice(7a079828) land。focused Vitest 10、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。prescription intake list read GET を
  readApiJson へ収束し、limit/include_total/cursor/status/source params / realtime invalidation /
  load-more / detail panel contract は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 prescription-detail readApiJson slice(d22ec557) land。focused Vitest 8、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。prescription intake detail read GET を
  readApiJson へ収束し、intake path helper / hostile-id encoding / retry-back error UI /
  display-id / patient link contract は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 drug-masters readApiJson slice(fe9edc77) land。focused Vitest 88、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。pharmacy sites / drug master cursor page /
  import status / import logs read GET を readApiJson へ収束し、site scoping / cursor params /
  detail-formulary query / mutation contract は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 conferences readApiJson slice(5da0de69) land。focused Vitest 18、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。conference note detail /
  external professionals / prescriber institution suggestion read GET を readApiJson へ収束し、
  detail path helper / hostile note-id encoding / list-calendar pagination / mutation contract は保持。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
- codex: R40/R44 print-hub readApiJson slice(8acdefdb) land。focused Vitest 28、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。set-plans/prescriptions/care-reports/
  patient-documents read GET を readApiJson へ収束し、print audit/mutation contract は保持。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
- codex: R40/R44 route-compare readApiJson slice(7f4c222b) land。focused Vitest 5、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。day-board read GET を readApiJson へ
  収束し、visit schedule window fetcher / route calculation POST / adoption mutation contract は保持。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
- codex: R40/R44 master-hub readApiJson slice(67f3b081) land。focused Vitest 11、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 capacity dashboard readApiJson slice(dd8fe888) land。focused Vitest 12、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 jobs dashboard readApiJson slice(42048531) land。focused Vitest 8、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 inventory forecast readApiJson slice(ae862108) land。focused Vitest 6、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 dispense-audit stats readApiJson slice(a2d0e1bc) land。focused Vitest 5、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 facility-standards readApiJson slice(e0324a79) land。focused Vitest 4、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 admin analytics readApiJson slice(43f2afdf) land。focused Vitest 9、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 contact-profiles readApiJson slice(dbe9853d) land。focused Vitest 7、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 service-areas readApiJson slice(87f34d8a) land。focused Vitest 15、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 business-holidays readApiJson slice(b557f856) land。focused Vitest 14、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 institutions readApiJson slice(9d3f1755) land。focused Vitest 21、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 vehicles readApiJson slice(8b264fb7) land。focused Vitest 9、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 facilities readApiJson slice(51c53180) land。focused Vitest 11、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 operating-hours readApiJson slice(3cec07f8) land。focused Vitest 11、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 pharmacy-sites readApiJson slice(ec83c0e1) land。focused Vitest 21、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 pharmacist-credentials readApiJson slice(ac1a88d1) land。focused Vitest 17、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 document-templates readApiJson slice(416e9fd5) land。focused Vitest 9、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 admin-users readApiJson slice(56b8d130) land。focused Vitest 12、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。関連 test の既存 formatting は
  Prettier write で解消。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 admin-realtime readApiJson slice(628df9dc) land。focused Vitest 13、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。queryFn contract test で
  org-scoped workflow/notification endpoints を固定。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 data-explorer readApiJson slice(e3d7cd4b) land。focused Vitest 10、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。queryFn contract test で
  org-scoped model/row endpoints と PHI-free row action contract を維持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 alert-rules readApiJson slice(0d9788d6) land。focused Vitest 24、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。false-empty / patient-safety
  false-default prevention と org-header/path helper contract を維持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 document-delivery-rules readApiJson slice(9570edef) land。focused Vitest 11、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。shared collection path/org header、
  hostile-id encoding、false-empty contract を維持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 admin-settings readApiJson slice(4ffa10db) land。focused Vitest 10、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。settings/profile/site read GET を
  readApiJson へ収束し、`/api/health` 503-as-payload semantics は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 admin-performance readApiJson slice(7168e8a9) land。focused Vitest 6、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。workflow/schedules/proposals/runtime
  metrics read GET を readApiJson へ収束し、realtime invalidation/polling/false-zero ErrorState は保持。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
- codex: R40/R44 PCA-pumps readApiJson slice(87712a79) land。focused Vitest 21、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。inventory/rentals/return-inspection/
  institutions read GET を readApiJson へ収束し、shared path helper/org-header/debounce/mutation contract は
  保持。SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
- codex: R40/R44 external-professionals readApiJson slice(512e2c34) land。focused Vitest 13、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。list/facility/linked-patient read GET を
  readApiJson へ収束し、path helper/org-header/linked-patient metadata/false-empty/mutation contract は保持。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
- codex: R40/R44 admin-shifts readApiJson slice(5cca843d) land。focused Vitest 14、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。site/member/shift/holiday/template read GET を
  readApiJson へ収束し、queryKey/month/date/limit/supporting-master error/mutation contract は保持。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
- codex: R40/R44 admin-incidents readApiJson slice(f8a1e025) land。focused Vitest 15、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。incident-report list read GET を
  readApiJson へ収束し、collection path/org-header/response envelope/error UI/mutation contract は保持。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
- codex: R40/R44 notification-settings readApiJson slice(3d6219bf) land。focused Vitest 12、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。notification-rule/escalation-rule list
  read GET effects を readApiJson へ収束し、path helper/org-header/list metadata/error UI/mutation
  contract は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 billing-rules readApiJson slice(31b5ff99) land。focused Vitest 14、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。billing-rules collection read GET を
  readApiJson へ収束し、BILLING_RULES_API_PATH/queryKey/source-summary/false-empty retry UI/
  SSOT sync/custom mutation/detail-path contract は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 admin-UAT readApiJson slice(b3d64bc4) land。focused Vitest 4、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。UAT org-scoped JSON fetch helper を
  readApiJson へ収束し、feedback/readiness/summary/collaborator/audit/dossier read endpoints と
  POST/PATCH payload/invalidation contract は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 external-viewer readApiJson slice(798e1e08) land。focused Vitest 9、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。external access / patient self-reports /
  community activities の org-scoped read GET を readApiJson へ収束し、queryKey/endpoint/header、
  retry/error UI、self-report/task mutation contract は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 my-day readApiJson slice(bc78bc28) land。focused Vitest 20、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。assigned visit schedules / admin
  status-change audit-log read GET を readApiJson へ収束し、queryKey/enabled gates/JST day
  boundary/task pagination/cockpit fetch/status-change visibility は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 visits-today readApiJson slice(6e911f36) land。focused Vitest 6、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。today-preparation board read GET を
  readApiJson へ収束し、buildOrgHeaders/queryKey/realtime invalidation/response unwrap/board UI は保持。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
- codex: R40/R44 prescription-inline-detail readApiJson slice(683a8c59) land。focused Vitest 10、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。prescription intake detail read GET を
  readApiJson へ収束し、path helper/org header/queryKey/hostile-id encoding/display_id/table rendering は保持。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
- codex: R40/R44 patient-packaging readApiJson slice(8f2217cd) land。focused Vitest 8、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。patient packaging settings read GET を
  readApiJson へ収束し、patient path helper/org header/queryKey/enabled gate/hostile-id encoding/
  dot-segment fail-closed/error edit-stop/save mutation は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 visit-constraints readApiJson slice(9b4aef59) land。focused Vitest 9、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。visit constraints read GET を
  readApiJson へ収束し、patient path helper/org header/queryKey/enabled gate/hostile-id encoding/
  dot-segment fail-closed/error edit-stop/save mutation/raw patient-id invalidation は保持。SSOT の
  必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
- codex: R40/R44 patient-labs readApiJson slice(cad9ae1e) land。focused Vitest 13、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。patient labs read GET を
  readApiJson へ収束し、patient path helper/limit query/org header/queryKey/enabled gate/
  hostile-id encoding/dot-segment fail-closed/POST-PATCH mutations/raw patient-id invalidation は保持。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
- codex: R40/R44 care-team-panel readApiJson slice(8149d2cd) land。focused Vitest 11、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。external-professional options read GET を
  readApiJson へ収束し、static endpoint/org header/queryKey/enabled gate/count metadata/truncated
  warning/retry UI/quick-create/save mutations/raw patient-id invalidation は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 patient-insurance readApiJson slice(872a9aac) land。focused Vitest 12、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。patient insurance read GET を
  readApiJson へ収束し、patient path helper/org header/queryKey/enabled gate/hostile-id encoding/
  dot-segment fail-closed/save-delete mutations/stale-delete query/raw patient-id invalidation は保持。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
- codex: R40/R44 collaboration-overview readApiJson slice(aa2c3955) land。focused Vitest 10、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。patient collaboration overview read GET を
  readApiJson へ収束し、patient path helper/org header/queryKey/enabled gate/hostile-id encoding/
  dot-segment fail-closed/workflow back link/presence heartbeat-users/comment thread entity id/
  refresh invalidation は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 interprofessional-share readApiJson slice(058e183c) land。focused Vitest 28、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。care report detail / patient care team /
  patient contacts / communication request list+detail の read GET を readApiJson へ収束し、path
  helpers/org header/queryKey/enabled gates/hostile-id encoding/dot rejection/view-only gate/
  reply list-detail separation/POST mutation error handling は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 report-detail readApiJson slice(6402269d) land。focused Vitest 38、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。care report detail / external
  professional suggestions の read GET を readApiJson へ収束し、path helpers/org header/queryKey/
  enabled gates/hostile report-id encoding/send-permission gate/mutation error handling/
  idempotency headers/send safety は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 patient-history-summary readApiJson slice(5010c64d) land。focused Vitest 5、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。previous prescription / previous visit
  summary の read GET を readApiJson へ収束し、patient API helper/limit query/visit-records query/
  org header/queryKey/enabled gate/hostile-id encoding/href helper/current-item exclusion は保持。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
- codex: R40/R44 patient-field-revisions readApiJson slice(e110d2ec) land。focused Vitest 6、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。patient field revision timeline read GET を
  readApiJson へ収束し、patient API helper/category query/org header/queryKey/enabled gate/
  hostile-id encoding/dot rejection/truncated metadata は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 structured-care-panel readApiJson slice(5b5c7e8f) land。focused Vitest 5、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。patient structured care panel read GET を
  readApiJson へ収束し、patient API helper/org header/queryKey/enabled gate/retryable error UI/
  empty-card suppression/UTC date-only display は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 patient-share readApiJson slice(d351c199) land。focused Vitest 12、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。patient share overview / care team /
  contacts / communication request list+detail の read GET を readApiJson へ収束し、path helpers/
  org header/queryKey/enabled gates/no-store overview/hostile-id encoding/mutation contracts/
  queue href は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 patient-visit-brief readApiJson slice(868eb6e2) land。focused Vitest 4、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。patient visit brief read GET を
  readApiJson へ収束し、patient API helper/org header/queryKey/enabled gate/retryable error UI/
  loading skeleton/compact card rendering は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 visit-brief-review readApiJson slice(8f91ad17) land。focused Vitest 2、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。visit brief review の patient
  visit-brief read GET を readApiJson へ収束し、patient resolution fallback GETs/patient API
  helper/org header/queryKeys/enabled gates/retry UI/feedback mutation は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 evidence-gallery readApiJson slice(4905eff3) land。focused Vitest 6、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。evidence gallery の visit-record
  list read GET を readApiJson へ収束し、visit-records query path/org header/queryKey/enabled
  gate/offline draft merge/retry/sync/attachment cap は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 visit-reflected-fields readApiJson slice(198e6183) land。focused Vitest 5、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。visit reflected fields card の read
  GET を readApiJson へ収束し、reflected-fields path/org header/queryKey/enabled gate/
  retryable error card/empty-card suppression/sensitive field presentation は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 facility-packet readApiJson slice(4e57f877) land。focused Vitest 2、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。facility packet の visit-preparation
  read GET を readApiJson へ収束し、visit-preparations path/org header/queryKey/enabled gate/
  retry UI/no-facility fallback/save mutation は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 safety-check readApiJson slice(6231bed5) land。focused Vitest 25、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。medication issues / patient safety
  summary read GET を readApiJson へ収束し、raw patient_id query/patient API helper/org header/
  queryKeys/enabled gates/CDS degraded fail-closed/CDS 4xx-as-empty/mutations は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 visit-record-detail readApiJson slice(500507ef) land。focused Vitest 18、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。visit record detail / patient header /
  care reports / billing candidates / residual medications / visit-preparation read GET を readApiJson へ収束し、
  path/query/header/queryKey/enabled gates/fail-closed banners/no-false-empty/no-false-complete/mutations は保持。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
- codex: R40/R44 visit-record-form readApiJson slice(88125ca9) land。focused Vitest 22、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。schedule detail / patient header summary /
  visit-preparation read GET を readApiJson へ収束し、schedule/header-summary/visit-preparation path、
  org header、queryKey、enabled gate、blocking error、fail-closed safety banner、retryable warning、
  CDS POST、save/upload/reflection mutations は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 patient-compare readApiJson slice(1bbbca61) land。focused Vitest 3、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。patient compare の overview read GET を
  readApiJson へ収束し、patient API path helper、org header、queryKey、enabled gate、
  compare card error UI、compare-card open link helper は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 patient-readiness-cards readApiJson slice(3e1ba2b9) land。focused Vitest 16、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。patient readiness / workflow preview の
  read GET を readApiJson へ収束し、patient path helpers、org header、queryKey、enabled gate、
  dot-segment fail-closed、patient links、loading/error UI は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 patient-edit readApiJson slice(d62db6f6) land。focused Vitest 9、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。patient edit の overview read GET を
  readApiJson へ収束し、patient API path helper、org header、queryKey、enabled gate、
  reconnect/window focus settings、dot-segment fail-closed、edit redirect helper、loading/error UI は保持。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
- codex: R40/R44 residual-adjustment readApiJson slice(8fa2bbcc) land。focused Vitest 17、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。residual medications / inquiry records read
  GET を readApiJson へ収束し、query path、encoded patient_id、org header、queryKey、enabled gate、
  error UI、intervention mutation、presigned upload flow は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 patient-medications readApiJson slice(c54ff5d4) land。focused Vitest 33、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。medication profiles / patient summary /
  medication issues / inquiry records / residual medications read GET を readApiJson へ収束し、query paths、
  encoded query values、patient API helper、org header、queryKey、enabled gates、no-false-empty/error UI、
  mutations、QR/export は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。

## 進行中 / 凍結

- codex: Codex CLI 0.142.5 最適化は検証済み。subagent persona 強化は履歴として保持するが、
  現行運用では subagent を使わない。user/profile config は fast/cached 既定、repo docs は
  Codex 単独運用へ整合済み。
- codex: W3-B9 `monthly_cap_shared` rule-engine fix は ae81a9f7 で land 済み。
  ledger-only evidence 差分は本 Codex CLI/persona スライスと一緒に保存対象。
- codex: `ID-1a` / `ID-1b` / `ID-2-W1` / `ID-2-W2` / `ID-2-W3` / `ID-2-W4` は land 済み。
  `ID-2-W5` も land 済み(86d9d273)。
  E1 は基準1 FAIL、E2（明示 tx allocator）正式採用。
- W4 land 時に既存欠陥 FIX-CATALOG-IDSEQ(a42065fa) を併せて解消（`IdSequence` が
  data-explorer カバレッジカタログ未分類でフル `pnpm test` が赤だった。db:generate 鮮度更新で顕在化）。
- 追跡: `ID-2-UR`（BACKLOG）= opus M-1「`User` は registry scope='org' だが波計画では global(W6)。
  `CXR2-RLS02` の design 判定で確定 → W6 で registry 是正 or org-wave 追加」+ L-1 completeness assertion。
- codex: `PERF-03` は read-only recon 後、fable 裁定で `flagged(raw SQL 要設計・低優先)` として据え置き。
- human-gate 記録: MFA1 / X01 とも RESOLVED 済み。

## 次の一手

1. codex: R55 schedule proposals は 8fee04d8、report delivery / operating-hours loading
   cleanup は 1122d58e 以降のR55 continuationで消化中。次の安全な high-score 候補を
   Codex 本体で read-only triage し、P0/human gate と実装候補を分離する。
2. codex: W3-B9 `monthly_cap_shared` rule-engine fix は ae81a9f7 で land 済み。長い gate が走っていないことを確認後、
   次の backend/business-domain 候補を read-only triage。
3. codex: Plans.md 未完了40件（open 37 + partial 3）を継続棚卸しし、human/external gate と実装候補を分離して task supply を維持。
4. held: `R40-PRINT-HUB-READAPIJSON` / high-risk W3-B6/ID migration/PMDA/AWS/UAT/legal は明示GOまたは human gate まで保留。
