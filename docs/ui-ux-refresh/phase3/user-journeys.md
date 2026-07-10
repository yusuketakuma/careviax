# Phase 3: 実在ユーザージャーニー台帳（検証済み）

作成日: 2026-07-11 / 検証方法: `src/app` 画面構造・API route・ユニットテスト・`tools/tests/` E2E spec・`docs/visit-report-collab-spec.md` の突合。
凡例: 実在根拠 = 画面/API/テストの file path（リポジトリルート相対）。E2E = `tools/tests/` の Playwright spec。不明点は「未確認」と明記。

---

## J-01 サインイン → Cognito チャレンジ → MFA → 初期画面

- **実在根拠**:
  - 画面: `src/app/(auth)/login/page.tsx`, `src/app/(auth)/mfa/page.tsx`, `src/app/(auth)/mfa/setup/page.tsx`, `src/app/(auth)/first-login/page.tsx`, `src/app/(auth)/lockout/page.tsx`
  - API/ロジック: `src/app/api/auth/[...nextauth]/`, `src/app/api/auth/mfa/`, `src/lib/auth/cognito-challenge.ts`, `src/lib/auth/config.ts`
  - 初期画面: `src/app/page.tsx`（`redirect('/dashboard')`）→ `src/app/(dashboard)/layout.tsx`（`auth()` セッション検証 + `resolveLocalUserByIdentity` で org 解決）
- **経由画面**: `/login` → (チャレンジ種別により `/first-login` or `/mfa?callbackUrl=...`) → `/dashboard`
- **高リスクポイント**: Cognito チャレンジを `sessionStorage`（`COGNITO_CHALLENGE_STORAGE_KEY`, login/page.tsx:93）に保存して MFA 画面へ渡す。タブ跨ぎ・リロードでチャレンジ喪失時の回復導線が必要（E2E に「session recovery action」検証あり）。
- **状態遷移上の弱点候補**: challenge 有効期限切れ後の MFA 送信失敗時の遷移。lockout からの復帰経路はページ提示のみ。
- **E2E**: あり — `tools/tests/e2e-auth-flow.spec.ts`（login/MFA/MFA setup/lockout/first-login/password reset/change の各 describe）。

## J-02 セッション失効 → unauthorized → 再ログイン(callbackUrl) → 復帰

- **実在根拠**:
  - `src/app/(dashboard)/layout.tsx:12-15`（セッション無効時 `unauthorized()`）、`src/app/unauthorized.tsx`（「ログイン画面へ」/login リンク）、`src/app/forbidden.tsx`（org 未解決時）
  - callbackUrl 復帰: `src/app/(auth)/login/page.tsx:97`（`/mfa?callbackUrl=...`）、`src/app/(auth)/mfa/page.tsx:15,119`（`useSafeCallbackUrl`）
- **経由画面**: 任意の保護画面 → unauthorized 画面 → `/login` → (MFA) → callbackUrl 先へ復帰
- **高リスクポイント**: サーバーレンダリング時のみ検知される。CSR 継続中（fetch 層）の失効ハンドリングは `src/lib/api/client-json.ts` に 401 分岐が存在しない（grep で 401/unauthorized/login ヒットなし）。
- **状態遷移上の弱点候補**: 画面滞在中のセッション失効は API エラー/false-empty として現れる可能性（既知パターン: `careviax-fe-false-empty-fail-close` メモリ）。入力中データの退避は SOAP/処方ドラフト（J-10）以外は未確認。
- **E2E**: 部分 — `tools/tests/e2e-auth-flow.spec.ts:53`（authenticated session が保護 dashboard に到達）。失効→復帰の直接シナリオは未確認。

## J-03 患者検索 → 選択 → 詳細確認

- **実在根拠**:
  - 画面: `src/app/(dashboard)/patients/page.tsx`（患者ボード）、`src/app/(dashboard)/patients/[id]/page.tsx` + `src/app/(dashboard)/patients/[id]/card-workspace.tsx`、横断検索 `src/app/(dashboard)/search/page.tsx`
  - API: `src/app/api/patients/` 一式
