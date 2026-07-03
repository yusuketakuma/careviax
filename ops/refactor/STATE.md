# STATE — 現在地（スリム版・~100行上限）

> 2026-07-03 台帳再編。アクティブ台帳は **STATE.md / BACKLOG.md / LOG.md**（+参照用 CODE_MAP.md）の
> 3+1 のみ。旧台帳・巨大ログは `archive/` に凍結（新規追記禁止）。
> 再開手順: このファイル → LOG.md 末尾 → BACKLOG.md → `git status` / `git log --oneline -15`。

## 体制（2026-07-03 ユーザー指示）

- fable(claude main) = 全体指揮・計画・モデルルーティング・commit
- 実装: codex(BE強い) / opus(複雑FE・アーキ) / sonnet(標準) / haiku(機械的)
- レビュー: opus 独立レビュー必須（maker/checker 分離）
- 規律: LOCK宣言→ACK→実装→report→opus verdict→claude commit。
  billing/算定/PHI隣接/authorization は self-commit 全面禁止。
- gate: lint / typecheck / typecheck:no-unused / format:check / test / build / colors:check
  （build と typecheck は並列禁止）

## Phase

- Goal Mode Phase A（監査スキャン）: **完了**（2026-07-03、commit 78022195）
- Phase B（REFACTOR_PLAN v2 = BACKLOG のスコア順実装計画）: 実行中
- Phase C（実装ループ）: 3レーン並行体制（2026-07-04〜）。codex(xhigh)=DB/schema、
  codex2(high)=BE services、codex3(medium)=cleanup。**display_id schema 波 W1-W7 完遂**
  (W7=483750cb)、全量 gate ALL GREEN(test 12995)。現在: codex=ID-2-CP-A(create-path 第1弾)、
  codex2=R24-B1(cursor page 収斂)、codex3=R23-B4(admin 35 hits)。

## 直近の land（本日・要点）

- Wave 2 完了 / W3-C2/E2/E3 / W3-B4 中核(52ce1f66) / B6 設計ラティファイ(3a39f69e) / v0.2 実証
- codex lane: BE-1 / RT1 / RR-QP-A/B / JOB1/2 / CW1 / BM1(5be6ebca) / 9d1567ba /
  PERF-01(981f1a58) / MFA1(f7bf2e97) / F84(c22c7fe3) / CE17(5205fc48) / R07(f3733036) /
  DR-DUP1(2e0c7fdb) / PERF-02(60469cd1) / CE20(66d65f99) / ID-1b(0a3b910c, e2a8b414)
  / ID-2-W1(898c0d6a) / ID-2-W2(90a1276e) / ID-2-W3(8c7e34e7) / ID-2-W4(7e18fcb2)
  / FIX-CATALOG-IDSEQ(a42065fa) / R21-SONNER1(68688360) / ID-2-W5(86d9d273) / ID-2-W6(d2bcde00) — 全 opus/committer APPROVE
- codex2 lane: R16-MIN(da5889f0) / R16-SWEEP(6f26c04c) / FE-FALSEEMPTY(27496917) — opus/committer APPROVE
- codex3 lane: R22-EXEC(759b4dbc) / R08-EXEC(cee20c66) — 全 opus APPROVE
- claude/opus lane: X01(e02cec50) / CE19(2136c93a) / N18(ad0ff309) / R03(3b31cec1) /
  A1-CRC(eebda8c3) land
- 全量 gate green: test 13035 passed（2026-07-03 夜、F84/CE19/N18/R03後）

## 進行中 / 凍結

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

1. codex: `ID-2-CP-A`（SavedView/MedicationIssue/Task/PCA の create へ same-tx allocateDisplayId 配線。HandoffItem 配線禁止=unique 軸未解決）
2. codex2: `R24-B1`（4 route の buildCursorPage 収斂、full-key-order assert）
3. codex3: `R23-B4`（admin 5 files 35 hits）→ B5
4. schema 波後の残プログラム: ID-2-CP-B以降(重量 create/createMany/upsert) → ID-3(UI 表示/検索の slice(-8) 置換) → ID-2-OPS(本番 CONCURRENTLY 手順)
5. 運用: 台帳=claude 専任、全量 gate=EDIT-FREEZE→ACK→直列実行(初適用で race ゼロ実証済み)
