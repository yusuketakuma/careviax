# PHI 閲覧監査（共通層設計）

対象: 患者単位の PHI（要配慮個人情報）を返す読取 API に対する閲覧アクセス記録。
根拠: 3省2ガイドライン（MHLW v6.0 / METI・MIC v1.1）のアクセス記録要件、APPI（要配慮個人情報の取扱い）。

## 1. 背景と課題

これまで PHI に対するアクセス記録（閲覧）は、外部共有（`external-access`）とデータ書き出し
（`export` / `recordDataExportAudit`）など一部の経路でのみ個別実装されていた。通常の患者 PHI
読取 route（`GET /api/patients/[id]` 系）には閲覧監査が無く、「誰が・いつ・どの患者の PHI を
画面表示したか」を後から追跡できない欠落があった。書込み系は `AuditLog` に記録されるが、
読取（閲覧）は記録対象外だった。

本設計は、PHI 読取 route が共通ヘルパー 1 本で閲覧監査を記録できる薄い共通層を定義し、
代表 route へ段階適用する。**新テーブル / migration は作らず、既存 `AuditLog` を再利用する。**

## 2. 監査対象の定義

「監査対象」= **患者単位の PHI 本文を返す GET route**。具体的には以下を満たすもの:

- 認証済みユーザーが `patientId`（または患者に紐づくケース）を指定して PHI を取得する GET。
- レスポンスに患者本文（属性・住所・保険・服薬・訪問記録・タイムライン等）を含む。

対象外:

- 既に固有の監査を持つ経路（`export` は `recordDataExportAudit`、PDF/印刷は
  `recordDataExportAudit` / `recordCareReportPrintAudit`、外部共有は
  `external_access_*`）。**二重記録を避けるため PHI 閲覧監査は配線しない。**
- 集計/一覧のみで個票 PHI 本文を返さない route（件数・ステータスサマリ等）は、初期バッチでは
  対象外とし、必要に応じて段階拡大で判断する。
- 非 PHI のマスタ/設定 route。

## 3. 記録内容（PHI 本文は記録しない）

`AuditLog` の既存カラムに以下を格納する:

| AuditLog カラム     | 値                                         |
| ------------------- | ------------------------------------------ |
| `action`            | `phi_read`（定数 `PHI_READ_AUDIT_ACTION`） |
| `org_id`            | actor の組織 ID                            |
| `actor_id`          | 閲覧したユーザー ID                        |
| `actor_pharmacy_id` | actor の薬局 ID（無ければ `org_id`）       |
| `actor_site_id`     | actor の拠点 ID（任意）                    |
| `patient_id`        | 閲覧対象の患者 ID                          |
| `target_type`       | 既定 `patient`（route により上書き可）     |
| `target_id`         | 既定 `patient_id`                          |
| `changes`           | `{ view, purpose?, metadata? }` のメタのみ |
| `ip_address`        | リクエスト元 IP（AuthContext 由来）        |
| `user_agent`        | User-Agent（AuthContext 由来）             |

`changes` に入れるのは **PHI 本文ではなくアクセスのメタ情報のみ**:

- `view`: どの画面/エンドポイント経由の閲覧か（例 `patient_detail` / `patient_overview` /
  `patient_header_summary` / `patient_timeline`）。route が SSOT で命名する。
- `purpose`（任意）: アクセス目的（例 `care` / `billing`）。閲覧目的を残せる場合に付与。
- `metadata`（任意）: 件数・フラグ等の **非 PHI** の補助情報のみ。

**禁止**: 氏名・住所・保険番号・電話・臨床記載・レセプト内容など PHI 本文を `changes` に
入れてはならない。`logger.warn` に載せるのも識別 ID（不透明 cuid）と org/actor までに留める。

## 4. 書込み先と RLS（既存 AuditLog を org コンテキスト内で書く）