- **経由画面**: `/patients`（検索/カテゴリ/スコープのフィルタ）→ `/patients/[id]`（カードワークスペース）
- **高リスクポイント**: 同姓同名患者の取り違え（患者識別は `PatientHeader` が SSOT — メモリ `careviax-patientheader-reuse`）。
- **状態遷移上の弱点候補**: 検索→詳細→戻る時のフィルタ状態保持は未確認。
- **E2E**: あり — `tools/tests/ui-patient-flow.spec.ts`（一覧ロード/名前検索/詳細遷移/編集保存/新規作成バリデーション）。

## J-04 一覧 → フィルタ/保存ビュー → 詳細（横断パターン）

- **実在根拠**:
  - タスクボード: `src/app/(dashboard)/tasks/page.tsx` + E2E `tools/tests/tasks-health-board-filters.spec.ts`
  - 保存ビュー: `src/app/(dashboard)/views/page.tsx`, `src/app/api/saved-views/`
  - 監査ログレビュー: `src/app/(dashboard)/admin/audit-logs/page.tsx` + E2E `tools/tests/ui-audit-logs-review.spec.ts`
- **経由画面**: 各一覧 → フィルタ適用 → 行/カード選択 → 詳細
- **高リスクポイント**: フィルタ既定値の生 enum 漏洩（既知バグパターン: メモリ `careviax-radix-selectvalue-ssr-enum-leak`）。
- **状態遷移上の弱点候補**: フィルタ結果 0 件と fetch エラーの区別（false-empty fail-close パターン）。
- **E2E**: あり — 上記 2 spec + `tools/tests/ui-data-explorer.spec.ts`。

## J-05 処方受付（QR / 手入力）→ 調剤 → 監査 →（セット → セット監査 → 交付連携）

- **実在根拠**:
  - QR: `src/app/(dashboard)/qr-scan/page.tsx`, `src/app/(dashboard)/prescriptions/qr-drafts/page.tsx`, `src/app/(dashboard)/prescriptions/qr-drafts/[id]/page.tsx`, `src/app/api/qr-scan-drafts/route.ts`, `src/app/api/qr-scan-drafts/[id]/route.ts`
  - 手入力受付: `src/app/(dashboard)/prescriptions/new/prescription-intake-form.tsx`, `src/app/(dashboard)/prescriptions/intake/page.tsx`
  - 4工程ワークベンチ: `src/app/(dashboard)/dispense/page.tsx`, `src/app/(dashboard)/audit/page.tsx`, `src/app/(dashboard)/set/page.tsx`, `src/app/(dashboard)/set-audit/page.tsx`（レセコン風置換 — メモリ `chouzai-workbench-replacement`）
  - API: `src/app/api/dispense-tasks/`, `src/app/api/dispense-results/route.ts`, `src/app/api/dispense-audits/route.ts`, `src/app/api/set-plans/`, `src/app/api/set-batches/`
- **経由画面**: `/qr-scan` or `/prescriptions/new` → `/prescriptions` → `/dispense` → `/audit` → `/set` → `/set-audit`（最終承認で監査・セル・サイクル・visit carry items を永続化）
- **高リスクポイント**: ツーパーソンルール（調剤者=監査者は admin 承認 + 理由必須の限定例外、`dispense-audits/route.ts:266-267`）。監査 NG は `reject_reason_code` 必須（route.ts:237-239）。
- **状態遷移上の弱点候補**: set-audit 最終承認の API conflict（409）時に画面残留する設計は E2E で保証済みだが、二重送信の防御は idempotency-key（`src/lib/api/idempotency-key.ts`）依存。
- **E2E**: あり（最厚） — `tools/tests/e2e-prescription-dispensing-flow.spec.ts`（QR scan→draft、intake、dispense→audit round trip、set-audit 最終承認の永続化・conflict 残留・NG 分類必須）、`tools/tests/ui-workflow-flow.spec.ts`（フェーズ間ナビ）。
- **注**: 「交付」の独立画面は未確認。set-audit 最終承認で visit carry items へ連携する形が実装上の終端。

