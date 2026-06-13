# ops/ — Ensemble 実行管制プレーン

careviax の多エージェント実装を **司令塔（このディレクトリ）** と **実行管制塔（Ensemble）** に分離して運用するための制御ドキュメント群。

## 役割分担（確定）

| 層 | 担当 | 責務 |
|---|---|---|
| 司令塔 | `ops/CHECKPOINT.md` `ops/P0_SCOPE.md` `ops/IMPLEMENTATION_PARTITION.md` | 実装可否・スコープ・衝突制御の**正本** |
| 実装(FE) | Claude Code / Claude Opus 4.8 | UI・画面構成・design ground・FE レビュー |
| 実装(BE) | Codex CLI / GPT-5.5 | API/schema/validation/permission/DB/状態・BE テスト |
| 実行管制 | Ensemble (`~/tools/ensemble`) | 起動・会話ログ・TUI 監視・steer・lane 管理（**merge 権限なし**） |

## Ensemble 実装挙動の確定事項（ソース根拠）

1. **lane への指示は team の `description` のみが経路**。`services/ensemble-service.ts:buildPromptPreview` は description + templateName(index 依存) + 固定通信ルールしか注入しない。`agents[].role` 文字列・`.claude/agents/*.md` は **Ensemble lane に効かない**（spawn されるのは素の `claude`/`codex` CLI）。→ partition 規律は description に直書きする。
2. **`collab-templates.json` は Ensemble リポジトリ直下のみ読まれる**（`__dirname/../`）。careviax 側はドキュメント扱い。templateName は使わず description に集約。
3. **`agents.json` は `ENSEMBLE_AGENTS_CONFIG` で careviax を指す**（`lib/agent-config.ts:19`）。`ops/ensemble-env.sh` を source して起動。
4. **codex `-a on-request` は無人 pane でハングする**（Ensemble の自動応答は Claude の trust/bypass のみ）。lane は `-a never`、安全は `-s` sandbox で担保。
5. **`useWorktrees:true` は disband 時に自動 merge する**（`disbandTeam:894-929`）→ **必ず `useWorktrees:false`**。worktree は手動作成、緑 lane のみ手動 merge。
6. lane への prompt 注入は **active agent ≥2** が条件。team は実装+レビューの 2 体構成。

## フェーズ
- **F0/F1 recon**: read-only。SYSTEM_MAP / FEATURE_INTENT / UI_AUDIT / DESIGN_LANGUAGE 草案を生成。
- **ground**: DESIGN_LANGUAGE / DESIGN_GROUNDING_TABLE 確定。
- **partition**: P0_SCOPE + IMPLEMENTATION_PARTITION + CHECKPOINT ゲート。
- **implement-ensemble (F3)**: 手動 worktree per lane、FE=Claude / BE=Codex、緑 lane のみ手動 merge。
- **verify**: 統合検証。

## 不採用（固定）
P0 自動確定 / 自動 merge / ゲート判断委譲 / partition なし大量投入 / permissive flags 無制限 / internet 公開。
