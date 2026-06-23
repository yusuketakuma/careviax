/**
 * URL path セグメントの低レベル encode プリミティブ。
 *
 * 縦スライス内の API / ダウンロード URL の id 区切りを安全に組み立てるための共有 util。
 * 呼び出し側は **raw な id** を渡すこと（pre-encode しない）。route-param の trim / 正規化は
 * `normalizeRequiredRouteParam` の責務であり、ここでは trim / decode は一切行わない。
 *
 * `encodeURIComponent('.')`/`('..')` は no-op（'.'/'..' をそのまま返す）ため、これらを素通しすると
 * URL 正規化で `/api/x/./y` → `/api/x/y` のようにパスが書き換わる。これは browser route 用の
 * nav helper（buildPatientHref 等）の fail-closed 契約と一致させるべく、ここでも exact dot を弾く。
 */
export function encodePathSegment(value: string): string {
  if (value === '.' || value === '..') {
    throw new RangeError('Path segment cannot be a dot segment');
  }
  return encodeURIComponent(value);
}