## J-06 前回処方との差分確認（差分レビュー）

- **実在根拠**: `src/app/(dashboard)/patients/[id]/prescriptions/prescription-history-content.tsx:1298`（p0_11 差分レビュービュー、「今回/前回」比較列・「前回から中止」表示）、`src/lib/prescription/medication-diff.ts`, `src/lib/prescriptions/diff-review-contract.ts`
- **経由画面**: `/patients/[id]/prescriptions`（履歴 + 差分レビュー）
- **高リスクポイント**: medication identity key の変更は全 caller 広域テスト必須（メモリ `feedback-review-scope-shared-key-functions`）。新規=情報/中止=注意/変更=要確認の色分け誤りは臨床判断を誤誘導。
- **状態遷移上の弱点候補**: 前回処方が存在しない初回患者での表示、QR draft 由来と手入力由来の混在比較。
- **E2E**: 未確認（ユニットテスト `prescription-history-content.test.tsx` はあり）。

## J-07 臨床アラート確認 → 対応 → 理由記録（CDS）

- **実在根拠**:
  - CDS API: `src/app/api/cds/check/route.ts`, `src/server/cds/checker`（`checkDispenseAlerts`）
  - 確認画面: `src/app/(dashboard)/patients/[id]/safety-check/safety-check-content.tsx`, `src/app/(dashboard)/visits/[id]/record/visit-record-form.tsx`（CDS 呼出）
  - 対応の強制: `src/app/api/dispense-results/route.ts:85`（`cds_alerts_reviewed` を literal で必須 ack）、同 :716（CDS 不通時は `cds_check_unavailable` で fail-close）、同 :851（`dispense_safety_checklist_acknowledged` を監査ログ記録、severity 別カウント付き）
  - 理由記録: `src/app/api/dispense-audits/route.ts:237-239`（`reject_reason` / `reject_reason_code` / `reject_detail`）
  - ルール管理: `src/app/(dashboard)/admin/alert-rules/page.tsx`, `src/app/api/drug-alert-rules/`
- **経由画面**: `/patients/[id]/safety-check` or `/dispense`（チェックリスト ack）→ `/audit`（NG 時は分類必須）
- **高リスクポイント**: アレルギー照合は YJ 先頭7桁 prefix + name-includes 併用が正（メモリ `careviax-cds-allergy-yj-ingredient-prefix`）。false-negative の害が最大の箇所。
- **状態遷移上の弱点候補**: ack 後に処方内容が変わった場合の ack 再取得（stale acknowledge）は未確認。
- **E2E**: 部分 — `tools/tests/e2e-prescription-dispensing-flow.spec.ts:1173`（set-audit NG 拒否に NG 分類必須）。safety-check 画面自体の E2E は未確認（ユニットテストはあり）。

## J-08 訪問報告書: 下書き → 薬剤師確認(confirmed) → 確定(finalize) → 送付

- **実在根拠**:
  - 画面: `src/app/(dashboard)/reports/page.tsx`, `src/app/(dashboard)/reports/[id]/page.tsx`, `src/app/(dashboard)/reports/[id]/print/page.tsx`
  - 生成: `src/app/api/care-reports/generate-from-visit/route.ts`（`canAuthorReport` で薬剤師限定 — 仕様 REP-008, `docs/visit-report-collab-spec.md`）
  - 状態遷移: `src/app/api/care-reports/[id]/route.ts:341-369`（p1_04: draft→confirmed のみ許可、confirmed→draft 差戻し禁止、監査ログ `changes: {from:'draft',to:'confirmed'}`）
  - 確定: `src/app/api/care-reports/[id]/finalize/route.ts`（`finalized_by`/`finalized_at` + 薬剤師免許 credential 束縛 :149-153、`already_finalized`/`locked_at`/`voided_at` ガード :96-97）。役割制限 `src/lib/auth/care-report-confirmation.ts`（owner/admin/pharmacist のみ）
  - 送付: `src/app/api/care-reports/[id]/send/route.ts`（email/fax/phone チャネル、`sendCareReportEmail`）、PDF `src/app/api/care-reports/[id]/pdf/`, 印刷監査 `src/app/api/care-reports/[id]/print-audit/`
