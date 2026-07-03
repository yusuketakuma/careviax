# ops/refactor — 台帳運用（2026-07-03 再編後）

## アクティブ（これだけ更新する）

| ファイル      | 役割                                                                                 | 更新タイミング        |
| ------------- | ------------------------------------------------------------------------------------ | --------------------- |
| `STATE.md`    | 現在地のみ（体制/Phase/進行中/次の一手）。**~100行上限**、古い内容は LOG へ落とす    | スライス着手/完了時   |
| `BACKLOG.md`  | 全 findings/候補の唯一の台帳。1項目に必ず status（open/in-progress/done/flagged/P0） | 発見時・status 変化時 |
| `LOG.md`      | 実施記録+検証を 1スライス1エントリ（15行以内目安）                                   | スライス land 時      |
| `CODE_MAP.md` | 参照資料（構造/コマンド/巨大ファイル/触ってよい領域）。低頻度更新                    | 大きな構造変化時      |

- P0/human-gate の正本は `.agent-loop/BLOCKED.md`（BACKLOG には参照だけ置く）
- プロダクト実装計画は `Plans.md`（この台帳はコード品質/リファクタ専用）
- codex 個人の `CODEX_GOAL_PROGRESS.md` / `.codex/ralph-state.md` は codex の任意管理（義務外）

## archive/

旧台帳（BUG/INCONSISTENCY/FE_BE/UI/DEAD_CODE/PERF/REFACTOR_PLAN/P0_PROPOSAL、
巨大化した REFACTOR_LOG/VERIFICATION/STATE、ULTRACODE 系スキャン、workflow スクリプト）を凍結。
**新規追記禁止**。歴史的根拠の参照のみ（BACKLOG の項目 ID は archive 内の原典に対応）。
