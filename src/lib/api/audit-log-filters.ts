type DateBoundary = 'start' | 'end';
type ParsedAuditLogFilters =
  | { error: string }
  | {
      actor?: string;
      actorPharmacy?: string;
      actorSite?: string;
      patient?: string;
      targetType?: string;
      action?: string;
      from?: Date;
      to?: Date;
    };

function parseDateInput(value: string | null, boundary: DateBoundary) {
  if (!value) {
    return { date: undefined, error: undefined };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { date: undefined, error: undefined };
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const suffix = boundary === 'start' ? 'T00:00:00.000Z' : 'T23:59:59.999Z';
    return { date: new Date(`${trimmed}${suffix}`), error: undefined };
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return { date: undefined, error: '日付形式が不正です' };
  }

  return { date: parsed, error: undefined };
}

export function parseAuditLogFilters(searchParams: URLSearchParams): ParsedAuditLogFilters {
  const actor = searchParams.get('actor') ?? undefined;
  const actorPharmacy =
    searchParams.get('actor_pharmacy_id') ?? searchParams.get('actor_pharmacy') ?? undefined;
  const actorSite =
    searchParams.get('actor_site_id') ?? searchParams.get('actor_site') ?? undefined;
  const patient = searchParams.get('patient_id') ?? searchParams.get('patient') ?? undefined;
  const targetType = searchParams.get('target_type') ?? searchParams.get('target') ?? undefined;
  const action = searchParams.get('action') ?? undefined;

  const fromInput = searchParams.get('date_from') ?? searchParams.get('from');
  const toInput = searchParams.get('date_to') ?? searchParams.get('to');
  const from = parseDateInput(fromInput, 'start');
  const to = parseDateInput(toInput, 'end');

  if (from.error) {
    return { error: 'from パラメータが不正な日付形式です' };
  }

  if (to.error) {
    return { error: 'to パラメータが不正な日付形式です' };
  }

  return {
    actor,
    actorPharmacy,
    actorSite,
    patient,
    targetType,
    action,
    from: from.date,
    to: to.date,
  };
}
