export function omitProposalRejectReason<T extends object>(proposal: T): Omit<T, 'reject_reason'> {
  const safeProposal = { ...proposal } as Record<string, unknown>;
  delete safeProposal.reject_reason;
  return safeProposal as Omit<T, 'reject_reason'>;
}

export function omitProposalRejectReasons<T extends object>(
  proposals: T[],
): Array<Omit<T, 'reject_reason'>> {
  return proposals.map(omitProposalRejectReason);
}

type RedactableProposalContactLog = {
  id: string;
  outcome: unknown;
  contact_method: unknown;
  callback_due_at: unknown;
  called_at: unknown;
  note?: string | null;
};

export function redactProposalContactLog<T extends RedactableProposalContactLog>(log: T) {
  return {
    id: log.id,
    outcome: log.outcome,
    contact_method: log.contact_method,
    callback_due_at: log.callback_due_at,
    called_at: log.called_at,
    has_note: typeof log.note === 'string' && log.note.trim().length > 0,
  };
}

export function redactProposalContactLogs<
  T extends { contact_logs?: RedactableProposalContactLog[] },
>(
  proposal: T,
): Omit<T, 'contact_logs'> & {
  contact_logs?: ReturnType<typeof redactProposalContactLog>[];
} {
  if (!Array.isArray(proposal.contact_logs)) {
    return proposal as Omit<T, 'contact_logs'> & {
      contact_logs?: ReturnType<typeof redactProposalContactLog>[];
    };
  }
  return {
    ...proposal,
    contact_logs: proposal.contact_logs.map(redactProposalContactLog),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function redactProposalResidence(residence: unknown) {
  const record = isRecord(residence) ? residence : {};
  return {
    address: typeof record.address === 'string' ? record.address : '',
    building_id: typeof record.building_id === 'string' ? record.building_id : null,
    unit_name: typeof record.unit_name === 'string' ? record.unit_name : null,
    lat: typeof record.lat === 'number' ? record.lat : null,
    lng: typeof record.lng === 'number' ? record.lng : null,
  };
}

export function redactProposalPatientFields<T extends object>(proposal: T): T {
  const safeProposal = { ...proposal } as Record<string, unknown>;
  if (!isRecord(safeProposal.case_)) return safeProposal as T;

  const patient = safeProposal.case_.patient;
  if (!isRecord(patient)) {
    safeProposal.case_ = {};
    return safeProposal as T;
  }

  safeProposal.case_ = {
    patient: {
      id: typeof patient.id === 'string' ? patient.id : '',
      name: typeof patient.name === 'string' ? patient.name : '',
      residences: Array.isArray(patient.residences)
        ? patient.residences.map(redactProposalResidence)
        : [],
    },
  };
  return safeProposal as T;
}
