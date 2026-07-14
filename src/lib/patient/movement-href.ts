const PATIENT_MOVEMENT_INTERNAL_BASE = 'https://ph-os.invalid';

function isInternalApiPath(pathname: string) {
  const lowerPath = pathname.toLowerCase();
  return (
    lowerPath === '/api' ||
    lowerPath.startsWith('/api/') ||
    lowerPath.startsWith('/api%2f') ||
    lowerPath.startsWith('/api%5c')
  );
}

function isLegacyMovementTimelinePath(pathname: string) {
  return /^\/patients\/[^/?#]+\/timeline(?:[/?#]|$)/i.test(pathname);
}

export function getSafePatientMovementHref(href: string): string | null {
  const trimmed = href.trim();
  if (trimmed !== href) return null;
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return null;
  if (/[\\\u0000-\u0020\u007f]/.test(trimmed)) return null;

  try {
    const parsed = new URL(trimmed, PATIENT_MOVEMENT_INTERNAL_BASE);
    if (parsed.origin !== PATIENT_MOVEMENT_INTERNAL_BASE) return null;
    if (/%(?:2f|5c)/i.test(parsed.pathname)) return null;
    const decodedPathname = decodeURIComponent(parsed.pathname);
    if (/[\\\u0000-\u0020\u007f]/.test(decodedPathname)) return null;
    if (isInternalApiPath(parsed.pathname) || isInternalApiPath(decodedPathname)) return null;
    if (
      isLegacyMovementTimelinePath(parsed.pathname) ||
      isLegacyMovementTimelinePath(decodedPathname)
    ) {
      return null;
    }
    return trimmed;
  } catch {
    return null;
  }
}

export function isSafePatientMovementHref(href: string): boolean {
  return getSafePatientMovementHref(href) === href;
}

export function normalizePatientMovementHref(
  href: string | null | undefined,
  fallback: string,
): string {
  return href ? (getSafePatientMovementHref(href) ?? fallback) : fallback;
}
