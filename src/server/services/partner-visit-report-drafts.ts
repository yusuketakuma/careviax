import { Prisma } from '@prisma/client';
import type { AuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { readJsonObject, toPrismaJsonInput } from '@/lib/db/json';
import { findLatestPrescriberInstitutionSuggestion } from '@/lib/prescriptions/prescriber-institutions';
import { getHomeVisitIntake, type HomeVisitIntake } from '@/lib/patient/home-visit-intake';
import { formatLabAnalyteLabel } from '@/lib/patient/lab-analytes';
import type { BaselineContext, PhysicianReportContent } from '@/types/care-report-content';
import { resolvePharmacyVisitRequestTransition } from '@/server/services/pharmacy-partnerships';
import { japanDateKey } from '@/lib/utils/date-boundary';

export type PartnerVisitPhysicianReportDraftErrorCode =
  | 'PARTNER_VISIT_RECORD_NOT_FOUND'
  | 'PARTNER_VISIT_RECORD_NOT_CONFIRMED'
  | 'PARTNER_VISIT_SOURCE_INACTIVE';

export class PartnerVisitPhysicianReportDraftError extends Error {
  constructor(
    readonly code: PartnerVisitPhysicianReportDraftErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'PartnerVisitPhysicianReportDraftError';
  }
}

const partnerVisitRecordSelect = {
  id: true,
  org_id: true,
  visit_request_id: true,
  share_case_id: true,
  owner_partner_pharmacy_id: true,
  revision_no: true,
  status: true,
  pharmacist_name: true,
  visit_at: true,
  record_content: true,
  attachments: true,
  confirmed_at: true,
  updated_at: true,
  base_confirmation_snapshot: true,
  owner_partner_pharmacy: {
    select: {
      id: true,
      name: true,
      status: true,
    },
  },
  share_case: {
    select: {
      id: true,
      status: true,
      base_patient_id: true,
      base_case_id: true,
      base_patient: {
        select: {
          id: true,
          name: true,
          birth_date: true,
          gender: true,
        },
      },
      base_case: {
        select: {
          id: true,
          required_visit_support: true,
        },
      },
    },
  },
  visit_request: {
    select: {
      id: true,
      status: true,
      urgency: true,
      request_reason: true,
      physician_instruction: true,
      partnership: {
        select: {
          id: true,
          status: true,
          base_site: { select: { id: true, name: true } },
          partner_pharmacy: { select: { id: true, status: true } },
        },
      },
    },
  },
} satisfies Prisma.PartnerVisitRecordSelect;

type PartnerVisitRecordForDraft = Prisma.PartnerVisitRecordGetPayload<{
  select: typeof partnerVisitRecordSelect;
}>;

type CareReportDraftRow = {
  id: string;
  org_id: string;
  patient_id: string;
  case_id: string | null;
  partner_visit_record_id: string | null;
  report_type: string;
  status: string;
  created_at: Date;
  updated_at: Date;
};

export type CreatePartnerVisitPhysicianReportDraftResult = {
  reused: boolean;
  report: {
    id: string;
    patient_id: string;
    case_id: string | null;
    partner_visit_record_id: string | null;
    report_type: 'physician_report';
    status: string;
    created_at: string;
    updated_at: string;
    has_content: boolean;
  };
};

function toDateKey(value: Date | null | undefined) {
  return value ? japanDateKey(value) : '';
}

function trimString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readFirstString(source: Record<string, unknown> | null, keys: string[]) {
  if (!source) return null;
  for (const key of keys) {
    const value = trimString(source[key]);
    if (value) return value;
  }
  return null;
}

function readBoolean(source: Record<string, unknown> | null, key: string) {
  const value = source?.[key];
  return typeof value === 'boolean' ? value : false;
}

function readAdherenceScore(source: Record<string, unknown> | null) {
  const value = source?.adherence_score;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 5
    ? value
    : 0;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
}

function formatLabValueParts(value: unknown, unit: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `${value}${typeof unit === 'string' && unit.trim() ? ` ${unit.trim()}` : ''}`;
  }
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return null;
}

function formatLabEntry(value: unknown) {
  const row = readJsonObject(value);
  if (!row) return null;
  const analyteCode = trimString(row.analyte_code);
  const analyteLabel =
    trimString(row.analyte_label) ?? (analyteCode ? formatLabAnalyteLabel(analyteCode) : null);
  const valueLabel =
    trimString(row.value_label) ??
    formatLabValueParts(row.value_numeric, row.unit) ??
    formatLabValueParts(row.value, row.unit);
  if (!analyteLabel || !valueLabel) return null;

  const measuredAtLabel =
    trimString(row.measured_at_label) ??
    (typeof row.measured_at === 'string' && row.measured_at.trim()
      ? toDateKey(new Date(row.measured_at))
      : null);
  const abnormalFlag = trimString(row.abnormal_flag);
  return [
    `${analyteLabel} ${valueLabel}`,
    measuredAtLabel ? `測定日 ${measuredAtLabel}` : null,
    abnormalFlag ? `異常 ${abnormalFlag}` : null,
  ]
    .filter((item): item is string => Boolean(item))
    .join(' / ');
}

