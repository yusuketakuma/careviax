# Refactor Proposals

作成日: 2026-06-12

この文書は `refactor-instructions.md` Phase 7 の提案専用メモです。2026-06-12 の follow-up で、env 起動時検証、structured logger 基盤、DB schema 足場、旧 dashboard/home API と旧患者 classic UI の撤去は実装済みです。

## withAuth から withAuthContext への残り移行

- 状態: 実装済み。2026-06-12 follow-up で `/api/business-holidays`、`/api/pharmacist-shifts*`、`/api/dashboard/{overdue,monthly-stats,workflow,medication-deadlines,dispensing-stats}`、`/api/pharmacists*`、`/api/visit-vehicle-resources`、`/api/packaging-methods*`、`/api/notifications`、`/api/pca-pumps*`、`/api/pca-pump-rentals*`、`/api/inquiry-records*`、`/api/communication-requests*`、`/api/communication-events`、`/api/tracing-reports*`、`/api/dispense-audits`、`/api/dispense-results*`、`/api/set-audits`、`/api/set-plans`、`/api/visit-schedule-proposals*`、`/api/pharmacy-sites*`、`/api/visit-schedules*`、`/api/visit-routes*`、`/api/admin/pharmacist-credentials`、`/api/consent-records`、`/api/billing-candidates*`、`/api/care-reports*`、`/api/audit-logs*`、`/api/dispense-queue`、`/api/cds/check`、`/api/external-professionals/suggestions`、`/api/admin/{pilot-org-audit,pilot-readiness,master-readiness,metrics,performance-metrics,staff-metrics,reject-reason-stats,facility-standards,pilot-launch-dossier,uat-feedback,webhooks,escalation-rules,external-professionals,facilities,flush-metrics}`、`/api/contact-profiles`、`/api/prescriber-institutions*`、`/api/patients*`、`/api/me/org`、`/api/cases`、`/api/medication-profiles`、`/api/residual-medications`、`/api/qr-scan-drafts*`、`/api/first-visit-documents`、`/api/interventions`、`/api/medication-issues`、`/api/conference-notes*`、`/api/facility-visit-batches*`、`/api/dispense-tasks*`、`/api/prescription-intakes*`、`/api/visit-records` は `withAuthContext` または explicit `requireAuthContext` へ移行済み。`rg "withAuth\\(" src/app/api -g route.ts` は 0 件。
- 動機: 新規 API の標準を `withAuthContext` に寄せ、`AuthenticatedRequest` 注入型と `ctx` 引数型の二重運用を減らす。
- 影響範囲: `src/app/api` の `withAuth` 利用 route。permission キー、org scope、rate-limit、監査ログに影響しうる。
- 移行手順案: route ごとに既存テストがある単位で移行し、`req.userId` / `req.orgId` / `req.role` 参照を `ctx` へ置換する。動的 params は Next Route Handler の `params: Promise<...>` 形を維持する。
- ロールバック: ファイル単位で旧 wrapper に戻す。DB migration や保存データ変更は不要。
- 必要な承認: API 実装方針の承認。公開レスポンスや権限条件を変えない前提。

## AuditLog ヘルパーの残り展開

- 状態: 実装済み。`/api/business-holidays` の create/update/delete、`/api/pharmacists*` の招待/更新/停止/一括取込、`/api/packaging-methods*`、`/api/pca-pumps*`、`/api/pca-pump-rentals*`、`/api/inquiry-records*`、`/api/communication-requests/[id]`、`/api/tracing-reports/[id]`、`/api/dispense-audits`、`/api/dispense-results`、`/api/pharmacy-drug-stocks*`、`/api/pharmacy-drug-stock-templates*`、`/api/pharmacy-drug-stock-requests*`、`/api/visit-schedule-proposals*`、`/api/pharmacy-sites*`、`/api/visit-schedules*`、`/api/visit-routes/reorder`、`/api/patient-self-reports*`、`/api/handoff-board/items`、`/api/visit-brief-feedback`、`/api/me/{logout-all,preferences}`、`/api/settings/operational-policy`、`/api/consent-records/[id]/revoke`、`/api/billing-candidates/[id]`、`/api/care-reports/[id]/send`、`/api/dispense-tasks/[id]/workbench`、`/api/admin/pharmacist-credentials` は `createAuditLogEntry` へ統一済み。`rg "auditLog\\.create" src/app/api -g route.ts` は 0 件。
- 動機: `tx.auditLog.create` の `org_id`、`actor_id`、`ip_address`、`user_agent` 付け漏れを防ぐ。
- 影響範囲: 書き込み系 API 全域。監査欠落は重大なので一括置換しない。
- 移行手順案: `withAuthContext` route から 3-5 ファイルずつ `createAuditLogEntry` へ移行し、既存 route tests で同一トランザクション内の監査書き込みを確認する。
- ロールバック: 対象 route の helper 呼び出しを既存の `tx.auditLog.create` に戻す。
- 必要な承認: 監査 action 命名の統一ルールを変更する場合のみ承認が必要。単純置換は通常レビューで進める。

## 旧 UI 層・旧ダッシュボード API の撤去条件

