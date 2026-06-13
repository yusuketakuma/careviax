# CHECKPOINT — 実装可否ゲート（正本）

> このファイルが実装の唯一のゲート。`/implement-ensemble` は preflight でここを読み、
> "Implementation Allowed? Yes" 以外なら STOP する。手動でのみ Yes にする。

## Implementation Allowed? **Yes**（第1波: FE-A0 / X-B0 / FE-C0）

承認: 2026-06-13。P0_SCOPE 人手承認済 + base state クリーン化済（4コミット・検証green）。
注: 実 lane 起動時に worktree へ node_modules を用意（symlink/install）。

## ゲート前提

- [x] F0/F1 recon 完了 → `ops/SYSTEM_MAP.md` `ops/UI_AUDIT.md`（FEATURE_INTENT は grounding 表に統合）
- [x] design ground 完了 → `ops/DESIGN_LANGUAGE.md`（状態色=p0_46で決定）`ops/DESIGN_GROUNDING_TABLE.md`
- [x] **`ops/P0_SCOPE.md` 人手承認**（第1波: FE-A0 / X-B0 / FE-C0）— 2026-06-13 承認
- [x] `ops/IMPLEMENTATION_PARTITION.md` 起草（3 partition に id/type/goal/owned/forbidden/verify）
- [x] 並列 partition 間で owned files の重複なし（衝突表で確認）
- [x] **base state クリーン**: 4コミット（incident-reports / RLS hardening / 製品misc / Ensemble harness）、typecheck+lint+6299 tests green
- [ ] lane worktree に node_modules（main から symlink か `pnpm install`）← **F3 起動時に実施**
- [x] Ensemble server health OK（`:23100` 隔離・稼働中）
- [x] `agents.json` に 5 program 登録・`ENSEMBLE_AGENTS_CONFIG` 設定・解決検証済（危険fallbackなし）

## 現在の base state

- branch: `main`
- 未コミット: 48 ファイル（incident-reports 新機能 + RLS force hardening）+ 新規ファイル数点
- **F3 前に解決が必要**（commit / stash）。F0/F1 recon は read-only のため影響なし。

## 履歴
- 2026-06-13: 初期化。Ensemble 採用、posture=worktree隔離自律、FE=Opus4.8 / BE=GPT-5.5。