- 書込み先は既存 `AuditLog`。新テーブル・新 migration は作らない。
- `AuditLog` は **FORCE ROW LEVEL SECURITY**（`WITH CHECK (org_id =
current_setting('app.current_org_id', true))`）。そのため INSERT は必ず org セッション変数を
  張った短いトランザクション内で行う必要がある。これは mutation route が
  `withOrgContext(orgId, (tx) => createAuditLogEntry(tx, ...))` として監査を書くのと同じ規約。
- 実装は `withOrgContext` 内で 1 件 INSERT する。ロール権限（BYPASSRLS の有無）に依存せず
  常に WITH CHECK を満たすため、role-agnostic に正しく書ける。

## 5. 性能配慮（ベストエフォート非同期・失敗時もレスポンスを返す）

- 呼び出し側は **fire-and-forget**（`void recordPhiReadAuditForRequest(...)`、await しない）。
  監査 INSERT のレイテンシを PHI 読取レスポンスに載せない。
- ヘルパーは失敗を握り潰す:
  - `recordPhiReadAudit`（純関数）: INSERT 失敗を try/catch し throw しない。失敗時は
    `logger.warn({ event: 'phi_read_audit_write_failed', ... })`。
  - `recordPhiReadAuditForRequest`（リクエストラッパ）: `withOrgContext` の確立失敗も
    `.catch` で受け、`logger.warn({ event: 'phi_read_audit_context_failed', ... })`。
- したがって監査が失敗しても **PHI 読取は 200 を返す**（可用性 > 監査完全性、ベストエフォート）。
- トレードオフ: fire-and-forget かつ独立トランザクションのため、稀に監査行が欠落しうる
  （プロセス早期終了・DB 一時障害）。3省2GL のアクセス記録はベストエフォート運用を許容する
  前提とし、恒久的な確実性が要求される場合は将来的にキュー化（例: `IntegrationJob`）へ
  格上げする余地を残す。

## 6. 共通ヘルパー API

`src/lib/audit/phi-read-audit.ts`:

- `PHI_READ_AUDIT_ACTION = 'phi_read'` — action 定数。
- `recordPhiReadAudit(db, actor, input): Promise<void>` — 純関数。任意の `auditLog.create` を
  持つクライアント（tx）を受け取り 1 件 INSERT。失敗は warn のみ。単体テスト可能（prisma 非依存）。
- `recordPhiReadAuditForRequest(ctx, input): void` — route 用。AuthContext から actor と
  requestContext を組み立て、`withOrgContext` 内で `recordPhiReadAudit` を fire-and-forget 実行。

`input`: `{ patientId, view, targetType?, targetId?, purpose?, metadata? }`。

## 7. 段階適用計画

- **第一バッチ（本 PR）**: 代表的な患者 PHI 読取 4 route に配線。
  - `GET /api/patients/[id]`（`view: patient_detail`）
  - `GET /api/patients/[id]/overview`（`view: patient_overview`）
  - `GET /api/patients/[id]/header-summary`（`view: patient_header_summary`）
  - `GET /api/patients/[id]/timeline`（`view: patient_timeline`）
- **第二バッチ（今後）**: `visits` / `prescriptions` / `medications` / `labs` /
  `communications` / `documents` など残りの患者 PHI 読取 GET へ拡大。各 route で
  一意の `view` を付与する。
- **対象外の再確認**: `export` / PDF / 印刷 / 外部共有は既存監査を維持し二重配線しない。
- **拡大時の指針**: 個票 PHI 本文を返す GET は原則配線。集計のみの route は個票 PHI を
  返すようになった時点で配線を検討。auth 境界・RLS ポリシー・migration は変更しない。

## 8. 非目標

- 既存 `export` / 印刷 / 外部共有監査の置換や統合はしない（別 action 体系を維持）。
- 監査の可視化 UI（`/admin/audit-logs`）の変更はしない（`phi_read` は既存一覧にそのまま載る）。
- RLS ポリシー・auth 権限モデル・DB スキーマの変更はしない。
