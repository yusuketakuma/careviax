# STATE — 現在地（スリム版・~100行上限）

> 2026-07-03 台帳再編。アクティブ台帳は **STATE.md / BACKLOG.md / LOG.md**（+参照用 CODE_MAP.md）の
> 3+1 のみ。旧台帳・巨大ログは `archive/` に凍結（新規追記禁止）。
> 再開手順: このファイル → LOG.md 末尾 → BACKLOG.md → `git status` / `git log --oneline -15`。

## 体制（2026-07-04 ユーザー指示）

- codex = 全体統括 coordinator / checker / central-gate / committer / task-router。
  メイン lane は実装で塞がず、Plans 棚卸し、割当、review、gate、scoped commit、例外処理を優先する。
- 実行役: codex2 = frontend/UI、codex3 = cleanup/DataTable/API-helper、codex4 = backend/business-domain
  recon/implementation。各 agent は exact path assignment 以外を編集しない。
- Claude は今回の運用から削除済み（agmsg `phos` registration removed）。新規 work/review/gate は送らない。
  既存メッセージは legacy handoff として扱う。
- 規律: agmsg drain → exact LOCK/assignment → 実装/validation → PATCH_REPORT → codex review →
  central gate/scoped commit。実行役の self-commit 禁止。
- gate: lint / typecheck / typecheck:no-unused / format:check / test / build / colors:check
  （build と typecheck は並列禁止。BUILD-LOCK 中は実行役が build/typecheck/no-unused を走らせない）

## 全エージェント共通の自律待機方針（2026-07-04 ユーザー指示）

- 対象: Codex / codex2 / codex3 / codex4 / future workers（Claude は今回の `phos` から削除済み）。
- review待ち、LOCK待ち、land待ち、狭い blocker、担当slice hold中でも、完全停止しない。
- まず agmsg と dirty tree を確認し、active LOCK・peer dirty・危険領域を避ける。
- 編集できない場合も read-only recon、衝突表、候補scoring、focused validation、次に安全な作業の棚卸しを続ける。
- 編集可能な候補が見つかった場合は exact path を LOCK/claim してから、小さく reviewable な差分だけ実装する。
- maker/checker、人間承認、billing/算定/PHI隣接/authorization、migration/deploy/destructive gate は迂回しない。

## Phase

- Goal Mode Phase A（監査スキャン）: **完了**（2026-07-03、commit 78022195）
- Phase B（REFACTOR_PLAN v2 = BACKLOG のスコア順実装計画）: 実行中
- Phase C（実装ループ）: 3実行レーン+codex統括体制（2026-07-04〜）。
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
  / FIX-CATALOG-IDSEQ(a42065fa) / R21-SONNER1(68688360) / ID-2-W5(86d9d273) / ID-2-W6(d2bcde00) — 全 opus/committer APPROVE
- codex2 lane: R16-MIN(da5889f0) / R16-SWEEP(6f26c04c) / FE-FALSEEMPTY(27496917) /
  R55 admin-jobs route loading label(66ae881e) / R55 admin master loading labels(f0029164) —
  coordinator validation green。R55 schedule operational task loading(a54484d3) — focused validation green
- codex3 lane: R22-EXEC(759b4dbc) / R08-EXEC(cee20c66) /
  R55 drug-master import-history skeleton(fd065171) / R21 report delivery sonner mock(932d3d22) —
  coordinator validation green
- codex4 lane: W3-B9 evidence-side missing emergency category blocker(cbef13f4) /
  W3-B9 rule-engine missing emergency category fail-closed(d535b4f6) — focused validation green
- legacy Claude/Opus lane（削除前の履歴）: X01(e02cec50) / CE19(2136c93a) / N18(ad0ff309) /
  R03(3b31cec1) / A1-CRC(eebda8c3) land
- 全量 gate green: test 13035 passed（2026-07-03 夜、F84/CE19/N18/R03後）

## 進行中 / 凍結

- codex2: frontend/UI lane。`R55-ADMIN-JOBS-PAGE-SUSPENSE-LOADING-LABEL` は
  66ae881e、`R55-ADMIN-MASTER-PAGE-SUSPENSE-LOADING-LABELS` は f0029164 で land。
  `R55-SCHEDULE-OPERATIONAL-TASKS-LOADING-SKELETON` は a54484d3 で land。
  次は frontend/UI の安全な read-only 候補探索または coordinator 割当待ち。
- codex3: W3-E2/R55 cleanup lane。DataTable contract と prescriptions migration は land 済み。
  `R55-DRUG-MASTER-IMPORT-HISTORY-LOADING-SKELETON` は fd065171 で land。
  `R21-SONNER-MOCK-SMALL-WAVE` は 932d3d22 で land。
  次は R55/DataTable/API-helper/test-helper の安全な候補探索または coordinator 割当待ち。
- codex4: W3-B9 billing-cycle lane。cycle-null/cycle-bound emergency category 欠落は
  evidence 側 cbef13f4 + rule-engine 側 d535b4f6 で fail-closed 化済み。次は
  `monthly_cap_shared` が rule-engine 上限計算で未消費の候補を、公式点数/単位確認つきで read-only
  recon → 小スライス化する。
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

1. codex2: frontend/UI の次候補を read-only recon し、exact-path LOCK/assignment 待ち。
2. codex3: R55/DataTable/API-helper/test-helper の次候補を read-only recon し、exact-path LOCK/assignment 待ち。
3. codex4: W3-B9 `online shared monthly cap` read-only recon。`monthly_cap_shared` / care online
   46単位 / medical online 59点の cap 根拠と実装スライスを確認し、billing reviewer 前提で報告。
4. codex: Plans.md 未完了40件（open 37 + partial 3）を継続棚卸しし、human/external gate と実装候補を分離して task supply を維持。
5. held: `R40-PRINT-HUB-READAPIJSON` / high-risk W3-B6/ID migration/PMDA/AWS/UAT/legal は明示GOまたは human gate まで保留。
