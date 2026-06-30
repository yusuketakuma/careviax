export type PatientArchiveSummary = {
  status: 'active' | 'archived';
  archived: boolean;
  archived_at: string | null;
};

function toIsoString(value: Date | string | null | undefined) {
  if (!value) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  return value.toISOString();
}

function isValidDateString(value: string) {
  return Number.isFinite(new Date(value).getTime());
}

export function buildPatientArchiveSummary(
  archivedAt: Date | string | null | undefined,
): PatientArchiveSummary {
  const archivedAtIso = toIsoString(archivedAt);
  return {
    status: archivedAtIso ? 'archived' : 'active',
    archived: Boolean(archivedAtIso),
    archived_at: archivedAtIso,
  };
}

export function normalizePatientArchiveSummary(value: unknown): PatientArchiveSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  if (typeof object.archived !== 'boolean') return null;
  const archivedAt = object.archived_at;
  if (archivedAt !== null && typeof archivedAt !== 'string') return null;
  if (archivedAt !== null && !isValidDateString(archivedAt)) return null;
  const status = object.status;
  if (status !== 'active' && status !== 'archived') return null;
  if (status !== (object.archived ? 'archived' : 'active')) return null;
  if (object.archived !== Boolean(archivedAt)) return null;

  return {
    status,
    archived: object.archived,
    archived_at: archivedAt,
  };
}
