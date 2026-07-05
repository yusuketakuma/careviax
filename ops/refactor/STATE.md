# STATE — 現在地 / 単一進捗台帳

> 2026-07-05 台帳再編。アクティブな運用SSOT/進捗台帳は **この `ops/refactor/STATE.md` のみ**。
> `CODEX_GOAL_PROGRESS.md`、`.codex/ralph-state.md`、`ops/refactor/LOG.md`、
> `ops/refactor/BACKLOG.md` は履歴参照専用（新規追記禁止）。新しい slice evidence、commit、
> validation、remaining/next action はこのファイルへ集約する。
> 再開手順: このファイル → `git status --short --untracked-files=all` → `git log --oneline -15`。

## 体制（2026-07-04 ユーザー指示）

- 現行は Codex 単独運用。codex が Plans 棚卸し、実装、validation、単一台帳更新、scoped commit、
  例外処理を一貫して担当する。
- agmsg / codex2 / codex3 / codex4 / Claude / subagent / PATCH_REPORT 待ちは使わない。
  ユーザーが明示的に再有効化しない限り、過去の multi-agent 記述は歴史的記録として扱う。
- 規律: `git status --short --untracked-files=all` → 対象 diff 確認 → 小スライス実装 →
  focused validation → `ops/refactor/STATE.md` 更新 → explicit path staging → scoped commit。
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

- codex: R40/R44 formulary mutation responses no-store hardening batch(32381d1a) land。
  ユーザー指示により subagent を投入（api_contract_reviewer APPROVE、privacy_compliance_reviewer
  CHANGES_REQUESTED→対応）。focused Vitest 28、scoped ESLint/Prettier/diff-check、
  `pnpm typecheck` green。`/api/pharmacy-drug-stock-requests` と
  `/api/pharmacy-drug-stock-templates` の POST export を `authenticatedPOST` +
  `withSensitiveNoStore(await authenticatedPOST(...))` へ揃え、201 success、400 validation /
  malformed JSON、404 missing site、409 duplicate / empty source-stock conflict、401 unauthenticated、
  403 canAdmin denied、handler fixed 500 まで no-store を固定。body/status/root shape、DB transaction、
  `createAuditLogEntry`、org/site scoping、request/template audit semantics は保持。500 tests で raw
  unsafe error 非露出と safe structured logger context を固定し、template audit は
  `{ source_site_id, item_count }` の最小 changes に regression proof を追加。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) に基づき product API /
  PHI-adjacent mutation response hardening を変更、DB schema/migration/billing/deploy/package dependency
  変更は不要。残る別slice候補: `FormularyChangeRequest` の `reason` / `adoption_note` /
  `current_snapshot` audit retention は traceability と privacy minimization の policy decision として
  downstream audit export 露出を含めて別途評価。
- codex: R40/R44 formulary read routes no-store hardening batch(7dc08176) land。
  ユーザー指示により本sliceでは subagent を投入（api_contract_reviewer /
  privacy_compliance_reviewer）。focused Vitest 33、scoped ESLint/Prettier/diff-check、
  `pnpm typecheck` green。`/api/pharmacy-drug-stocks/history`、`/api/pharmacy-drug-stocks/impact`、
  `/api/pharmacy-drug-stock-requests`、`/api/pharmacy-drug-stock-templates` の GET export を
  `authenticatedGET` + `withSensitiveNoStore(await authenticatedGET(...))` へ揃え、成功・validation・
  not-found・auth rejection・`withAuthContext` の fixed `INTERNAL_ERROR` 500 まで
  `Cache-Control: private, no-store, max-age=0` / `Pragma: no-cache` を付与。body/status/root shape、
  canAdmin、org/site scoping、POST mutation/audit routes は保持。route-local tests で 200/400/404、
  auth 401、sanitized 500、raw unsafe error 非露出、safe structured logger context を固定。
  api_contract_reviewer の CHANGES_REQUESTED（export boundary wrapper、auth/500 no-store coverage、
  success envelope 保持）と privacy_compliance_reviewer の CHANGES_REQUESTED（PHI-adjacent /
  QR prescription-derived aggregate cache leakage、500/no-store regression）に対応済み。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) に
  基づき product API / PHI-adjacent response hardening を変更、DB schema/migration/billing/deploy/package
  dependency 変更は不要。残る別slice候補: requests/templates の POST mutation responses も同等の
  no-store route-local proof を入れるか、route-wide sensitive wrapper 方針へ標準化する。
