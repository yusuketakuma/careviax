/**
 * API deprecation カタログ（Phase 14-5: scaffolding のみ）。
 *
 * SSOT: docs/design/api-versioning-decision.md（W1-15 ラティファイ済）
 * - 全 363 route への一律 versioning 適用は行わない（YAGNI、投資対効果の観点）。
 * - Deprecated 対象エンドポイントのみ、このカタログにエントリを追加し、
 *   `src/lib/api/versioning.ts` の helper を該当 route から呼び出す。
 * - 現時点でエントリはゼロ（deprecation 対象の破壊的変更は未発生）。
 *
 * 追加手順: docs/api-versioning-implementation-guide.md 参照。
 */

/**
 * 連携面ごとの最低移行猶予期間区分。
 * docs/design/api-versioning-decision.md §4.3 に対応。
 */
export type ConnectorType =
  /** 内部 CRUD API（社内 PWA 専用）。フロントと同時デプロイのため即時可 */
  | 'internal'
  /** アウトバウンド Webhook（WEBHOOK_EVENT_TYPES ペイロード）。最低6ヶ月・事前通知必須 */
  | 'webhook'
  /** 外部共有リンク（external-access）。新規発行分から適用可（既発行トークンは有効期限内保持） */
  | 'external-share'
  /** MCS 同期など外部医療情報システムとの双方向連携。最低6ヶ月・事前通知必須 */
  | 'mcs'
  /** レセコン claims-export。最低6ヶ月・事前通知必須（本接続後） */
  | 'claims';

/**
 * connector type ごとの最低移行猶予期間（日数）。
 * 'security-patch-exempt' は §4.5 の脆弱性修正・即時適用対象を示す特別扱いで、
 * カタログエントリの `securityPatchExempt: true` と組み合わせて使う。
 */
export const MINIMUM_MIGRATION_WINDOW_DAYS: Record<ConnectorType, number> = {
  internal: 0,
  webhook: 183, // 最低6ヶ月
  'external-share': 0, // 新規発行分から適用可（既発行トークンは有効期限内で現行契約維持）
  mcs: 183, // 最低6ヶ月
  claims: 183, // 最低6ヶ月
};

export type DeprecationEntry = {
  /** Route Handler のパス（例: `/api/patients/:id/legacy-summary`） */
  routePath: string;
  /** HTTP メソッド（未指定の場合は route 全体に適用） */
  methods?: string[];
  /** このエンドポイントが利用する連携面。移行猶予期間の判定に使う */
  connectorType: ConnectorType;
  /** Deprecated フェーズに入った日付（ISO 8601） */
  deprecatedAt: string;
  /** Sunset（410 Gone 化）予定日（ISO 8601） */
  sunsetDate: string;
  /** 移行先の説明・移行ガイド URL */
  migrationGuideUrl: string;
  /** 後継エンドポイントのパス（存在する場合） */
  successorRoutePath?: string;
  /**
   * §4.5 のセキュリティパッチ例外対象かどうか。
   * true の場合、猶予期間ポリシーの対象外として即時適用された変更であることを示す
   * （記録目的のフラグであり、helper の挙動は変えない）。
   */
  securityPatchExempt?: boolean;
};

/**
 * Deprecated 対象エンドポイントのカタログ。
 * 現時点でエントリはゼロ（Phase 14-5 は基盤 scaffolding のみで、
 * 実際の deprecation 適用は別タスクで行う）。
 */
export const deprecationCatalog: DeprecationEntry[] = [];

/**
 * routePath (+ 任意で method) からカタログエントリを検索する。
 * 完全一致のみをサポート（動的セグメントは `:id` 記法のまま比較する）。
 */
export function findDeprecationEntry(
  routePath: string,
  method?: string,
): DeprecationEntry | undefined {
  return deprecationCatalog.find((entry) => {
    if (entry.routePath !== routePath) return false;
    if (!method || !entry.methods) return true;
    return entry.methods.includes(method);
  });
}