function formatLabObject(value: unknown) {
  const object = readJsonObject(value);
  if (!object) return null;
  const parts = Object.entries(object).flatMap(([key, raw]) => {
    const valueLabel = formatLabValueParts(raw, null);
    if (!valueLabel) return [];
    return `${formatLabAnalyteLabel(key)} ${valueLabel}`;
  });
  return parts.length > 0 ? parts.slice(0, 8).join('、') : null;
}

function readLabValuesText(source: Record<string, unknown> | null) {
  const explicit = readFirstString(source, [
    'lab_values',
    'lab_values_summary',
    'laboratory_values',
    'latest_lab_values',
    'renal_function',
    'renal_summary',
  ]);
  if (explicit) return explicit;

  const latestLabs = source?.latest_labs;
  if (Array.isArray(latestLabs)) {
    const lines = latestLabs.map(formatLabEntry).filter((item): item is string => Boolean(item));
    if (lines.length > 0) return lines.slice(0, 6).join('、');
  }

  return formatLabObject(source?.lab_values);
}

function readResidualMedicationRows(source: Record<string, unknown> | null) {
  const value = source?.residual_medications;
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    const row = readJsonObject(item);
    if (!row) return [];
    const drugName = trimString(row.drug_name);
    if (!drugName) return [];
    const remainingQty =
      typeof row.remaining_qty === 'number' && Number.isFinite(row.remaining_qty)
        ? row.remaining_qty
        : 0;
    const excessDays =
      typeof row.excess_days === 'number' && Number.isFinite(row.excess_days) ? row.excess_days : 0;
    return [
      {
        drug_name: drugName,
        remaining_qty: remainingQty,
        excess_days: excessDays,
        reduction_proposal: row.reduction_proposal === true,
      },
    ];
  });
}

function attachmentCount(value: unknown) {
  return Array.isArray(value) ? value.length : value === undefined || value === null ? 0 : 1;
}

function toSafeReport(
  report: CareReportDraftRow,
): CreatePartnerVisitPhysicianReportDraftResult['report'] {
  return {
    id: report.id,
    patient_id: report.patient_id,
    case_id: report.case_id,
    partner_visit_record_id: report.partner_visit_record_id,
    report_type: 'physician_report',
    status: report.status,
    created_at: report.created_at.toISOString(),
    updated_at: report.updated_at.toISOString(),
    has_content: true,
  };
}

function buildPhysicianBaselineContext(
  intake: HomeVisitIntake | null,
): BaselineContext | undefined {
  if (!intake) return undefined;
  return {
    care_level: intake.care_level,
    adl_level: intake.adl_level,
    dementia_level: intake.dementia_level,
    special_medical_procedures: intake.special_medical_procedures,
    primary_disease: intake.primary_disease,
    requester: intake.requester
      ? {
          contact_name: intake.requester.contact_name,
          organization_name: intake.requester.organization_name,
          profession: intake.requester.profession,
          phone: intake.requester.phone,
          fax: intake.requester.fax,
        }
      : undefined,
  };
}

function isCareReportPartnerVisitUniqueConflict(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }

  const target = error.meta?.target;
  const targetText = Array.isArray(target) ? target.join(',') : String(target ?? '');
  return (
    targetText.includes('partner_visit_record_id') ||
    targetText.includes('CareReport_org_partner_visit_report_type_key')
  );
}

async function findExistingDraft(
  tx: Prisma.TransactionClient,
  orgId: string,
  partnerVisitRecordId: string,
) {
  return tx.careReport.findFirst({
    where: {
      org_id: orgId,
      partner_visit_record_id: partnerVisitRecordId,
      report_type: 'physician_report',
    },
    select: {
      id: true,
      org_id: true,
      patient_id: true,
      case_id: true,
      partner_visit_record_id: true,
      report_type: true,
      status: true,
      created_at: true,
      updated_at: true,
    },
  });
}