- codex: R40/R44 admin drug-master supporting read queries readApiJson batch(94c95c3f)
  land。subagents: code_mapper APPROVE、api_contract_reviewer CHANGES_REQUESTED（success envelope /
  `{ message }` / `{ error }` / non-JSON fallback coverage、route no-store follow-up）、test_architect
  CHANGES_REQUESTED、verifier APPROVE。focused Vitest 105、scoped ESLint/Prettier/diff-check、
  `pnpm typecheck` green。drug-master detail / stock config / stock history / formulary review due /
  missing reorder / impact / usage mismatch / change requests / templates / preferred generic
  candidates / generic recommendations / ingredient group read query responses を readApiJson へ収束。
  endpoint builders、`buildOrgHeaders(orgId)`、query keys、enabled 条件、query params、success body
  root shape（raw detail、top-level analytics、reason、summary、`{ data: null }` empty state）は保持。
  tests で server `{ message }`、server `{ error }`、non-JSON fallback、非標準 success envelope を固定。
  blob export/template CSV は成功時 `blob()` contract のため対象外。残る別slice候補: formulary read routes
  `/api/pharmacy-drug-stocks/history`、`/impact`、`/api/pharmacy-drug-stock-requests`、
  `/api/pharmacy-drug-stock-templates` の explicit no-store route hardening（body/status不変）。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) に
  基づく追加 API/DB/deploy/package dependency 変更は本sliceでは不要。
- codex: R40/R44 admin billing-rules readApiJson + API/audit hardening batch(0a9d52e3)
  land。ユーザー明示により本sliceでは subagent を投入（api_contract_reviewer /
  data_integrity_auditor / verifier）。focused Vitest 56、verifier focused Vitest 41、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。`pnpm format:check` は今回対象外の
  untracked `.agents/skills/*` 14件の Prettier 警告で失敗し、billing-rules 対象ファイルは
  `prettier --check` と `git diff --check` green。billing SSOT sync / custom create /
  update / delete responses を readApiJson へ収束し、server `{ message }` / `{ error }` と
  non-JSON fallback regression を追加。api_contract_reviewer の CHANGES_REQUESTED
  （GET query enum validation、no-store、sanitized 500）に対応し、`/api/billing-rules` と
  `/api/billing-rules/:id` を `withSensitiveNoStore` + fixed `internalError()` + safe structured
  logger へ硬化。data_integrity_auditor の high finding に対応し、SSOT seed / custom create /
  update / delete を claim-affecting master-data mutation として同一 org-scoped transaction 内で
  `createAuditLogEntry` へ記録。endpoint、org scoping、canAdmin、encoded id helpers、
  exact dot-segment fail-closed、SSOT seed body `{ action: 'seed_home_care_ssot' }`、DELETE success
  JSON contract は保持。残る別slice候補: billing-rule PATCH/DELETE に `expected_updated_at` /
  ETag 型の optimistic concurrency を入れ、stale admin state を 409 conflict で fail-closed にする。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) に
  基づき billing API/audit を変更、DB schema/migration/deploy/package dependency 変更は不要。
- codex: R40/R44 document templates/delivery rules readApiJson + templates API hardening batch(1d9264cf)
  land。document-template UI/helper Vitest 35、templates/document-delivery-rules route Vitest 45、
  combined focused Vitest 85、scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。
  template save-delete / body editor save / delivery-rule save-delete responses を readApiJson へ収束し、
  server `{ message }` / `{ error }` と fallback regressions を追加。privacy_compliance_reviewer と
  api_contract_reviewer の CHANGES_REQUESTED に対応し、`/api/templates` / `/api/templates/:id` を
  `withSensitiveNoStore` + fixed `internalError()` + safe structured logger へ硬化。template content / consent /
  contract/privacy template text の cache/raw-error leakage を削減。既存 endpoint、org headers、payloads、
  canAdmin/org scoping、encoded id helpers、delivery-rules no-store contract は保持。残る別slice候補:
  template list GET の metadata/body 分離による payload minimization。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) に基づき API/PHI hardening を実施、
  DB/billing/deploy/package dependency 変更は不要。
