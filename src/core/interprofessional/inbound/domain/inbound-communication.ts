export type InboundSourceChannel =
  | 'mcs'
  | 'phone'
  | 'fax'
  | 'email'
  | 'in_person'
  | 'patient_family'
  | 'facility_note'
  | 'external_api'
  | 'manual'
  | 'unknown';

export type InboundSenderRole =
  | 'nurse'
  | 'care_manager'
  | 'physician'
  | 'dentist'
  | 'therapist'
  | 'facility_staff'
  | 'family'
  | 'patient'
  | 'pharmacist'
  | 'admin'
  | 'unknown';

export type InboundCommunicationInput = {
  readonly sourceChannel: InboundSourceChannel;
  readonly senderRole?: InboundSenderRole;
  readonly occurredAtDateKey?: `${number}-${number}-${number}`;
  readonly rawText?: string | null;
  readonly normalizedSummary?: string | null;
  readonly attachmentCount?: number;
  readonly patientLinked: boolean;
  readonly caseLinked?: boolean;
};

export type InboundSourceClassification = {
  readonly sourceGroup:
    | 'external_multi_professional'
    | 'patient_or_family_reported'
    | 'pharmacy_owned'
    | 'unknown';
  readonly requiresReview: boolean;
  readonly rawTextPermissionRequired: true;
  readonly directWorkflowWriteAllowed: false;
};

export type PublicInboundCommunicationSummary = {
  readonly sourceChannel: InboundSourceChannel;
  readonly senderRole: InboundSenderRole;
  readonly sourceGroup: InboundSourceClassification['sourceGroup'];
  readonly occurredAtDateKey?: `${number}-${number}-${number}`;
  readonly hasRawText: boolean;
  readonly rawTextLength: number;
  readonly hasSummary: boolean;
  readonly attachmentCount: number;
  readonly patientLinked: boolean;
  readonly caseLinked: boolean;
  readonly requiresReview: boolean;
};

const RAW_PHI_KEYS = new Set([
  'rawtext',
  'body',
  'content',
  'messagebody',
  'rawpayload',
  'sourceurl',
  'patientname',
  'patientid',
  'caseid',
  'sendername',
  'sendercontact',
  'counterpartcontact',
  'phone',
  'address',
  'note',
  'subject',
]);

function normalizePayloadKey(key: string) {
  return key
    .normalize('NFKC')
    .replace(/[_\-\s]+/g, '')
    .toLocaleLowerCase('en-US');
}

export function hasRawPhiPayloadKeys(value: Record<string, unknown>): boolean {
  const stack: unknown[] = [value];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;

    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }

    for (const [key, nestedValue] of Object.entries(current)) {
      if (RAW_PHI_KEYS.has(normalizePayloadKey(key))) return true;
      if (nestedValue && typeof nestedValue === 'object') stack.push(nestedValue);
    }
  }

  return false;
}

export function classifyInboundSource(
  input: Pick<InboundCommunicationInput, 'sourceChannel' | 'senderRole'>,
): InboundSourceClassification {
  if (
    input.sourceChannel === 'patient_family' ||
    input.senderRole === 'family' ||
    input.senderRole === 'patient'
  ) {
    return {
      sourceGroup: 'patient_or_family_reported',
      requiresReview: true,
      rawTextPermissionRequired: true,
      directWorkflowWriteAllowed: false,
    };
  }

  if (input.senderRole === 'pharmacist' || input.sourceChannel === 'manual') {
    return {
      sourceGroup: 'pharmacy_owned',
      requiresReview: true,
      rawTextPermissionRequired: true,
      directWorkflowWriteAllowed: false,
    };
  }

  if (
    ['mcs', 'phone', 'fax', 'email', 'in_person', 'facility_note', 'external_api'].includes(
      input.sourceChannel,
    )
  ) {
    return {
      sourceGroup: 'external_multi_professional',
      requiresReview: true,
      rawTextPermissionRequired: true,
      directWorkflowWriteAllowed: false,
    };
  }

  return {
    sourceGroup: 'unknown',
    requiresReview: true,
    rawTextPermissionRequired: true,
    directWorkflowWriteAllowed: false,
  };
}

export function toPublicInboundCommunicationSummary(
  input: InboundCommunicationInput,
): PublicInboundCommunicationSummary {
  const classification = classifyInboundSource(input);
  const rawText = input.rawText ?? '';

  return {
    sourceChannel: input.sourceChannel,
    senderRole: input.senderRole ?? 'unknown',
    sourceGroup: classification.sourceGroup,
    occurredAtDateKey: input.occurredAtDateKey,
    hasRawText: rawText.trim().length > 0,
    rawTextLength: rawText.length,
    hasSummary: (input.normalizedSummary ?? '').trim().length > 0,
    attachmentCount: Math.max(0, Math.trunc(input.attachmentCount ?? 0)),
    patientLinked: input.patientLinked,
    caseLinked: input.caseLinked === true,
    requiresReview: classification.requiresReview,
  };
}