- **経由画面**: `/visits/[id]/record`（訪問記録）→ `/reports`（下書き一覧）→ `/reports/[id]`（オーサリング・確認・確定・送付）
- **高リスクポイント**: 確定者の免許束縛（credential snapshot 保存）。事務職(clerk)の作成/確認遮断。送付先誤り（宛先マスキング `maskRecipientContact`）。
- **状態遷移上の弱点候補**: `docs/visit-report-collab-spec.md` §3.5 が指摘する通り、到達証跡(delivery_proof)による hard gate は仕様段階。sent/confirmed/finalize の三状態の画面上の区別。
- **E2E**: あり — `tools/tests/ui-schedule-visit-report.spec.ts:926-993`（reports workspace、draft 行、詳細遷移、waiting/template policy）。finalize 自体の E2E は未確認（`finalize/route.test.ts` ユニットテストあり）。

## J-09 訪問準備 → 訪問記録（施設一括含む）→ 次患者へ

- **実在根拠**: `src/app/(dashboard)/visits/page.tsx`（準備ワークスペース）、`src/app/(dashboard)/visits/[id]/page.tsx`, `src/app/(dashboard)/visits/[id]/record/page.tsx`（visit-record-form）、`src/app/(dashboard)/visits/[id]/brief/page.tsx`, `src/app/api/visit-records/`, `src/app/api/visit-preparations/`
- **経由画面**: `/visits` → `/visits/[id]` → `/visits/[id]/record` →（施設グループでは保存後に次患者へ自動前進）
- **高リスクポイント**: 保存 payload の完全性（算定要件 capture、spec §1）。訪問中はオフライン前提（J-10 と連結）。
- **状態遷移上の弱点候補**: 施設一括で途中離脱した場合の未保存患者の扱い。
- **E2E**: あり — `tools/tests/ui-schedule-visit-report.spec.ts:712-924`（準備カード、施設/個人宅の記録ページ、保存 stub→次患者前進、offline guidance 表示）。

## J-10 オフライン編集 → ローカル保存 → 復帰 → 同期

- **実在根拠**:
  - 基盤: `src/lib/stores/offline-db.ts`（Dexie/IndexedDB, 暗号化）、`src/lib/stores/sync-engine.ts`、`src/lib/hooks/use-network-online.ts`
  - ドラフト: `src/lib/hooks/use-soap-draft.ts`, `src/lib/hooks/use-prescription-draft.ts`, `src/lib/offline/voice-memo-drafts.ts`, `src/lib/offline/evidence-drafts.ts`
  - 画面: `src/app/(dashboard)/offline-sync/page.tsx` + `offline-sync-content.tsx`（同期キュー一覧）、`src/app/offline/`（オフラインフォールバックページ, Serwist PWA）
- **経由画面**: `/visits/[id]/record`（オフライン編集・自動ローカル保存）→ 復帰 → `/offline-sync`（キュー確認・同期）
- **高リスクポイント**: PHI の IndexedDB 暗号化（`encryptOfflinePayloadRequired`, sync-engine.ts:379）。同期前のブラウザデータ消去 = データ喪失。
- **状態遷移上の弱点候補**: 同期失敗の無限リトライ/放置キューの可視化。オフライン中のセッション失効（J-02 と複合）。
- **E2E**: あり（route-mocked） — `tools/tests/ui-route-mocked-smoke.spec.ts`（offline 保存 smoke: 「offline save smoke should not POST visit records」:2215、暗号鍵 DB `ph-os-offline-keys` セットアップ :32-34）。実ネットワーク断の E2E は未確認。