- codex: R40/R44 handoff workspace actions readApiJson batch(65614b77) land。focused Vitest 29、
  handoff-board route Vitest 33、scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。
  transfer create / message send-read / consult create-resolve / receipt confirm responses を
  readApiJson へ収束し、server `{ message }` / `{ error }` と non-JSON fallback regression を追加。
  endpoint、org JSON/org headers、request bodies、success toasts、query invalidation、canReport/canAuthorReport
  route contract、withSensitiveNoStore envelopes は保持。api_contract_reviewer subagent APPROVE。
  test_architect subagent の CHANGES_REQUESTED（transfer `{ error }`/non-JSON、message/consult/read/resolve、
  receipt `{ message }`/`{ error }` coverage）に対応済み。PHI/authz の追加 product-policy 論点として
  read receipt を org-wide canReport で許す現行モデルは別slice候補。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 admin shifts mutations readApiJson batch(43cc7d29) land。focused Vitest 26、
  shift/pharmacist/business-holiday route Vitest 82、scoped ESLint/Prettier/diff-check、
  `pnpm typecheck` green。changed shift save / business holiday create-update-delete /
  pharmacist create-update-action / previous-month copy / weekly template save-delete-apply
  responses を readApiJson へ収束し、server `{ message }` / `{ error }` と non-JSON fallback、
  template apply `applied_count` regression tests を追加。api_contract_reviewer subagent は
  route success/error envelope、org header split、canVisit/canAdmin route contract を APPROVE。
  code_mapper subagent は残り高効率候補として handoff workspace、admin document templates/delivery
  rules、admin billing rules を提示。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 contact master mutations readApiJson batch(e407f4c5) land。focused Vitest 84、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。admin external-professionals save/delete
  と contact-profiles save responses を readApiJson へ収束し、external-professional dynamic path helper、
  contact-profile fixed collection PATCH、org JSON/org headers、request bodies、linked-patient delete blocker、
  dot-segment fail-closed、query invalidation、server-message fallback は保持。UI tests には external save
  `{ message }`、external save/delete non-JSON fallback、contact profile save `{ message}` / non-JSON fallback を
  追加。API contract subagent は contact profile PATCH の成功envelope型過大表現と no-store gap を
  CHANGES_REQUESTED として指摘し、UI側は `readApiJson<unknown>` に修正、`PATCH /api/contact-profiles` は
  `withSensitiveNoStore` wrapper化。route tests で malformed/validation/not-found/unexpected PATCH の
  no-store envelope と raw contact secret 非露出を追加。Mapper subagent は次の高効率候補として
  Admin Drug Masters / Formulary mutations を推奨。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) に基づき API route wrapper を変更、
  DB/billing/deploy/package dependency 変更は不要。
- codex: R40/R44 PCA pump mutations readApiJson batch(cc724d38) land。focused Vitest 111、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。PCA pump create / rental create /
  rental status PATCH / pump status PATCH / return-inspection PATCH responses を readApiJson へ収束し、
  `PATCH /api/pca-pump-rentals/:id` を status/return-inspection の単一routeとして維持。org JSON headers、
  request bodies、rentalSaveBlocker、returnInspectionSaveBlocker、dot-segment fail-closed、
  Japan date semantics、invalidateAll、server-message fallback は保持。UI tests には create rental /
  rental stale update / pump pending-inspection / return inspection checklist の `{ message }` preservation と、
  rental status / return inspection の non-JSON fallback regression を追加。Patient Safety subagent は
  PCA医療機器workflowの server-message regression gap を CHANGES_REQUESTED として指摘し、追加テストで対応。
  Compatibility subagent は current route surface と response envelope を APPROVE、ただし
  `pca-pump-rentals/[id]` PATCH の unexpected-error no-store wrapper は将来hardening候補として残ると整理。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本batchでは不要。
- codex: R40/R44 schedule board support readApiJson batch(d094291d) land。focused Vitest 39、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。calendar billing-preview batch read /
  schedule-team-board visit-status PATCH / operational-task PATCH responses を readApiJson へ収束し、
  billing preview warning UI、org JSON headers、path encoding、raw status payloads、dot-segment fail-closed、
  schedule/task server-message fallback は保持。team-board には `{ message }` / `{ error }` API message の
  mutationFn regression を追加。Locator subagent は schedule 残差を batch 分類し、本sliceを Batch 3+4 と
  して妥当と判定。Sentinel reviewer はタイムアウトしたため shutdown し、focused tests + scoped checks +
  typecheck を主証跡に採用。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本batchでは不要。
