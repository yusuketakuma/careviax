# CareViaX API バージョニングポリシー

## 方針

URL プレフィックス方式 `/api/v1/` を採用する。

## バージョニング戦略

### URL プレフィックス方式

```
/api/v1/patients
/api/v1/patients/{id}
/api/v1/prescriptions
...
```

- **採用理由**: ブラウザキャッシュ・CDN・ロードバランサとの親和性が高い。クライアントのルーティングが単純。OpenAPI スペックとの対応が明確。
- **非採用**: ヘッダー方式（`Accept: application/vnd.careviax.v1+json`）はクライアント実装コストが高いため見送り。

### 現フェーズの扱い

- 既存エンドポイントは `/api/` 直下に存在し、これを **v1 相当** とみなす。
- 現時点でリダイレクトは不要（内部システム・単一クライアント構成）。
- 破壊的変更が発生した時点で `/api/v2/` を新設し、旧エンドポイントに非推奨マーカーを付ける。

## バージョンライフサイクル

| フェーズ | 説明 |
|---|---|
| **Current** | 最新版。積極的に開発・維持する |
| **Deprecated** | 後継バージョンが存在する。最低 6ヶ月の移行猶予を設ける |
| **Sunset** | 廃止済み。`410 Gone` を返す |

## 既存エンドポイント一覧（v1 相当）

### 患者管理

| メソッド | パス | 説明 |
|---|---|---|
| `GET` | `/api/patients` | 患者一覧 |
| `POST` | `/api/patients` | 患者登録 |
| `GET` | `/api/patients/{id}` | 患者詳細 |
| `PATCH` | `/api/patients/{id}` | 患者更新 |
| `DELETE` | `/api/patients/{id}` | 患者削除 |
| `GET` | `/api/patients/export` | 患者一覧 CSV エクスポート |
| `POST` | `/api/patients/{id}/qualification-check` | オンライン資格確認 |

### 処方・調剤

| メソッド | パス | 説明 |
|---|---|---|
| `GET` | `/api/patients/{id}/prescriptions` | 処方履歴 |
| `GET` | `/api/patients/{id}/prescriptions/export` | 処方履歴 CSV エクスポート |
| `POST` | `/api/patients/{id}/prescriptions/e-prescription` | 電子処方箋受付（非 QR） |

### 訪問スケジュール

| メソッド | パス | 説明 |
|---|---|---|
| `GET` | `/api/schedules` | スケジュール一覧 |
| `POST` | `/api/schedules` | スケジュール作成 |

### 請求・レセコン

| メソッド | パス | 説明 |
|---|---|---|
| `GET` | `/api/billing/evidence` | 請求エビデンス |
| `POST` | `/api/billing/candidates/finalize` | 請求候補確定 |

### 管理

| メソッド | パス | 説明 |
|---|---|---|
| `POST` | `/api/admin/organizations` | 組織プロビジョニング |
| `GET` | `/api/admin/webhooks` | Webhook 一覧 |
| `POST` | `/api/admin/webhooks` | Webhook 登録 |
| `GET` | `/api/admin/facilities` | 施設マスター一覧 |
| `POST` | `/api/admin/facilities` | 施設マスター登録 |

## 破壊的変更の定義

以下を「破壊的変更」とみなし、メジャーバージョンアップが必要：

- レスポンスフィールドの削除または型変更
- 必須リクエストフィールドの追加
- エラーコード体系の変更
- 認証方式の変更
- エンドポイントの削除またはパス変更

## 非破壊的変更（マイナーアップデート）

メジャーバージョンアップ不要：

- オプションフィールドの追加
- 新エンドポイントの追加
- バグ修正（仕様と異なる挙動の修正）
- パフォーマンス改善

## レスポンスヘッダー（将来実装）

```
X-API-Version: 1
X-API-Deprecated: true          # v1 が deprecated になった時に付与
X-API-Sunset-Date: 2027-04-01   # Sunset 日を事前告知
```

## 参考

- [Google API Improvement Proposals - Versioning](https://google.aip.dev/185)
- [Stripe API バージョニング](https://stripe.com/docs/api/versioning)