## J-11 同期競合 → 差分確認 → 解決（サーバ優先 / ローカル優先）

- **実在根拠**:
  - 検知: `src/lib/stores/sync-engine.ts:373-379`（HTTP 409 → `conflict_state: 'server_conflict'`、conflict_payload を暗号化保存しキューに保持）
  - 解決 UI: `src/app/(dashboard)/offline-sync/offline-sync-content.tsx:9`（`ConflictDiffDialog`）、:192/:212（use_server / use_local の各 resolution mutation）、`src/components/ui/conflict-diff-dialog.tsx`
  - 型: `src/types/visit-record-conflict.ts`
- **経由画面**: `/offline-sync`（conflict view `data-testid="offline-sync-conflict-view"`）→ 差分ダイアログ → サーバ採用 or ローカル上書き
- **高リスクポイント**: ローカル上書きは他者の編集を破壊しうる（`localOverwriteDisabledReason` によるガードあり, offline-sync-content.tsx:368）。
- **状態遷移上の弱点候補**: 解決操作自体の失敗時（resolution_failed エラー報告あり）のリカバリ導線。
- **E2E**: 部分 — `tools/tests/ui-route-mocked-smoke.spec.ts`（`__phosSeedOfflineSyncDemo('conflict')` シード, offline-sync-content.tsx:132 のデモフック経由）。実 409 発生からの E2E は未確認。

## J-12 ファイル選択 → 検証 → presigned アップロード → 完了

- **実在根拠**:
  - API: `src/app/api/files/presigned-upload/route.ts`（MIME/サイズの zod 検証 :54-60、role 制御）→ S3 直 PUT → `src/app/api/files/complete/`、取得 `src/app/api/files/[id]/`
  - 呼出画面: `src/app/(dashboard)/visits/[id]/record/visit-record-form.tsx`, `src/app/(dashboard)/patients/[id]/consent/consent-records-content.tsx`, `src/app/(dashboard)/patients/[id]/residual-adjustment/residual-adjustment-content.tsx`, `src/app/(dashboard)/prescriptions/new/prescription-intake-form.tsx`
  - 前処理: `src/lib/files/downscale-image.ts`（画像縮小）
- **経由画面**: 各機能画面内のアップロード UI（独立アップロード画面は無し）
- **高リスクポイント**: presigned URL 発行後〜complete 前の中断で孤児オブジェクト。S3 Object Lock 対象文書の誤アップロード。
- **状態遷移上の弱点候補**: 失敗→再試行の明示 UI は未確認（呼出側コンポーネント毎に差がある可能性）。
- **E2E**: 未確認（`presigned-upload` の route ユニットテストはあり: `src/app/api/files/` 配下）。

## J-13 外部共有リンク発行 → 外部閲覧（/shared/[token]）→ 患者セルフレポート

- **実在根拠**:
  - 発行: `src/app/(dashboard)/patients/[id]/share/external-share-content.tsx:300`（`POST /api/external-access`）、`src/app/api/external-access/route.ts`（`expires_hours` 1〜720h :48、revoke 管理 :180-292、閲覧/発行ともマネジメント権限限定 :416-426）
  - 報告書共有: `src/app/(dashboard)/reports/[id]/share/interprofessional-share-content.tsx`
  - 外部閲覧: `src/app/shared/[token]/page.tsx` + `shared-viewer-content.tsx`（認証なしトークン閲覧）、セルフレポート `src/app/api/external-access/[token]/self-report/`
