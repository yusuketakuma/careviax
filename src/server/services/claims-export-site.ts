import { readJsonObject } from '@/lib/db/json';

export type ClaimsExportSiteResolution =
  | { ok: true; siteId: string }
  | {
      ok: false;
      reason: 'missing_site_id' | 'multiple_site_ids';
      missingCount: number;
      siteCount: number;
    };

function readNonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function readClaimsExportSiteId(sourceSnapshot: unknown) {
  const snapshot = readJsonObject(sourceSnapshot);
  if (!snapshot) return null;
  const directSiteId = readNonEmptyString(snapshot.site_id);
  if (directSiteId) return directSiteId;
  const billingSite = readJsonObject(snapshot.billing_site);
  return readNonEmptyString(billingSite?.site_id);
}

export function resolveClaimsExportSiteId(
  candidates: Array<{ source_snapshot: unknown }>,
): ClaimsExportSiteResolution {
  const siteIds = new Set<string>();
  let missingCount = 0;

  for (const candidate of candidates) {
    const siteId = readClaimsExportSiteId(candidate.source_snapshot);
    if (!siteId) {
      missingCount += 1;
      continue;
    }
    siteIds.add(siteId);
  }

  if (missingCount > 0) {
    return {
      ok: false,
      reason: 'missing_site_id',
      missingCount,
      siteCount: siteIds.size,
    };
  }
  if (siteIds.size !== 1) {
    return {
      ok: false,
      reason: 'multiple_site_ids',
      missingCount,
      siteCount: siteIds.size,
    };
  }

  return { ok: true, siteId: Array.from(siteIds)[0] };
}
