/**
 * テナント境界 (x-org-id) を含む fetch ヘッダの共有ビルダ。
 *
 * 縦スライス内で重複している `headers: { 'x-org-id': orgId, ... }` を統一する。
 * fail-closed 契約: `extra` に正規ヘッダと衝突するキー（大文字小文字を無視）が含まれる場合は
 * silent override を許さず RangeError を throw する。これにより後続の呼び出し側が誤って
 * テナントスコープを弱めたり、重複ケーシング（'x-org-id' と 'X-Org-Id'）で曖昧な org ルーティングを
 * 生むことを防ぐ。
 */

function assertNoForbiddenKeys(
  extra: Record<string, string> | undefined,
  forbiddenLowerKeys: readonly string[],
): void {
  if (!extra) return;
  for (const key of Object.keys(extra)) {
    if (forbiddenLowerKeys.includes(key.toLowerCase())) {
      throw new RangeError(`Header "${key}" is reserved and cannot be overridden`);
    }
  }
}

/**
 * `x-org-id` を必ず1つだけ含むヘッダを返す。
 * `extra` に大文字小文字を無視して `x-org-id` を含む場合は RangeError。
 */
export function buildOrgHeaders(
  orgId: string,
  extra?: Record<string, string>,
): Record<string, string> {
  assertNoForbiddenKeys(extra, ['x-org-id']);
  return { 'x-org-id': orgId, ...extra };
}

/**
 * JSON ボディ送信用。`Content-Type: application/json` と `x-org-id` を必ず含む。
 * `extra` に大文字小文字を無視して `content-type` / `x-org-id` を含む場合は RangeError。
 * カスタム content-type が必要な用途はこの generic な extra では扱わない。
 */
export function buildOrgJsonHeaders(
  orgId: string,
  extra?: Record<string, string>,
): Record<string, string> {
  assertNoForbiddenKeys(extra, ['x-org-id', 'content-type']);
  return { 'Content-Type': 'application/json', 'x-org-id': orgId, ...extra };
}