- **経由画面**: `/patients/[id]/share` or `/reports/[id]/share` → リンク共有 → 外部者が `/shared/[token]` → 閲覧 + セルフレポート送信
- **高リスクポイント**: トークン漏洩 = 認証なし PHI 閲覧。有効期限/失効(revoke)の確実な適用。
- **状態遷移上の弱点候補**: 失効済み/期限切れトークンでのアクセス時の表示、self-report 送信途中の期限切れ。
- **E2E**: あり（route-mocked） — `tools/tests/ui-route-mocked-smoke.spec.ts:20,811-852`（SHARED_TOKEN での閲覧 + self-report POST 201）。

## J-14 報告書メール送付 → 受信者がメール内リンクから /shared/ 到達

- **実在根拠**: `src/app/api/care-reports/[id]/send/route.ts`（email/ses チャネル、宛先マスキング、送達失敗ログ `care-report-send-observability`）→ `src/server/services/report-delivery.ts:22-35`（メールに載せる URL は https + 設定済み origin + パスが `/shared/{token}` の 2 セグメントのみ許可 = `isExternalShareableUrl`）
- **経由画面**: `/reports/[id]`（送付操作）→ 受信者メール → `/shared/[token]`
- **高リスクポイント**: URL allowlist 検証が origin 設定（NEXT_PUBLIC_APP_URL 等）に依存。誤設定時はリンクが載らない（fail-close）。
- **状態遷移上の弱点候補**: SES 送信成功 ≠ 到達（spec §KYO-007 が指摘する到達証跡 hard gate は未実装 = 仕様段階）。
- **E2E**: なし（`send/route.test.ts` ユニットテストはあり）。実メール到達の自動検証は未確認。

## J-15 非常時アクセス（break-glass、運営者のテナント横断）

- **実在根拠**: `src/app/platform/tenants/[orgId]/break-glass-panel.tsx`, `src/app/api/platform/break-glass/route.ts`（+ `route.test.ts`）、監査 `src/app/api/platform/tenants/[orgId]/audit/route.ts`、データ閲覧 `src/app/platform/tenants/[orgId]/data-explorer-panel.tsx`、セッション残時間 `src/app/platform/use-break-glass-sessions.ts` / `use-remaining-minutes-label.ts`
- **経由画面**: `/platform`（テナント一覧）→ `/platform/tenants/[orgId]`（break-glass 開始 → data explorer / audit log）
- **高リスクポイント**: 監査 fail-closed・RLS を target org に pin（BYPASSRLS 不使用 — メモリ `careviax-platform-break-glass-console`）。時間制限セッションの失効挙動。
- **状態遷移上の弱点候補**: セッション期限切れ瞬間の操作中断、複数テナント同時セッション。
- **E2E**: なし（`tools/tests/` に platform 対象 spec なし。ユニットテスト `break-glass-panel.test.tsx` / `break-glass/route.test.ts` はあり）。

## J-16 スケジュール → ルート提案 → 確認/適用（訪問計画）

- **実在根拠**: `src/app/(dashboard)/schedules/page.tsx`, `schedules/proposals/page.tsx`, `schedules/route-compare/page.tsx`, `schedules/conflicts/page.tsx`, `src/app/api/visit-schedules/`, `src/app/api/visit-schedule-proposals/`, `src/app/api/visit-routes/`
- **経由画面**: `/schedules`（チームボード）→ `/schedules/route-compare`（推奨ルート詳細 + 適用確認）or `/schedules/proposals`（提案確定/再提案）
- **高リスクポイント**: ルート適用の確認ダイアログ（破壊的操作）。車両/リソース制約。
- **状態遷移上の弱点候補**: 提案確定と個別スケジュール編集の競合。
- **E2E**: あり — `tools/tests/ui-schedule-visit-report.spec.ts:431-710`, `tools/tests/e2e-schedule-vehicle-resource-constraints.spec.ts`。

## J-17 閲覧専用ロール（事務 clerk の read-all + 作成遮断）

