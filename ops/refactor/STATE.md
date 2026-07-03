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
- Phase C（実装ループ）: `MFA1` codex 実装中（report→opus verdict→claude commit 待ち）

## 直近の land（本日・要点）

- Wave 2 完了 / W3-C2/E2/E3 / W3-B4 中核(52ce1f66) / B6 設計ラティファイ(3a39f69e) / v0.2 実証
- codex lane: BE-1 / RT1 / RR-QP-A/B / JOB1/2 / CW1 / BM1(5be6ebca) / 9d1567ba /
  PERF-01(981f1a58) — 全 opus APPROVE
- claude lane: X01 external-access GET 認可 e02cec50 land
- 全量 gate green: test 13033 passed（2026-07-03 夜）

## 進行中 / 凍結

- codex: `MFA1` ACKed lock。`auth/mfa/recovery` の restore-failure console 出力を safe logger へ置換中。
  recovery code / TOTP secret / session token / Cognito token 非包含を focused test で固定済み、report 待ち。
- human-gate 記録: MFA1 / X01 とも承認済み。`.agent-loop/BLOCKED.md` の完了更新は claude 側。

## 次の一手

1. codex: `MFA1` の検証完了後に agmsg report を送信し、opus/Claude verdict を待つ（self-commit なし）
2. fable: verdict 後に commit。BACKLOG `PERF-01` は次の台帳更新時に `done(981f1a58)` へ
3. 次候補: fable 割当待ち（F84 / CE19 / CE17 / N18 / R03/R07 等）