- codex: R40/R44 route actions readApiJson batch(75e57849) land。focused Vitest 22、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。visit route reorder helper 3系統 /
  route-compare route-engine POST / emergency-route route-engine POST responses を readApiJson へ収束し、
  route_order optimistic concurrency、confirmed visit exclusion、vehicle assignment context、
  emergency interruption reconfirmation context、server-message fallback は保持。emergency-route には
  route-engine non-OK server-message と no-reorder fail-closed の focused regression を追加。Clinical Safety
  subagent は confirmed visit ordering / vehicle assignment / emergency reconfirmation / server-message
  preservation を review し、response parsing 限定なら APPROVE。検証時に
  `conflict-resolution-content.test.tsx` の既存 React act warning は出たが、4 test files / 22 tests は green。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本batchでは不要。
- codex: R40/R44 schedule-day actions readApiJson batch(4ea57765) land。focused Vitest 55、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。schedule-day planner proposal generation /
  reschedule proposal generation / proposal action PATCH / facility visit-day save responses を readApiJson へ
  まとめて収束し、org JSON headers、path encoding、idempotency key、payload shapes、server-message fallback、
  dialog close / week-board / proposal / schedule-day-board / task invalidations は保持。subagents: Mapper が
  schedule 近傍候補を分類し、planner を本 batch に含め route compute/reorder は別 route-focused slice 推奨と
  判定。Strict は reschedule/proposal-action の route success JSON envelope / error envelope / header/body /
  idempotency / invalidation contract を read-only APPROVE。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本batchでは不要。
- codex: R40/R44 patient-labs mutations readApiJson slice(d5be8acb) land。focused Vitest 14、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。patient lab create / update mutation
  responses を readApiJson へ収束し、patient path helper、org JSON headers、raw patient query-key
  invalidation、getPatientCareQueryKeys invalidation、dot-segment fail-closed、server-message fallback は保持。
  テストでは fetch mock を call ごとに fresh Response にし、readApiJson の text() 消費 semantics に合わせた。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
- codex: ledger-consolidation rule change(7a2e798c) land。2026-07-05 ユーザー指示により、
  active progress/SSOT ledger は `ops/refactor/STATE.md` のみ。
  `.codex/ralph-state.md`、`CODEX_GOAL_PROGRESS.md`、`ops/refactor/LOG.md`、
  `ops/refactor/BACKLOG.md` は historical/reference とし、新規 slice entry は追記しない。
- codex: R40/R44 shared-viewer readApiJson slice(86aa951c) land。focused Vitest 10、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。external access GET /
  self-report POST responses を readApiJson へ収束し、OTP header、idempotency key、
  self-report body、draft autosave/clear、409/429 fixed toast contract、archive display は保持。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
- codex: R40/R44 patient-MCS mutations readApiJson slice(dbe25eac) land。focused Vitest 13、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。MCS sync / check-log create /
  profile update mutation responses を readApiJson へ収束し、patient path helper、org JSON headers、
  raw patient query-key invalidation、dot-segment fail-closed、server-message toast fallback は保持。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
- codex: R40/R44 patient-contacts save readApiJson slice(f027ecda) land。focused Vitest 9、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。patient contacts save PUT response を
  readApiJson へ収束し、patient path helper、org JSON headers、expected_updated_at body、
  raw patient query-key invalidation、dot-segment fail-closed、server-message fallback は保持。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
- codex: R40/R44 handoff-confirm readApiJson slice(2dec39c5) land。focused Vitest 2、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。visit handoff confirm PUT response を
  readApiJson へ収束し、endpoint、org JSON headers、edit payload、server-message/fallback toast、
  visit-record / visit-handoff invalidation は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 facility-visit-batch save readApiJson slice(57fa1e83) land。focused Vitest 6、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。facility visit batch POST response を
  readApiJson へ収束し、org JSON headers、payload ordering/route-order guard、unsafe carry
  fail-closed、server-message fallback、week-board/dashboard-workflow invalidation は保持。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
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
- codex: R40/R44 workflow-mutations readApiJson slice(1493006d) land。focused Vitest 9、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。workflow dashboard emergency draft /
  inquiry create / inquiry resolve / refill proposal mutation responses を readApiJson へ収束し、
  GET helper、endpoints、org JSON headers、request bodies、success toasts、invalidation は保持。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
