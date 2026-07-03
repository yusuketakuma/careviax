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
- Phase B（REFACTOR_PLAN v2 = BACKLOG のスコア順実装計画）: 次アクション
- Phase C（実装ループ）: BACKLOG セクション B から着手予定

## 直近の land（本日・要点）

- Wave 2 完了 / W3-C2/E2/E3 / W3-B4 中核(52ce1f66) / B6 設計ラティファイ(3a39f69e) / v0.2 実証
- codex lane: BE-1 / RT1 / RR-QP-A/B / JOB1/2 / CW1 / BM1(5be6ebca) / 9d1567ba — 全 opus APPROVE
- 全量 gate green: test 13033 passed（2026-07-03 夜）

## 進行中 / 凍結

- codex: LOCK 凍結中（台帳再編完了通知待ち）。VG1 は WITHDRAW 済（BACKLOG `A1-GEO` flagged）
- human-gate 待ち: MFA1（auth safe-log）/ X01（external-access GET 認可）→ .agent-loop/BLOCKED.md

## 次の一手

1. 台帳再編 commit → codex へ新体制通知+凍結解除
2. Phase B: BACKLOG B-0/B/C から安全×効果×検証容易性スコア順に割当
   （即候補: PERF-01(O(n²), 安5効4検5) / F84(consent 並行) / CE19(mention 残留通知=bug) /
   CE17・N18(perf) / R03・R07(dead-code, 現存確認済み)）
3. UI_LAYOUT 実測監査（dev server+browse）は独立レーンで後続
