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
- Phase C（実装ループ）: `ID-2-W3` visit/communication display_id 第3波 実装・検証済み、
  agmsg report 待ち

## 直近の land（本日・要点）

- Wave 2 完了 / W3-C2/E2/E3 / W3-B4 中核(52ce1f66) / B6 設計ラティファイ(3a39f69e) / v0.2 実証
- codex lane: BE-1 / RT1 / RR-QP-A/B / JOB1/2 / CW1 / BM1(5be6ebca) / 9d1567ba /
  PERF-01(981f1a58) / MFA1(f7bf2e97) / F84(c22c7fe3) / CE17(5205fc48) / R07(f3733036) /
  DR-DUP1(2e0c7fdb) / PERF-02(60469cd1) / CE20(66d65f99) / ID-1b(0a3b910c, e2a8b414)
  / ID-2-W1(898c0d6a) / ID-2-W2(90a1276e) — 全 opus APPROVE
- claude/opus lane: X01(e02cec50) / CE19(2136c93a) / N18(ad0ff309) / R03(3b31cec1) /
  A1-CRC(eebda8c3) land
- 全量 gate green: test 13035 passed（2026-07-03 夜、F84/CE19/N18/R03後）

## 進行中 / 凍結

- codex: `ID-1a` / `ID-1b` / `ID-2-W1` / `ID-2-W2` は land 済み。E1 は基準1 FAIL、
  E2（明示 tx allocator）正式採用。
- codex: `ID-2-W3` は report-ready。visit.prisma 10 + communication.prisma 14 direct org model に
  nullable display_id + org-scoped unique、partial unique migration、generic backfill reuse、
  local e2e migrate/seed/backfill 検証済み。`HandoffItem` は orgViaParent のため W7 残余へ回す方針。
- codex: `PERF-03` は read-only recon 後、fable 裁定で `flagged(raw SQL 要設計・低優先)` として据え置き。
- human-gate 記録: MFA1 / X01 とも RESOLVED 済み。

## 次の一手

1. codex: `ID-2-W3` agmsg report を送る
2. codex: verdict 前の追加編集は指示があるまで行わない