- codex: R40/R44 conflict-resolution readApiJson slice(67ba5eef) land。focused Vitest 8、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。pharmacist lookup read GET を
  readApiJson へ収束し、visit schedule window fetcher / false-empty prevention / adoption and
  reconfirmation mutation contract は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
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
- codex: R40/R44 generic-candidates readApiJson slice(68ac7d85) land。focused Vitest 7、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。prescription intake の generic
  candidate lookup read GET を readApiJson へ収束し、drug-master path helper /
  q,generic,limit,includeTotal params / org header / queryKey / enabled gate / generic-name
  checkbox / candidate selection / submit payload contract は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 qr-draft-review readApiJson slice(d08fb9e5) land。focused Vitest 10、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。QR draft detail / active case
  lookup read GET を readApiJson へ収束し、draft/cases endpoints / encoded patient_id /
  active status,limit params / org header / queryKeys / enabled gates / retry UI /
  hostile-id links / confirm and discard mutations は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 qr-draft-list readApiJson slice(09120529) land。focused Vitest 1、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。QR draft list all / unmatched
  read GET を readApiJson へ収束し、endpoints/query params / org header / queryKeys /
  fallback refetch / realtime invalidation / enabled gates / DataTable states / row navigation /
  keyboard shortcuts は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 billing-candidates readApiJson slice(1e561e01) land。focused Vitest 8、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。billing candidates list read GET を
  readApiJson へ収束し、endpoint/query params / org header / infinite query key /
  cursor pagination / DataTable error states / target highlight / close-export disabled reasons は保持。
  export-preview query、generation/review/close mutations、CSV blob export は未変更。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
- codex: R40/R44 patient-form-lookups readApiJson slice(bbf75619) land。focused Vitest 24、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。patient form の facilities /
  facility-units / service-areas / pharmacists / staff lookup read fetchers を readApiJson へ収束し、
  endpoints/path helper / hostile-id encoding / org header / queryKeys / enabled gates /
  care-team disabled,error states / duplicate check / qualification check / create-update mutations は保持。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
- codex: R40/R44 workflow-phase-access readApiJson slice(cc0eba08) land。focused Vitest 8、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。workflow phase access read GET を
  readApiJson へ収束し、endpoint / org header / queryKey / realtime invalidation /
  enabled gate / response normalize / malformed fail-closed behavior は保持。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
- codex: R40/R44 patient-mcs-overview readApiJson slice(ffb0a6a9) land。focused Vitest 11、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。patient MCS overview read GET を
  readApiJson へ収束し、patient path helper / hostile-id encoding / limit normalization /
  org header / no-store / queryKey / 403 forbidden typed error / malformed fail-closed behavior は保持。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
- codex: R40/R44 schedule-day-preparation readApiJson slice(596b4942) land。focused Vitest 19、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。visit-preparation details read GET を
  readApiJson へ収束し、endpoint / schedule-id hostile encoding / dot-segment fail-closed /
  org header / pack identity guard / readiness behavior / save-mark-ready mutation は保持。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
- codex: R40/R44 consent-records readApiJson slice(3e04a3fd) land。focused Vitest 10、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。consent templates / consent records
  list read GET を readApiJson へ収束し、endpoints / org header / queryKeys / enabled gates /
  DataTable false-empty prevention / upload-create-update-revoke mutation contract は保持。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
- codex: R40/R44 visit-record-cds-alerts readApiJson slice(3a2cf923) land。focused Vitest 23、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。visit record CDS alerts read query
  (`POST /api/cds/check`) を readApiJson へ収束し、endpoint / method / cycleId body /
  org JSON header / queryKey / enabled gate / CdsAlertPanel unavailable state / save-upload flows は保持。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
- codex: R40/R44 report-delivery-reminders readApiJson slice(1efcc899) land。focused Vitest 10、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。report delivery reminders mutation
  response を readApiJson へ収束し、endpoint / method / overdue_days-delivery_ids-snooze_until body /
  org JSON header / queued-count payload / toast-invalidation contract は保持。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
- codex: R40/R44 communication-follow-up readApiJson slice(c6bc1af8) land。focused Vitest 15、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。communication resolve-followup
  mutation response を readApiJson へ収束し、encoded endpoint / expected_updated_at-response-followup
  body / org JSON header / dot-segment fail-closed / toast-invalidation contract は保持。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
