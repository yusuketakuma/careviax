# PH-OS API バージョニングポリシー

> 調査・比較・推奨理由の正本は [`docs/design/api-versioning-decision.md`](./design/api-versioning-decision.md)。
> 矛盾がある場合は決定文書を優先する。本ポリシーはその要約・運用ルールを記す。

## 方針

現行 PH-OS API は `/api` 直下の unprefixed endpoints を v1 相当として扱う。
`/api/v1` はまだ実装しない。外部公開 API や複数クライアント互換が必要になった時点で、URL プレフィックス方式を導入する。

## バージョニング戦略

### URL プレフィックス方式

将来、破壊的変更を伴う外部 API を分離するときは次の形式を使う。

```
/api/v1/patients
/api/v1/patients/{id}
/api/v1/prescriptions
...
```

- **採用理由**: ブラウザキャッシュ・CDN・ロードバランサとの親和性が高い。クライアントのルーティングが単純。OpenAPI スペックとの対応が明確。
- **非採用**: ヘッダー方式（`Accept: application/vnd.ph-os.v1+json`）はクライアント実装コストが高いため見送り。

### 現フェーズの扱い

- 既存エンドポイントは `/api/` 直下に存在し、これを **v1 相当** とみなす。
- 新規 Route Handler は、明示的な外部 API versioning 計画が承認されるまでは `/api/v1` 配下へ作らない。
- 現時点でリダイレクトは不要（内部システム・単一クライアント構成）。
- 破壊的変更が発生した時点で `/api/v2/` を新設し、旧エンドポイントに非推奨マーカーを付ける。

## バージョンライフサイクル

| フェーズ       | 説明                                                   |
| -------------- | ------------------------------------------------------ |
| **Current**    | 最新版。積極的に開発・維持する                         |
| **Deprecated** | 後継バージョンが存在する。最低 6ヶ月の移行猶予を設ける |
| **Sunset**     | 廃止済み。`410 Gone` を返す                            |

## 既存エンドポイントの確認方法

この文書では手書きの全 endpoint 一覧を管理しない。実装済み route の事実は次を優先する。

- `src/app/api/**/route.ts`
- `src/app/api/__tests__/protected-get-routes.test.ts`
- `src/app/api/__tests__/protected-patch-delete-routes.test.ts`
- `src/lib/api/rate-limit.ts`
- `src/lib/api/route-catalog.ts`
- `/api/meta/route-catalog`（curated operational catalog。全 Route Handler 一覧ではない）

代表的な現行 endpoint family:

- `/api/patients*`
- `/api/prescription-intakes*`
- `/api/dispense-*`
- `/api/set-*`
- `/api/visit-*`
- `/api/care-reports*`
- `/api/billing-candidates*`
- `/api/admin/*`

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

## レスポンスヘッダー（Deprecated 対象エンドポイントのみ）

```
X-API-Version: 1
X-API-Deprecated: true          # Deprecated フェーズに入った時点で付与
X-API-Sunset-Date: 2027-04-01   # Sunset 予定日を事前告知
```

**実装対象は Deprecated 対象エンドポイントのみに限定し、全 363 route への一律付与は行わない**
（`docs/design/api-versioning-decision.md` §4.4。投資対効果の観点から一律導入は見送り確定）。

- 実装: `src/lib/api/versioning.ts` の `applyDeprecationHeaders()` helper。
- カタログ: `src/lib/api/deprecation-catalog.ts`（`deprecationCatalog` 配列）。
  Deprecated にする route はここへエントリを追加してから helper を呼び出す。
- `src/lib/api/response.ts` の共通レスポンス関数群はこの用途のために変更しない
  （全 route への一律付与を避けるための意図的な分離）。
- 具体的な追加手順は [`docs/api-versioning-implementation-guide.md`](./api-versioning-implementation-guide.md) を参照。

## 参考

- [Google API Improvement Proposals - Versioning](https://google.aip.dev/185)
- [Stripe API バージョニング](https://stripe.com/docs/api/versioning)
