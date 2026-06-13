# CHECKPOINT — 実装可否ゲート（正本）

> このファイルが実装の唯一のゲート。`/implement-ensemble` は preflight でここを読み、
> "Implementation Allowed? Yes" 以外なら STOP する。手動でのみ Yes にする。

## Implementation Allowed? **No**（残り2点で Yes 可）

理由: partition は起草済だが、**(1) P0_SCOPE の人手承認** と **(2) base state クリーン化** が未了。

## ゲート前提

- [x] F0/F1 recon 完了 → `ops/SYSTEM_MAP.md` `ops/UI_AUDIT.md`（FEATURE_INTENT は grounding 表に統合）
- [x] design ground 完了 → `ops/DESIGN_LANGUAGE.md`（状態色=p0_46で決定）`ops/DESIGN_GROUNDING_TABLE.md`
- [ ] **`ops/P0_SCOPE.md` 人手承認**（第1波: FE-A0 / X-B0 / FE-C0）← **要あなたの承認**
- [x] `ops/IMPLEMENTATION_PARTITION.md` 起草（3 partition に id/type/goal/owned/forbidden/verify）
- [x] 並列 partition 間で owned files の重複なし（衝突表で確認）
- [ ] **base state クリーン**: 未コミット48ファイルを commit/stash（特に X-B0 が触る `app-header.tsx`/`sidebar.tsx`）← **要対応**
- [ ] lane worktree に node_modules（main から symlink か `pnpm install`）← F3 起動時
- [x] Ensemble server health OK（`:23100` 隔離・稼働中）
- [x] `agents.json` に 5 program 登録・`ENSEMBLE_AGENTS_CONFIG` 設定・解決検証済（危険fallbackなし）

## 現在の base state

- branch: `main`
- 未コミット: 48 ファイル（incident-reports 新機能 + RLS force hardening）+ 新規ファイル数点
- **F3 前に解決が必要**（commit / stash）。F0/F1 recon は read-only のため影響なし。

## 履歴
- 2026-06-13: 初期化。Ensemble 採用、posture=worktree隔離自律、FE=Opus4.8 / BE=GPT-5.5。