- codex: R40/R44 report-editor-save readApiJson slice(37bd8bb6) land。focused Vitest 4、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。report editor save mutation
  response を readApiJson へ収束し、encoded care-report endpoint / PATCH method /
  expected_updated_at-content body / org JSON header / toast-invalidation contract は保持。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
- codex: R40/R44 report-share-mutations readApiJson slice(084b5736) land。focused Vitest 28、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。report share follow-up task /
  reply-request mutation responses を readApiJson へ収束し、tasks / communication-requests
  endpoints / POST bodies / org JSON headers / hostile identity handling / toast-invalidation contract は保持。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
- codex: R40/R44 patient-share-mutations readApiJson slice(5d836984) land。focused Vitest 12、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。patient share follow-up task /
  reply-request mutation responses を readApiJson へ収束し、tasks / communication-requests
  endpoints / patient-scoped POST bodies / org JSON headers / hostile identity handling /
  toast-invalidation contract は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 business-holidays readApiJson slice(fe3056b9) land。focused Vitest 16、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。business-holiday save/delete mutation
  responses を readApiJson へ収束し、business holidays / pharmacy sites reads、path helper、
  hostile-id encoding、dot-segment fail-closed、org headers、request bodies、success toasts、
  invalidation contract は保持。bulk creation は multi-response partial-failure contract が別なので未変更。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
- codex: R40/R44 institution-mutations readApiJson slice(d5253605) land。focused Vitest 23、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。prescriber institution save/delete
  mutation responses を readApiJson へ収束し、institutions read、path helper、hostile-id encoding、
  dot-segment fail-closed、org headers、request bodies、success toasts、invalidation contract は保持。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
- codex: R40/R44 vehicle-mutations readApiJson slice(e2cc0fbf) land。focused Vitest 11、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。visit vehicle resource save /
  availability mutation responses を readApiJson へ収束し、vehicles / pharmacy-sites reads、
  path helper、hostile-id encoding、dot-segment fail-closed、org headers、request bodies、
  success toasts、invalidation contract は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 facility-mutations readApiJson slice(d4bfd28a) land。focused Vitest 13、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。admin facility save/delete mutation
  responses を readApiJson へ収束し、facilities / units reads、path helper、hostile-id encoding、
  dot-segment fail-closed、org headers、request bodies including expected_updated_at、success toasts、
  invalidation contract は保持。facility unit mutations は別スライス候補として未変更。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
- codex: R40/R44 facility-unit-mutations readApiJson slice(523f6946) land。focused Vitest 15、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。admin facility unit save/delete
  mutation responses を readApiJson へ収束し、facilities / units reads、facility/unit path helpers、
  hostile-id encoding、dot-segment fail-closed、org headers、request bodies、success toasts、
  unit invalidation contract は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 report-detail-mutations readApiJson slice(ecb66652) land。focused Vitest 39、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。report detail confirm /
  single-send / bulk-send mutation responses を readApiJson へ収束し、care-report
  confirm-send endpoints / expected_updated_at bodies / idempotency headers / org JSON headers /
  hostile-id handling / toast-invalidation contract は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 billing-candidate-mutations readApiJson slice(a20ecb91) land。focused Vitest 9、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。billing candidate export preview /
  generate / review / close responses を readApiJson へ収束し、query params / request bodies /
  org headers / disabled reasons / billing calculation-close behavior は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 visit-brief-feedback readApiJson slice(b466bbf0) land。focused Vitest 16、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。visit brief card / pharmacist
  review feedback POST responses を readApiJson へ収束し、/api/visit-brief-feedback endpoint /
  method / org JSON headers / patient-context-generation-summary-rating-provider body /
  success toast-local state は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 facility-packet-save readApiJson slice(93bbf74f) land。focused Vitest 3、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。facility visit packet save POST
  response を readApiJson へ収束し、/api/facility-visit-batches endpoint / method /
  org header shape / schedule order-route guard-packet memo body / success toast / edit close /
  query invalidation は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 prescription-history readApiJson slice(d65d08d5) land。focused Vitest 29、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。patient prescription history GET /
  drug-master batch enrichment POST を readApiJson へ収束し、patient path helper / hostile-id
  encoding / limit=100 / org headers / queryKeys / enabled gates / batch body /
  non-blocking notice / mutation and cache invalidation contracts は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 medication-calendar readApiJson slice(07e701d6) land。focused Vitest 8、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。current medication profile
  read GET を readApiJson へ収束し、medication-profiles endpoint / encoded patient_id /
  is_current,limit params / org header / queryKey / enabled gate / PDF href /
  loading,error,empty states / PHI-free structural labels は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 weekly-optimizer readApiJson slice(c13f5942) land。focused Vitest 11、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。weekly optimizer の cases /
  case search / proposals / shifts / vehicle resources / billing preview read fetchers を
  readApiJson へ収束し、endpoints/query params / org header / queryKeys / enabled gates /
  board states / URL sync / route reorder and facility aggregation mutations は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 handoff-workspace readApiJson slice(8d74ea99) land。focused Vitest 23、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。handoff board / dashboard cockpit /
  handoff confirmation tasks / recent comments / visit handoff read fetchers を readApiJson へ収束し、
  endpoints/query params / org header / queryKeys / realtime invalidation / enabled gates /
  board,action-rail,comment-feed,visit-handoff states / transfer,message,resolve,read,confirm mutations は保持。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
