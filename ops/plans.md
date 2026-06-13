# ops/plans.md — Ensemble フロー進行状況

> プロダクトのバックログ正本はリポジトリ直下の **`Plans.md`**（D-1〜D-9 トラック）。
> このファイルは **Ensemble オーケストレーションの進行状態**のみを管理する。

## フェーズ進行

| フェーズ | 状態 | 成果物 |
|---|---|---|
| F0/F1 recon | **概ね完了** | ✅`ops/SYSTEM_MAP.md` ✅`ops/UI_AUDIT.md` ✅`ops/DESIGN_LANGUAGE.md`(草案) / ⬜FEATURE_INTENT は ground で |
| ground | **完了** | ✅`ops/DESIGN_LANGUAGE.md`確定(状態色=design p0_46で決定) ✅`ops/DESIGN_GROUNDING_TABLE.md`(62画面×コード×gap→P0候補) |
| partition | **起草完了・承認待ち** | ✅`ops/P0_CANDIDATES.md` ✅`ops/P0_SCOPE.md`(第1波3件) ✅`ops/IMPLEMENTATION_PARTITION.md`(FE-A0/X-B0/FE-C0) ✅`ops/BACKEND_GAP_PLAN.md` ✅`ops/TEST_PLAN.md` |
| implement (F3) | ブロック | CHECKPOINT=No（残り: P0_SCOPE人手承認 + base state クリーン化） |
| verify | 未着手 | `ops/VERIFICATION.md` |

## Ensemble 検証の結論（F3 前提の de-risk 完了）
- read-only lane: team-say 不能（協調 bus 死）→ recon は solo harvest か worktree communicative。
- **書込可 lane + disposable worktree: team-say 動作・協調・auto-disband・clean teardown を実証**。F3 の FE×BE 協調前提は成立。
- 書込権限ありでも read-only 指示を遵守し source を触らなかった（worktree 隔離は保険として機能）。

## 現在のゲート
`ops/CHECKPOINT.md` = **Implementation Allowed? No**（recon 未完）

## base state の宿題
未コミット 48 ファイル差分を F3 前に commit/stash する（worktree が HEAD 分岐のため）。