function buildPhysicianReportContent(args: {
  record: PartnerVisitRecordForDraft;
  prescriber: { name: string; institution: string } | null;
}) {
  const { record, prescriber } = args;
  const recordContent = readJsonObject(record.record_content);
  const patient = record.share_case.base_patient;
  const adherence = readFirstString(recordContent, [
    'medication_adherence',
    'adherence',
    'medication_status',
    'compliance_summary',
  ]);
  const remainingMedications = readFirstString(recordContent, [
    'remaining_medications',
    'residual_medications_summary',
    'residual_summary',
  ]);
  const adverseEventText = readFirstString(recordContent, [
    'suspected_adverse_effects',
    'adverse_events',
    'side_effects',
  ]);
  const storageStatus = readFirstString(recordContent, ['storage_status']);
  const assessment = readFirstString(recordContent, ['pharmacist_assessment', 'assessment']);
  const proposals = readFirstString(recordContent, [
    'proposals',
    'proposal_to_physician',
    'prescription_proposals',
  ]);
  const plan = readFirstString(recordContent, ['follow_up_plan', 'plan']);
  const communicationLines = [
    proposals,
    record.visit_request.physician_instruction
      ? `医師指示: ${record.visit_request.physician_instruction}`
      : null,
    remainingMedications ? `残薬: ${remainingMedications}` : null,
    storageStatus ? `保管状況: ${storageStatus}` : null,
    adverseEventText ? `副作用疑い: ${adverseEventText}` : null,
  ].filter((value): value is string => Boolean(value));
  const intake = getHomeVisitIntake(record.share_case.base_case?.required_visit_support);

  return {
    patient: {
      name: patient.name,
      birth_date: toDateKey(patient.birth_date),
      gender: patient.gender,
    },
    report_date: toDateKey(new Date()),
    visit_date: toDateKey(record.visit_at),
    pharmacist_name: record.pharmacist_name ?? '',
    prescriber: {
      name: prescriber?.name ?? '',
      institution: prescriber?.institution ?? '',
    },
    prescriptions: [],
    medication_management: {
      compliance_summary: adherence ?? '',
      adherence_score: readAdherenceScore(recordContent),
      self_management: readFirstString(recordContent, ['self_management']) ?? '',
      calendar_used: readBoolean(recordContent, 'calendar_used'),
    },
    adverse_events: {
      has_events: Boolean(adverseEventText),
      events: readStringArray(recordContent?.adverse_event_items),
      details: adverseEventText ?? '',
    },
    functional_assessment: {
      lab_values: readLabValuesText(recordContent) ?? undefined,
      sleep: readFirstString(recordContent, ['sleep']) ?? '',
      cognition: readFirstString(recordContent, ['cognition']) ?? '',
      diet_oral: readFirstString(recordContent, ['diet_oral']) ?? '',
      mobility: readFirstString(recordContent, ['mobility']) ?? '',
      excretion: readFirstString(recordContent, ['excretion']) ?? '',
    },
    residual_medications: readResidualMedicationRows(recordContent),
    assessment: assessment ?? '',
    plan: plan ?? '',
    prescription_proposals: proposals ?? '',
    physician_communication: communicationLines.join('\n'),
    warnings: [
      '協力薬局訪問記録から作成した下書きです。基幹薬局で内容確認してください。',
      '処方内容は自動転記していません。必要に応じて追記してください。',
      ...(adherence ? [] : ['服薬状況が未入力です。']),
      ...(assessment || proposals ? [] : ['薬学的評価または医師への提案が未入力です。']),
    ],
    ...(intake ? { baseline_context: buildPhysicianBaselineContext(intake) } : {}),
    recipient_prefill: prescriber
      ? {
          recipient_name: prescriber.name,
          recipient_organization: prescriber.institution,
        }
      : undefined,
    source_provenance: {
      schema_version: 1,
      source: 'partner_visit_record',
      partner_visit_record_id: record.id,
      partner_visit_record_revision_no: record.revision_no,
      partner_visit_record_updated_at: record.updated_at.toISOString(),
      visit_request_id: record.visit_request_id,
      share_case_id: record.share_case_id,
      owner_partner_pharmacy_id: record.owner_partner_pharmacy_id,
      generated_at: new Date().toISOString(),
    },
    partner_visit_summary: {
      partner_pharmacy_name: record.owner_partner_pharmacy.name,
      base_site_name: record.visit_request.partnership.base_site.name,
      visit_request_urgency: record.visit_request.urgency,
      record_content_keys: Object.keys(recordContent ?? {}).sort(),
      attachment_count: attachmentCount(record.attachments),
    },
  } satisfies PhysicianReportContent & Record<string, unknown>;
}

