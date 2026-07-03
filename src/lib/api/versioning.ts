import type { NextResponse } from 'next/server';

import { findDeprecationEntry } from './deprecation-catalog';

/**
 * Deprecated エンドポイント専用の X-API-* ヘッダー付与 helper。
 *
 * SSOT: docs/design/api-versioning-decision.md（W1-15 ラティファイ済）
 * - 全 363 route への一律ヘッダー付与は行わない。deprecation-catalog にエントリが
 *   存在するエンドポイントのみに適用する（決定文書 §4.4 実装対象）。
 * - `src/lib/api/response.ts` は編集禁止（決定済みの制約）。この helper は
 *   NextResponse を受け取ってヘッダーを追加で設定するラッパーとして機能し、
 *   既存の response.ts の関数群とは独立して使う。
 *
 * 現時点で呼び出し箇所はゼロ（基盤 scaffolding のみ）。
 * 適用手順は docs/api-versioning-implementation-guide.md を参照。
 */

const CURRENT_API_VERSION = '1';

/**
 * カタログに登録された deprecated エンドポイントのレスポンスへ
 * X-API-Version / X-API-Deprecated / X-API-Sunset-Date を付与する。
 *
 * カタログにエントリが無い routePath/method を渡した場合は、ヘッダーを
 * 一切追加せず response をそのまま返す（誤って全 route に付与されるのを防ぐ fail-safe）。
 */
export function applyDeprecationHeaders<T extends NextResponse>(
  response: T,
  routePath: string,
  method?: string,
): T {
  const entry = findDeprecationEntry(routePath, method);
  if (!entry) {
    return response;
  }

  response.headers.set('X-API-Version', CURRENT_API_VERSION);
  response.headers.set('X-API-Deprecated', 'true');
  response.headers.set('X-API-Sunset-Date', entry.sunsetDate);

  return response;
}

/**
 * 指定した routePath (+method) が deprecation カタログに登録されているかを判定する。
 * route 側で分岐が必要な場合（例: Sunset 済みなら 410 を返す等）に使う想定。
 */
export function isDeprecatedRoute(routePath: string, method?: string): boolean {
  return findDeprecationEntry(routePath, method) !== undefined;
}
