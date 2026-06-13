# SYSTEM_MAP — careviax 構造マップ

> F0/F1 recon pass 1。**backend は Ensemble recon(codex-backend-review-gpt55, read-only)が調査 → 本セッションで一次裏取り済み**。
> UI/design セクションは未完（read-only claude は team-say 不能でハング、下記「recon の学び」参照）。
> 凡例: ✅=本セッションで検証済 / 🔶=codex 報告(未裏取り) / ⬜=未調査

## 調査方法
- workingDirectory = careviax main tree（未コミット 48 ファイル差分を含む現状）。
- codex は read-only sandbox を遵守（ファイル編集ゼロを確認）。

## Backend

### 認可（authorization）🔶→一部✅
- 標準ラッパ: `withAuthContext` / `requireAuthContext`（+ `requireApiKeyOrAuthContext`）。API route handler に広く採用。
- ロール権限: `src/lib/auth/permissions.ts` の `canDispense` / `canAuditDispense` / `canVisit` / `canReport` / `canManageBilling` / `canAdmin`（9 工程ベース）。
- 🔶 API route handler は **約 307**。未採用候補には公開系(auth/external-access/health)と wrapper 別名化(admin/facilities 系)が混在 → 「真に未認証」かは要差分精査。

### テナント分離 / RLS ✅(構造確認)
- `prisma/rls-policies.sql` が org-scoped tables に `ENABLE ROW LEVEL SECURITY` / `FORCE ROW LEVEL SECURITY` を広く適用。新しめの表は `public.app_enforced_org_id()` を使用。
- `src/lib/db/rls.ts` `withOrgContext`: transaction-local config に `app.current_org_id` + request metadata を設定し、request org mismatch を throw（アプリ層フィルタとの二重防御 / defense-in-depth）。
- 未コミット差分に `prisma/migrations/20260613093000_force_rls_on_recent_org_tables/` あり（recent org tables への FORCE RLS 追加＝この hardening の進行中作業）。

### Prisma スキーマ ✅
- **分割構成**: `prisma/schema/*.prisma`（`schema.prisma` 単一ではない）。
- ファイル: `_config` `_stubs` `admin` `communication` `drug` `medication` `organization` `patient` `pca-pump` `prescription` `visit`。

### 代表フロー（codex が読了）🔶
処方取込 / 調剤監査 / 訪問記録 / dashboard cockpit / patients board / reports workspace / handoff / billing candidates。
- 🔶 暫定: 高リスク mutation は zod validation + org reference validation + `withOrgContext`(RLS tx) + role permission + `AuditLog` が**概ね揃っている**。

### 具体的 gap（pass 1）🔶
- **訪問記録後の handoff extraction が fire-and-forget**: `void ...catch(console.warn)` で失敗がレスポンスに反映されない。
  - 関連: `docs/async-fire-and-forget-audit.md` が実在（既知/追跡対象の可能性）。→ P0 候補検討時に突合。

## プロジェクト衛生上の発見 ✅
- **CLAUDE.md 参照の 3 docs が checkout に存在しない**:
  - `docs/ph-os_pharmacy_workflow_spec_project_context.md` — MISSING
  - `docs/ph-os_pharmacy_multidisciplinary_collaboration_spec_project_context.md` — MISSING
  - `docs/decisions.md` — MISSING
  - 実在は `docs/ui-ux-design-guidelines.md` ほか（design-gap-analysis(.md/.json)、refactor-proposals、phase5-*、ssot-*、repository-audit-2026-06-10 等）。
  - → CLAUDE.md の仕様リンクが drift。ground/partition では**実在 docs**（design-gap-analysis 等）を一次資料にする。

## UI / design ⬜（未完）
- read-only recon では未取得。`docs/ui-ux-design-guidelines.md` + `docs/design-gap-analysis*.md` を基点に別途実施が必要。

## recon の学び（重要）
**read-only lane は Ensemble の team-say を使えない**:
- codex read-only sandbox: `team-say.sh` が `/tmp/ensemble/<id>/messages.jsonl` への書込みで `Operation not permitted`。
- claude plan モード: bash 承認プロンプトで停止（Ensemble 自動応答の対象外）。
→ 協調 bus を使う recon は **disposable worktree + 書込可エージェント**(codex `-s workspace-write` / claude `bypassPermissions`)で行う（main tree は worktree 隔離で保護）。または read-only のまま **solo harvest**（bus 不使用・pane から所見回収・本セッションで合成）。Ensemble の bus の真価は F3 実装（書込可・worktree）で出る。