- codex: R40/R44 schedule-proposals readApiJson slice(b4deef16) land。focused Vitest 40、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。dashboard list / case search /
  vehicle resources / billing preview batch / detail read query fetchers を readApiJson へ収束し、
  endpoints/query params / org header / queryKeys / realtime invalidation / enabled gates /
  dashboard,detail states / patient-contact workflow / bulk,single approve,reject,contact,reproposal /
  route reorder mutations は保持。SSOT の必要時変更許可
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
- codex: R40/R44 admin-user-mutations readApiJson slice(b89beba3) land。focused Vitest 15、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。admin user invite / detail update /
  account action mutation responses を readApiJson へ収束し、pharmacists path helpers、
  hostile-id encoding、org JSON headers、request bodies、success toasts、admin-users invalidation、
  `canAdmin` / Cognito / audit logging contract は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 admin-realtime readApiJson slice(628df9dc) land。focused Vitest 13、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。queryFn contract test で
  org-scoped workflow/notification endpoints を固定。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 data-explorer readApiJson slice(e3d7cd4b) land。focused Vitest 10、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。queryFn contract test で
  org-scoped model/row endpoints と PHI-free row action contract を維持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 data-explorer-save readApiJson slice(f5494af5) land。focused Vitest 11、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。admin data explorer row save
  mutation response を readApiJson へ収束し、org-scoped PATCH endpoint / patch body / success toast /
  editor draft reset / row invalidation / PHI-free row action label contract は保持。SSOT の必要時変更許可
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
- codex: R40/R44 external-viewer-mutations readApiJson slice(60c0a3ad) land。focused Vitest 11、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。external viewer self-report update /
  task creation mutation responses を readApiJson へ収束し、org JSON headers、updated_at body、
  task dedupe/metadata、converted_to_task 後続更新、success toast、invalidation contract は保持。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
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
- codex: R40/R44 intervention-panel readApiJson slice(29c99563) land。focused Vitest 5、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。intervention list/create/outcome-save
  responses を readApiJson へ収束し、endpoints、methods、request bodies、initial fetch suppression、
  loading/error/empty states、local outcome update、dialog reset contract は保持。SSOT の必要時変更許可
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
- codex: R40/R44 patient constraints save readApiJson slice(40d5b1d0) land。focused Vitest 19、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。patient packaging / visit constraints の
  save PUT response を readApiJson へ収束し、patient API path helper、hostile-id encoding、
  dot-segment fail-closed、org JSON headers、PUT methods、request bodies、success toasts、
  cache invalidation は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 care-team mutations readApiJson slice(0e60e3aa) land。focused Vitest 13、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。external professionals quick-create POST /
  patient care-team save PUT response を readApiJson へ収束し、static admin endpoint、patient API
  path helper、hostile-id encoding、dot-segment fail-closed、org JSON headers、request bodies、
  reliability warnings、success toasts、cache invalidation は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 notification read-state readApiJson slice(c45b384d) land。focused Vitest 12、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。notification read-state PATCH response を
  readApiJson へ収束し、NOTIFICATIONS_API_PATH、org JSON headers、PATCH body、inbox invalidation、
  realtime inbox、offline pending-sync row、loading/error states、navigation は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 task request readApiJson slice(84114154) land。focused Vitest 13、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。work request creation POST response を
  readApiJson へ収束し、/api/tasks、org JSON headers、request body、related entity metadata、
  success toast、tasks/staff-workload invalidation、bulk-completion schema handling は保持。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