- **実在根拠**: `src/lib/auth/permissions.ts` + `src/lib/auth/permission-matrix.ts`（役割別権限）、`src/lib/auth/care-report-confirmation.ts`（臨床確認は owner/admin/pharmacist のみ）、`docs/visit-report-collab-spec.md` REP-008（generate-from-visit の `canAuthorReport` ガード）。事務向け画面 `src/app/(dashboard)/clerk-support/page.tsx`、連絡ハブ `src/app/(dashboard)/handoff/page.tsx`（薬剤師⇔事務 — メモリ `careviax-handoff-comms-hub`）
- **経由画面**: clerk ログイン → 全画面閲覧可（org-wide read-all は意図的仕様 — メモリ `careviax-access-model-orgwide`）、報告書作成/確認ボタンのみ遮断
- **高リスクポイント**: 遮断が UI 非表示だけでなく API 側でも強制されていること（generate-from-visit は API 側ガード確認済み）。
- **状態遷移上の弱点候補**: 権限不足操作時のエラー表示の一貫性。
- **E2E**: 未確認（権限はユニット/契約テスト中心: `src/app/api/__tests__/protected-post-routes.test.ts`）。

---

## 実在せず（または実装未確認 — 今回の調査では根拠を発見できず）

| 候補ジャーニー | 判定 | 根拠 |
| --- | --- | --- |
| 確定後修正 → 版管理（amend version chain, un-lock） | **実在せず（仕様段階）** | `docs/visit-report-collab-spec.md` §3.5 が「訂正/追記は新版 + un-lock 限定」を**計画**として記載。実装は finalize ロックまで（`src/app/api/care-reports/[id]/finalize/route.ts` に amend/unlock なし、PATCH は draft 以外の編集を拒否 `[id]/route.ts:353-369`）。`voided_at` ガードは存在するが void 発行 UI/API は未確認 |
| 代理入力 → 承認（事務が下書き、薬剤師が承認） | **実在せず** | clerk の報告書作成は `canAuthorReport` で遮断（作成自体をさせない設計 — メモリ `careviax-access-model-orgwide`）。「代理」の grep ヒットは billing-profile 等の別文脈のみ。近縁の実在フローは J-05 のツーパーソンルール（調剤者≠監査者）と J-17 の handoff 連絡ハブ |
| レート制限 → 待機 → 再試行（ユーザー体験としての UI フロー） | **実在せず（サーバ側のみ実在）** | 429 + Retry-After はサーバ実装済み（`src/lib/api/rate-limit.ts:1079-1094`）。しかし client fetch 層（`src/lib/api/client-json.ts`）に 429 待機/自動再試行の分岐は未確認 |
| セッション失効の CSR 中リアルタイム検知 → 再認証モーダル | **実在せず** | J-02 の通り、検知はサーバーレンダリング時の `unauthorized()` のみ。fetch 層 401 → ログイン誘導のクライアント実装は未確認 |
| ファイルアップロード失敗 → 明示的再試行 UI | **未確認** | アップロード API と呼出画面は実在（J-12）だが、失敗→再試行の専用 UI コンポーネントは今回の調査では特定できず |
| 「交付」独立工程の画面 | **実在せず（set-audit に統合）** | 4工程は dispense/audit/set/set-audit（メモリ `chouzai-workbench-replacement`）。交付独立画面は `src/app` に存在しない。set-audit 最終承認 → visit carry items 連携が終端（E2E `e2e-prescription-dispensing-flow.spec.ts:1307`） |

---

## E2E カバレッジ総括

- **厚い**: J-01(auth), J-03(患者), J-05(処方→調剤→監査→set-audit), J-09(訪問記録), J-16(スケジュール)
- **route-mocked のみ**: J-10/J-11(オフライン・競合), J-13(外部共有)
- **E2E なし（ユニットのみ）**: J-06(処方差分), J-08 finalize, J-12(アップロード), J-14(メール), J-15(break-glass), J-17(権限)
