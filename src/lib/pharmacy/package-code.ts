export type PackageCodeIdentity = {
  janCode: string | null;
  gtin: string | null;
  valid: boolean;
};

export function normalizePackageCode(value: string | null | undefined) {
  const normalized = value?.replace(/[\s-]/g, '').trim() ?? '';
  return normalized || null;
}

export function normalizePackageCodeIdentity(
  value: string | null | undefined,
): PackageCodeIdentity {
  const code = normalizePackageCode(value);
  if (!code) return { janCode: null, gtin: null, valid: false };
  if (/^\d{13}$/.test(code)) return { janCode: code, gtin: `0${code}`, valid: true };
  if (/^\d{8}$/.test(code)) return { janCode: code, gtin: `000000${code}`, valid: true };
  if (/^\d{14}$/.test(code)) {
    return {
      janCode: code.startsWith('0') ? code.substring(1) : null,
      gtin: code,
      valid: true,
    };
  }
  return { janCode: code, gtin: null, valid: false };
}

export function buildPackageCodeCandidates(value: string | null | undefined) {
  const identity = normalizePackageCodeIdentity(value);
  const candidates: string[] = [];
  if (identity.janCode) candidates.push(identity.janCode);
  if (identity.gtin) candidates.push(identity.gtin);
  return [...new Set(candidates)];
}

export function buildPackageLookupOr(value: string | null | undefined) {
  return buildPackageCodeCandidates(value).flatMap((code) => [{ gtin: code }, { jan_code: code }]);
}