- codex: R40/R44 operational policy save readApiJson slice(74d93c1a) land。focused Vitest 8、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。operational policy PATCH response を
  readApiJson へ収束し、/api/settings/operational-policy、org JSON headers、PATCH body、
  success toast、cockpit / policy query loading states は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 saved views readApiJson slice(dc81e08b) land。focused Vitest 15、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。preferences PATCH と named
  saved-view create/rename/share/delete responses を readApiJson へ収束し、preferences /
  saved-views endpoints、path helpers、hostile-id encoding、dot-segment fail-closed、org headers、
  request bodies、query keys、invalidation、success toasts、recall navigation は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 site switching readApiJson slice(d88a6fa0) land。focused Vitest 3、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。site switching PUT response を
  readApiJson へ収束し、/api/me/sites read、/api/me/site PUT、org headers、request body、
  success toast、me-sites invalidation、dashboard navigation は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 service areas readApiJson slice(b6a7cf80) land。focused Vitest 17、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。service-area create/update/delete
  responses を readApiJson へ収束し、SERVICE_AREAS_API_PATH、buildServiceAreaApiPath、
  hostile-id encoding、dot-segment fail-closed、org headers、request bodies、success toasts、
  service-areas invalidation は保持。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 schedule proposal workspace readApiJson slice(d30d17f2) land。
  focused Vitest 53、scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。
  schedule-proposals-content の single/bulk proposal PATCH と reproposal POST、schedule-weekly-optimizer の
  proposal generation POST / route preview POST を readApiJson へ収束。medical_safety_reviewer と
  api_contract_reviewer を投入し、PHI-safe single/bulk action error sanitization、expected_updated_at
  stale guard、contact idempotency、top-level diagnostics、top-level VisitRoutePlan contract を保持。
  route preview top-level VisitRoutePlan と failed preview message preservation の regression tests を追加。
  SSOT の必要時変更許可 (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は
  維持しつつ、本sliceでは不要。
- codex: R40/R44 conference mutations readApiJson slice(06369187) land。focused UI Vitest 19、
  conference API route Vitest 75、scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。
  conference note create / community activity create / action-item task conversion / conference report generation
  responses を readApiJson へ収束し、endpoint、method、org JSON headers、body、dynamic note path encoding、
  sync summary、server message preservation は保持。code_mapper で残存 cluster を棚卸しし、
  api_contract_reviewer で conference-notes/community-activities/tasks/generate-report の response envelope と
  PHI-safe error presentation を確認(APPROVE)。SSOT の必要時変更許可
  (product API/DB/auth/authorization/PHI/billing/deploy/package dependency) は維持しつつ、本sliceでは不要。
- codex: R40/R44 drug master/formulary mutation readApiJson slice(26ad685f) land。focused Vitest
  `drug-master-content` + `client-json` 103、drug-master/pharmacy-drug-stocks api-path Vitest 6、
  scoped ESLint/Prettier/diff-check、`pnpm typecheck` green。official import preview/run、
  drug-master job、formulary stock/request/bulk/copy/template/review/safety-follow-up mutation error parsing を
  readApiJson へ収束し、server `{message}` / `{error}` と non-JSON fallback regression tests を追加。
  api_contract_reviewer と medical_safety_reviewer を投入し、CSV export/template は成功 Blob path を維持、
  error path のみ readApiJson、auto-refresh job は top-level `processedCount` contract へ修正。
  typed confirmation、org JSON/header split、hostile-id path helpers、dry-run request-context stamping、
  stale preview sync clearing、採用薬CSVのYJ identity fail-closed behavior は保持。SSOT の必要時変更許可
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
4. codex: 次の R40/R44 readApiJson 候補は code_mapper 棚卸しより、患者詳細 Home Operations /
   PCA ポンプ台帳 / admin master mutation / Drug Master/Formulary reads / PHI print GETs。
   外部 PUT/blob/export/Auth/MFA は別sliceで扱う。
5. held: `R40-PRINT-HUB-READAPIJSON` / high-risk W3-B6/ID migration/PMDA/AWS/UAT/legal は明示GOまたは human gate まで保留。