function assertRecordCanGenerateDraft(record: PartnerVisitRecordForDraft) {
  if (record.status !== 'confirmed' || !record.confirmed_at) {
    throw new PartnerVisitPhysicianReportDraftError(
      'PARTNER_VISIT_RECORD_NOT_CONFIRMED',
      '確認済みの協力訪問記録のみ医師向け報告書を作成できます',
      { status: record.status },
    );
  }

  if (
    record.share_case.status !== 'active' ||
    (record.visit_request.status !== 'confirmed' &&
      record.visit_request.status !== 'physician_report_created' &&
      record.visit_request.status !== 'claim_checked' &&
      record.visit_request.status !== 'completed') ||
    record.visit_request.partnership.status !== 'active' ||
    record.visit_request.partnership.partner_pharmacy.status !== 'active' ||
    record.owner_partner_pharmacy.status !== 'active'
  ) {
    throw new PartnerVisitPhysicianReportDraftError(
      'PARTNER_VISIT_SOURCE_INACTIVE',
      '有効な患者共有ケースと確認済み協力訪問のみ医師向け報告書を作成できます',
      {
        share_case_status: record.share_case.status,
        visit_request_status: record.visit_request.status,
        partnership_status: record.visit_request.partnership.status,
        partner_pharmacy_status: record.visit_request.partnership.partner_pharmacy.status,
        owner_partner_pharmacy_status: record.owner_partner_pharmacy.status,
      },
    );
  }
}

async function markVisitRequestPhysicianReportCreated(
  tx: Prisma.TransactionClient,
  ctx: Pick<AuthContext, 'orgId'>,
  record: PartnerVisitRecordForDraft,
) {
  const transition = resolvePharmacyVisitRequestTransition({
    currentStatus: record.visit_request.status,
    action: 'create_physician_report',
  });
  if (!transition.allowed) return;

  await tx.pharmacyVisitRequest.updateMany({
    where: {
      id: record.visit_request.id,
      org_id: ctx.orgId,
      status: transition.currentStatus,
    },
    data: { status: transition.nextStatus },
  });
}

export async function createPartnerVisitPhysicianReportDraft(
  tx: Prisma.TransactionClient,
  ctx: Pick<AuthContext, 'orgId' | 'userId' | 'ipAddress' | 'userAgent'>,
  input: { partnerVisitRecordId: string },
): Promise<CreatePartnerVisitPhysicianReportDraftResult> {
  const record = await tx.partnerVisitRecord.findFirst({
    where: { id: input.partnerVisitRecordId, org_id: ctx.orgId },
    select: partnerVisitRecordSelect,
  });
  if (!record) {
    throw new PartnerVisitPhysicianReportDraftError(
      'PARTNER_VISIT_RECORD_NOT_FOUND',
      '協力訪問記録が見つかりません',
    );
  }
  assertRecordCanGenerateDraft(record);

  const existing = await findExistingDraft(tx, ctx.orgId, input.partnerVisitRecordId);
  if (existing) {
    await markVisitRequestPhysicianReportCreated(tx, ctx, record);
    return { reused: true, report: toSafeReport(existing) };
  }

  const prescriberSuggestion = await findLatestPrescriberInstitutionSuggestion(tx, ctx.orgId, {
    patientId: record.share_case.base_patient_id,
    caseId: record.share_case.base_case_id,
  });
  const prescriber = prescriberSuggestion
    ? {
        name: prescriberSuggestion.prescriber_name ?? prescriberSuggestion.name,
        institution: prescriberSuggestion.name,
      }
    : null;
  const content = buildPhysicianReportContent({ record, prescriber });

  try {
    const report = await tx.careReport.create({
      data: {
        org_id: ctx.orgId,
        patient_id: record.share_case.base_patient_id,
        case_id: record.share_case.base_case_id,
        partner_visit_record_id: record.id,
        report_type: 'physician_report',
        status: 'draft',
        content: toPrismaJsonInput(content),
        created_by: ctx.userId,
      },
      select: {
        id: true,
        org_id: true,
        patient_id: true,
        case_id: true,
        partner_visit_record_id: true,
        report_type: true,
        status: true,
        created_at: true,
        updated_at: true,
      },
    });

    await createAuditLogEntry(tx, ctx, {
      action: 'partner_visit_physician_report_draft_created',
      targetType: 'CareReport',
      targetId: report.id,
      changes: {
        partner_visit_record_id: record.id,
        visit_request_id: record.visit_request_id,
        share_case_id: record.share_case_id,
        patient_id: record.share_case.base_patient_id,
        case_id: record.share_case.base_case_id,
        report_type: 'physician_report',
        source_record_status: record.status,
        partner_pharmacy_id: record.owner_partner_pharmacy_id,
        record_content_keys: Object.keys(readJsonObject(record.record_content) ?? {}).sort(),
        attachment_count: attachmentCount(record.attachments),
      },
    });

    await markVisitRequestPhysicianReportCreated(tx, ctx, record);

    return { reused: false, report: toSafeReport(report) };
  } catch (error) {
    if (isCareReportPartnerVisitUniqueConflict(error)) {
      const report = await findExistingDraft(tx, ctx.orgId, input.partnerVisitRecordId);
      if (report) return { reused: true, report: toSafeReport(report) };
    }
    throw error;
  }
}
