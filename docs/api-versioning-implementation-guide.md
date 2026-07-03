# API Deprecation 実装手順

> 前提: [`docs/design/api-versioning-decision.md`](./design/api-versioning-decision.md)（SSOT）/
> [`docs/api-versioning-policy.md`](./api-versioning-policy.md)。
> **実装対象は Deprecated 対象エンドポイントのみ**。全 363 route への一律適用はしない。

エンドポイントを deprecate するときは、以下の順序で作業する。

## 1. 破壊的変更かどうかを確認する

`docs/api-versioning-policy.md` の「破壊的変更の定義」に該当するか確認する。該当しない
（オプションフィールド追加・新規エンドポイント・バグ修正等）場合は本手順は不要で、通常の
リリースサイクルで進める。

**例外**: 脆弱性修正・PHI 漏洩防止に関わる変更は移行猶予の対象外（即時適用）。この場合も
事後速やかに変更内容と影響範囲を記録する（§5 参照）。

## 2. 連携面（connector type）を特定し、移行猶予期間を決める

対象エンドポイントがどの連携面に属するか確認し、最低移行猶予期間を決定する
（`src/lib/api/deprecation-catalog.ts` の `ConnectorType` / `MINIMUM_MIGRATION_WINDOW_DAYS`）。

| connector type    | 最低移行猶予期間 | 該当例                                  |
| ----------------- | ---------------- | ---------------------------------------- |
| `internal`        | 即時可            | `/api/patients` 等、社内 PWA 専用 CRUD  |
| `webhook`         | 6ヶ月以上         | `WEBHOOK_EVENT_TYPES` ペイロード         |
| `external-share`  | 新規発行分から    | `external-access` トークン付き公開リンク |
| `mcs`             | 6ヶ月以上         | `patients/[id]/mcs-sync`                 |
| `claims`          | 6ヶ月以上         | claims-export（レセコン連携）            |

## 3. カタログへ登録する

`src/lib/api/deprecation-catalog.ts` の `deprecationCatalog` 配列へ `DeprecationEntry` を
追加する。

```ts
{
  routePath: '/api/patients/:id/legacy-summary',
  methods: ['GET'],
  connectorType: 'internal',
  deprecatedAt: '2026-08-01',
  sunsetDate: '2027-02-01', // 猶予期間はconnector typeの最低期間以上
  migrationGuideUrl: 'https://.../migrate-legacy-summary',
  successorRoutePath: '/api/patients/:id/summary',
}
```

## 4. 該当 route に versioning helper を適用する

対象の Route Handler 内で、レスポンスを返す直前に `applyDeprecationHeaders()` を呼ぶ。

```ts
import { applyDeprecationHeaders } from '@/lib/api/versioning';

export async function GET(req: NextRequest) {
  const response = success(data);
  return applyDeprecationHeaders(response, '/api/patients/:id/legacy-summary', 'GET');
}
```

カタログにエントリが無い routePath/method を渡した場合、helper は何もせず response を
そのまま返す（fail-safe）。既存の `src/lib/api/response.ts` の関数はこの用途のために
変更しない。

## 5. CHANGELOG へ記載する

`CHANGELOG.md` の `[Unreleased]` セクションへ `Deprecated` エントリを追加する
（Keep a Changelog 形式）。

```md
### Deprecated

- `GET /api/patients/:id/legacy-summary` は 2027-02-01 に Sunset 予定。
  後継は `GET /api/patients/:id/summary`。
```

セキュリティパッチ例外（§1 の即時適用）の場合も、事後にどのような変更を即時適用したか
簡潔に記録する。

## 6. Webhook コンシューマへの事前通知（該当する場合）

`connectorType: 'webhook'` または `mcs` / `claims` の場合、猶予期間の開始前に外部への
事前通知を行う（`docs/design/api-versioning-decision.md` §4.4）。

- 管理画面（`admin/webhooks`）上への警告表示、または
- 該当イベントタイプへの `webhook.deprecation_notice` 相当の告知イベント検討

## 7. Sunset 到達後

`sunsetDate` を過ぎたら、該当 route は `410 Gone` を返すよう実装を切り替え、カタログの
エントリはそのまま残す（履歴として）か、`docs/api-versioning-policy.md` の運用に従い整理する。