- 状態: 実装済み。`/api/dashboard/home/*`、`/api/dashboard/today`、旧 dashboard component、`#patients-classic` は撤去し、`/dashboard` と `/my-day` は `/api/dashboard/cockpit` と患者 board を使う構成へ移行済み。
- 動機: 新旧二層 UI と旧 BFF の二重保守を減らす。
- 影響範囲: `#patients-classic` などの旧 UI 温存セクション、`/api/dashboard/home/*`、`/api/dashboard/today`、旧 UI を検証する E2E。
- 移行手順案: 画面ごとに旧 UI 固有操作の新 UI 移植、該当 E2E の新 UI 置換、本番安定 2 週間を満たしてから撤去する。
- ロールバック: 旧 UI コンポーネントと旧 API route を同一 PR 内で戻す。DB migration は不要。
- 必要な承認: プロダクト判断が必要。現時点では撤去しない。

## FileAsset モデル化

- 動機: `Setting(scope='organization', key='file_asset:<id>')` の JSON 保存は一覧、検索、JOIN、RLS の設計が弱い。
- 影響範囲: `src/server/services/file-storage.ts`、ファイルアップロード/ダウンロード API、既存 Setting 行。
- 移行手順案: `FileAsset` モデルと RLS を追加し、file-storage を二重書き込みにする。backfill 後に読み取りを FileAsset 優先へ切り替え、安定後に旧 Setting キーを整理する。
- ロールバック: 読み取りを Setting 優先へ戻し、二重書き込みを継続する。backfill 済みデータは保持可能。
- 必要な承認: DB schema/migration と backfill 実行承認。

## WorkflowException.patient_id / DrugAlertRule.org_id / RX 採番列

- 動機: 患者別例外 projection の JOIN 深さ、薬剤アラートのテナント別調整不可、RX 番号の業務番号昇格条件を整理する。
- 影響範囲: Prisma schema、RLS、backfill、例外作成 7 箇所、CDS/admin API、RX 番号表示箇所。
- 移行手順案: `WorkflowException.patient_id` は nullable 追加、作成箇所で patient id を保存、cycle->case->patient で backfill。`DrugAlertRule.org_id` は global/org override 仕様を先に決める。RX 採番は印刷物・外部共有・連携キー化が要件化したら org/year scoped counter を設計する。
- ロールバック: nullable 追加段階なら読み取りを旧 JOIN に戻す。採番列は外部公開前なら表示合成へ戻す。
- 必要な承認: DB schema/migration、backfill、業務番号要件の承認。

## 巨大 UI / Service の分割

- 動機: `drug-master-content`、`schedule-proposals-content`、`prescription-intake-form`、`daily.ts`、`billing-evidence/core` は変更影響が読みづらい。
- 影響範囲: UI hook 順、server job transaction、billing evidence projection、E2E 撮影。
- 移行手順案: JSX や hook の分割前に、純関数・定数・型を helper へ移し、characterization tests を増やす。UI 分割は 1 PR 1 セクション、server 分割は public function を維持して内部 module を切る。
- ロールバック: helper extraction は import を戻す。UI 分割はコンポーネント単位で旧ファイルへ戻す。
- 必要な承認: 画面構成や表示文言が変わる場合。純関数抽出のみなら通常レビューで進める。

## Env 起動時検証の組み込み

- 動機: 本番で `ALLOW_LOCAL_*` が有効化されたり、必須 env 欠落が深い runtime error になるのを防ぐ。
- 影響範囲: Next startup、instrumentation、CI/CD env、preview 環境。
- 移行手順案: まず preview/staging で `assertProductionEnvSafety` を warn-only で呼び出し、env 不備を洗い出す。本番はメンテ枠で fail-fast へ切り替える。
- ロールバック: instrumentation の呼び出しを外す、または warn-only に戻す。
- 必要な承認: 本番起動を止めうる変更の承認。

## Fire-and-forget の個別修正

- 動機: 意図的な非同期切り離しと失敗見落としをコード上で区別する。
- 影響範囲: `docs/async-fire-and-forget-audit.md` の要修正候補、通知、bulk export、UI event handler。
- 移行手順案: UI の best-effort fetch には `// intentional:` コメントを追加する。HTTP response 後に失敗しうる queue drain は job log または operational task で検知できる形にする。
- ロールバック: コメント追加は不要。挙動を変えた箇所は対象 handler 単位で戻す。
- 必要な承認: UI ブロッキングや通知再試行など挙動差が出る場合。

## 構造化 logger 基盤

- 動機: console 直書きでは PHI を渡さないルールがレビュー依存になる。
- 影響範囲: API/server の error/warn、job runner、external adapter、observability。
- 移行手順案: `logger.error({ event, orgId, entityId, code })` のような allowlist 型の logger を設計し、患者名・住所・自由記述を型上受け取らない。既存 console は高リスク境界から段階移行する。
- ロールバック: logger wrapper を console へ委譲する互換実装に戻す。
- 必要な承認: 運用ログ基盤と保存先、保持期間、PHI redaction 方針の承認。

## Completed In This Refactor

- Q2: `process-tab.tsx` は旧 8 工程配列を削除し、`ProcessChips` + `PROCESS_STEPS_9` の 9 工程表示へ統一済み。
- Q3: 現役の cycle status 表示は `CYCLE_STATUS_LABELS` / `CYCLE_STATUS_SHORT_LABELS` 参照へ寄せた。
- Q7: `CLAUDE.md` の Language 節は「識別子は英語、コメント・ドキュメントは日本語可」へ更新済み。
