import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import {
  buildCareTeamReliabilitySummary,
  buildPatientContactReadiness,
  selectPrimaryCareTeamCase,
} from '@/lib/patient/care-team-contact';
import { KEY_LAB_ANALYTE_CODES } from '@/lib/patient/lab-analytes';
import { summarizePatientInsurances } from '@/lib/patient/insurance-summary';
import { localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { listPatientFieldRevisionMetadata } from '@/server/services/patient-field-revision-list';
import type { PatientFieldRevisionMetadataItem } from '@/server/services/patient-field-revision-list';
import type { PatientDetailScopeArgs } from '@/server/services/patient-detail-scope';
import type { PatientRiskSummary } from '@/server/services/patient-risk';
import type { PatientBoardCard } from '@/types/patient-board';

type DbClient = typeof prisma | Prisma.TransactionClient;

type FoundationPatient = {
  id: string;
  archived_at: Date | string | null;
  archived_by_name?: string | null;
  contacts: Array<{
    is_primary?: boolean | null;
    is_emergency_contact: boolean;
    phone?: string | null;
    email?: string | null;
    fax?: string | null;
  }>;
  cases: Array<{
    status?: string | null;
    care_team_links: Array<{
      role: string;
      phone?: string | null;
      email?: string | null;
      fax?: string | null;
    }>;
  }>;
  scheduling_preference: {
    preferred_contact_name: string | null;
    preferred_contact_phone: string | null;
    visit_before_contact_required?: boolean | null;
    parking_available: boolean | null;
    care_level: string | null;
  } | null;
};

type FoundationLab = {
  analyte_code: string;
  value_numeric: number | null;
  measured_at: Date | string;
  unit: string | null;
  abnormal_flag: string | null;
};

type FoundationVisitPreparation = {
  id: string;
  scheduled_date: Date | string;
  preparation: {
    medication_changes_reviewed: boolean;
    carry_items_confirmed: boolean;
    previous_issues_reviewed: boolean;
    route_confirmed: boolean;
    offline_synced: boolean;
    prepared_at: Date | string | null;
  } | null;
};

export type PatientFoundationStatus = 'ready' | 'needs_confirmation' | 'missing';

export type PatientFoundationSummary = NonNullable<PatientBoardCard['foundation_summary']>;

export type PatientFoundationItem = {
  key: string;
  label: string;
  status: PatientFoundationStatus;
  detail: string;
  action_href: string;
  action_label: string;
  meta?: {
    updated_at: string;
    updated_by_name: string | null;
    source: string;
    confirmed_at: string | null;
    confirmed_by_name: string | null;
    confirmation_status: 'confirmed' | 'unconfirmed' | 'stale';
    confirmation_detail: string;
    stale: boolean;
  } | null;
};

export type PatientFoundationData = {
  summary: PatientFoundationSummary;
  items: PatientFoundationItem[];
  changes_since_last_visit: Array<{
    id: string;
    category: string;
    field_label: string | null;
    field_key: string;
    source: string;
    updated_by_name: string | null;
    created_at: string;
  }>;
  latest_labs: Array<{
    analyte_code: string;
    value_label: string;
    measured_at: string;
    stale: boolean;
    abnormal: boolean;
  }>;
  insurances: Array<{
    insurance_type: string;
    status_label: string;
    period_label: string;
    copay_label: string | null;
    expires_soon: boolean;
  }>;
  archive: {
    archived: boolean;
    archived_at: string | null;
    archived_by_name: string | null;
  };
};

const LAB_STALE_DAYS = 90;
const MASTER_FIELD_STALE_DAYS = 180;
const REVISION_SOURCE_LABELS: Record<string, string> = {
  patient_detail_edit: '患者詳細',
  visit_record_reflection: '訪問記録反映',
  visit_record: '訪問記録',
  qr_import: 'QR取込',
  jahis_import: 'JAHIS取込',
};

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateKey(value: Date | string | null | undefined): string | null {
  const date = toDate(value);
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}

function isOlderThanDays(value: Date | string | null | undefined, now: Date, days: number) {
  const date = toDate(value);
  if (!date) return true;
  return now.getTime() - date.getTime() > days * 24 * 60 * 60_000;
}

function safeRevisionSourceLabel(source: string) {
  return REVISION_SOURCE_LABELS[source] ?? '更新元不明';
}

export function buildPatientFoundationSummary(args: {
  hasPreferredContact: boolean;
  parkingAvailable: boolean | null | undefined;
  careLevel: string | null | undefined;
  visitToday?: boolean;
  visitPrepared?: boolean;
  safetyTagCount?: number;
  insuranceAlertCount?: number;
  staleLabCount?: number;
  medicationRiskAlertCount?: number;
  preVisitPreparationAlertCount?: number;
  careTeamReliabilityAlertCount?: number;
  foundationConfirmationAlertCount?: number;
  archived?: boolean;
}): PatientFoundationSummary {
  if (args.archived) {
    return {
      status: 'missing',
      label: 'アーカイブ中',
      items: ['read-onlyで確認'],
    };
  }

  const missingItems = [
    args.hasPreferredContact ? null : '連絡先未設定',
    args.parkingAvailable == null ? '駐車未確認' : null,
    args.careLevel ? null : '介護度未確認',
    args.careTeamReliabilityAlertCount ? `連携先${args.careTeamReliabilityAlertCount}件` : null,
    args.visitToday && !args.visitPrepared ? '訪問準備未完' : null,
    args.insuranceAlertCount ? `保険確認${args.insuranceAlertCount}件` : null,
    args.staleLabCount ? `検査値古い${args.staleLabCount}件` : null,
    args.medicationRiskAlertCount ? `薬学リスク${args.medicationRiskAlertCount}件` : null,
    args.preVisitPreparationAlertCount ? `訪問準備${args.preVisitPreparationAlertCount}件` : null,
    args.foundationConfirmationAlertCount
      ? `正本確認${args.foundationConfirmationAlertCount}件`
      : null,
  ].filter((item): item is string => Boolean(item));

  if (missingItems.length > 0) {
    return {
      status: 'needs_confirmation',
      label: `未確認${missingItems.length}件`,
      items: missingItems.slice(0, 3),
    };
  }

  if ((args.safetyTagCount ?? 0) > 0) {
    return {
      status: 'ready',
      label: '安全確認あり',
      items: [`安全タグ${args.safetyTagCount}件`, args.visitPrepared ? '訪問準備済' : null].filter(
        (item): item is string => Boolean(item),
      ),
    };
  }

  return {
    status: 'ready',
    label: '基盤確認済',
    items: [args.visitToday && args.visitPrepared ? '訪問準備済' : '主要項目あり'],
  };
}

function buildLatestLabs(labs: FoundationLab[], now: Date) {
  return labs.slice(0, 6).map((lab) => {
    const measuredAt = toDate(lab.measured_at);
    const ageDays = measuredAt
      ? Math.floor((now.getTime() - measuredAt.getTime()) / (24 * 60 * 60_000))
      : null;
    return {
      analyte_code: lab.analyte_code,
      value_label:
        lab.value_numeric != null
          ? `${lab.value_numeric}${lab.unit ? ` ${lab.unit}` : ''}`
          : lab.unit
            ? `値なし ${lab.unit}`
            : '値なし',
      measured_at: formatDateKey(lab.measured_at) ?? '測定日未設定',
      stale: ageDays == null || ageDays > LAB_STALE_DAYS,
      abnormal: Boolean(lab.abnormal_flag),
    };
  });
}

const PRE_VISIT_PREPARATION_ITEMS: Array<{
  key: keyof NonNullable<FoundationVisitPreparation['preparation']>;
  label: string;
}> = [
  { key: 'medication_changes_reviewed', label: '薬歴・前回変更' },
  { key: 'carry_items_confirmed', label: '持参物' },
  { key: 'previous_issues_reviewed', label: '前回課題' },
  { key: 'route_confirmed', label: 'ルート' },
  { key: 'offline_synced', label: 'オフライン同期' },
];

function buildPreVisitPreparationItem(args: {
  patientId: string;
  schedule: FoundationVisitPreparation | null;
}): PatientFoundationItem {
  const scheduleDate = formatDateKey(args.schedule?.scheduled_date);
  const preparation = args.schedule?.preparation ?? null;
  if (!args.schedule) {
    return {
      key: 'visit_preparation',
      label: '訪問前準備',
      status: 'ready',
      detail: '今後の訪問予定はありません。',
      action_href: `/patients/${args.patientId}`,
      action_label: '患者詳細を確認',
    };
  }

  const completedCount = PRE_VISIT_PREPARATION_ITEMS.filter(
    (item) => preparation?.[item.key] === true,
  ).length;
  const missingLabels = PRE_VISIT_PREPARATION_ITEMS.flatMap((item) =>
    preparation?.[item.key] === true ? [] : [item.label],
  );
  const isComplete = Boolean(preparation?.prepared_at) && missingLabels.length === 0;

  return {
    key: 'visit_preparation',
    label: '訪問前準備',
    status: isComplete ? 'ready' : 'needs_confirmation',
    detail: isComplete
      ? `${scheduleDate ?? '日付未設定'} / 準備済`
      : `${scheduleDate ?? '日付未設定'} / ${completedCount}/${PRE_VISIT_PREPARATION_ITEMS.length}完了 / 未完: ${missingLabels.slice(0, 3).join('、')}`,
    action_href: scheduleDate ? `/schedules?date=${scheduleDate}` : '/schedules',
    action_label: isComplete ? '準備を確認' : '訪問前準備へ',
  };
}

const FOUNDATION_ITEM_REVISION_KEYS: Record<string, string[]> = {
  contact: ['contacts', 'phone'],
  care_team_reliability: ['contacts', 'care_team_links'],
  parking: ['address', 'building_id', 'facility_id', 'facility_unit_id', 'unit_name'],
  care_level: ['care_level'],
  insurance: ['insurance', 'patient_insurance'],
  medication_risk: ['conditions'],
};

function buildRevisionMeta(
  revisions: PatientFieldRevisionMetadataItem[],
  itemKey: string,
  now: Date,
): PatientFoundationItem['meta'] {
  const fieldKeys = FOUNDATION_ITEM_REVISION_KEYS[itemKey] ?? [];
  if (fieldKeys.length === 0) return null;
  const revision = revisions.find(
    (candidate) => candidate.is_current && fieldKeys.includes(candidate.field_key),
  );
  if (!revision) return null;
  const confirmedAt = revision.confirmed_at ? toDate(revision.confirmed_at) : null;
  const confirmationStatus =
    confirmedAt == null
      ? 'unconfirmed'
      : isOlderThanDays(confirmedAt, now, MASTER_FIELD_STALE_DAYS)
        ? 'stale'
        : 'confirmed';
  const confirmationDetail =
    confirmationStatus === 'confirmed'
      ? '確認済み'
      : confirmationStatus === 'stale'
        ? `${MASTER_FIELD_STALE_DAYS}日超`
        : '確認者未設定';

  return {
    updated_at: formatDateKey(revision.created_at) ?? revision.created_at,
    updated_by_name: revision.updated_by_name,
    source: safeRevisionSourceLabel(revision.source),
    confirmed_at: revision.confirmed_at
      ? (formatDateKey(revision.confirmed_at) ?? revision.confirmed_at)
      : null,
    confirmed_by_name: revision.confirmed_by_name,
    confirmation_status: confirmationStatus,
    confirmation_detail: confirmationDetail,
    stale: confirmationStatus === 'stale',
  };
}

function withRevisionMeta(
  item: PatientFoundationItem,
  revisions: PatientFieldRevisionMetadataItem[],
  now: Date,
): PatientFoundationItem {
  const meta = buildRevisionMeta(revisions, item.key, now);
  const needsConfirmation = meta != null && meta.confirmation_status !== 'confirmed';
  return {
    ...item,
    status: needsConfirmation && item.status === 'ready' ? 'needs_confirmation' : item.status,
    detail:
      needsConfirmation && item.status === 'ready'
        ? `${item.detail} / ${meta.confirmation_detail}`
        : item.detail,
    meta,
  };
}

function buildContactItem(args: {
  patientId: string;
  patient: FoundationPatient;
}): PatientFoundationItem {
  const preference = args.patient.scheduling_preference;
  const contactReadiness = buildPatientContactReadiness({
    contacts: args.patient.contacts,
    preferredContactName: preference?.preferred_contact_name,
    preferredContactPhone: preference?.preferred_contact_phone,
    visitBeforeContactRequired: preference?.visit_before_contact_required,
  });

  return {
    key: 'contact',
    label: '主連絡先',
    status: contactReadiness.ready ? 'ready' : 'needs_confirmation',
    detail: contactReadiness.detail,
    action_href: `/patients/${args.patientId}/edit?section=visit#intake.contact_phone`,
    action_label: '連絡先を編集',
  };
}

function buildCareTeamReliabilityItem(args: {
  patientId: string;
  patient: FoundationPatient;
}): PatientFoundationItem {
  const activeCase = selectPrimaryCareTeamCase(args.patient.cases);
  const reliability = buildCareTeamReliabilitySummary({
    contacts: args.patient.contacts,
    careTeamLinks: activeCase?.care_team_links ?? [],
  });

  return {
    key: 'care_team_reliability',
    label: '連絡先・連携先',
    status: reliability.needs_confirmation ? 'needs_confirmation' : 'ready',
    detail: reliability.detail,
    action_href: `/patients/${args.patientId}/edit?section=team#intake.care_manager.name`,
    action_label: reliability.needs_confirmation ? '連携先を整備' : '連携先を確認',
  };
}

export async function buildPatientFoundationData(
  db: DbClient,
  args: PatientDetailScopeArgs & {
    patient: FoundationPatient;
    labSummary: FoundationLab[];
    riskSummary?: PatientRiskSummary | null;
    now?: Date;
  },
): Promise<PatientFoundationData> {
  const now = args.now ?? new Date();
  const today = utcDateFromLocalKey(localDateKey(now));
  const [insurances, latestVisitRecords, revisions, nextVisitPreparation] = await Promise.all([
    db.patientInsurance.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
        is_active: true,
      },
      orderBy: [{ insurance_type: 'asc' }, { valid_until: 'asc' }],
      select: {
        insurance_type: true,
        application_status: true,
        public_program_code: true,
        copay_ratio: true,
        valid_from: true,
        valid_until: true,
        is_active: true,
        confirmed_care_level: true,
      },
    }),
    db.visitRecord.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
      },
      orderBy: [{ visit_date: 'desc' }, { created_at: 'desc' }],
      take: 1,
      select: {
        visit_date: true,
      },
    }),
    listPatientFieldRevisionMetadata(db, {
      orgId: args.orgId,
      patientId: args.patientId,
      limit: 20,
    }),
    db.visitSchedule.findFirst({
      where: {
        org_id: args.orgId,
        scheduled_date: { gte: today },
        schedule_status: { in: ['planned', 'in_preparation', 'ready'] },
        case_: {
          patient_id: args.patientId,
        },
      },
      orderBy: [{ scheduled_date: 'asc' }, { time_window_start: 'asc' }, { created_at: 'asc' }],
      select: {
        id: true,
        scheduled_date: true,
        preparation: {
          select: {
            medication_changes_reviewed: true,
            carry_items_confirmed: true,
            previous_issues_reviewed: true,
            route_confirmed: true,
            offline_synced: true,
            prepared_at: true,
          },
        },
      },
    }),
  ]);

  const latestVisitDate = latestVisitRecords[0]?.visit_date ?? null;
  const changesSinceLastVisit = latestVisitDate
    ? revisions.filter((revision) => {
        const createdAt = toDate(revision.created_at);
        return createdAt != null && createdAt > latestVisitDate;
      })
    : revisions.slice(0, 5);

  const insuranceItems = summarizePatientInsurances(insurances, now);
  const labItems = buildLatestLabs(args.labSummary, now);
  const preference = args.patient.scheduling_preference;
  const hasAnyInsurance = insuranceItems.length > 0;
  const missingKeyLabs = KEY_LAB_ANALYTE_CODES.length - args.labSummary.length;
  const staleLabCount =
    labItems.filter((item) => item.stale || item.abnormal).length + Math.max(missingKeyLabs, 0);
  const insuranceAlertCount =
    insuranceItems.filter((item) => item.expires_soon).length + (hasAnyInsurance ? 0 : 1);
  const riskSummary = args.riskSummary ?? null;
  const medicationRiskAlertCount =
    (riskSummary?.open_issues ?? 0) +
    (riskSummary?.missing_visit_consent ? 1 : 0) +
    (riskSummary?.missing_management_plan ? 1 : 0);
  const medicationRiskDetail =
    riskSummary == null || riskSummary.score === 0
      ? '薬学的課題・同意・管理計画の未処理はありません。'
      : [
          riskSummary.open_issues ? `薬学的課題${riskSummary.open_issues}件` : null,
          riskSummary.missing_visit_consent ? '訪問同意未整備' : null,
          riskSummary.missing_management_plan ? '管理計画未整備' : null,
          riskSummary.reasons[0] ?? null,
        ]
          .filter((item): item is string => Boolean(item))
          .slice(0, 3)
          .join(' / ');
  const preVisitPreparationItem = buildPreVisitPreparationItem({
    patientId: args.patientId,
    schedule: nextVisitPreparation,
  });
  const preVisitPreparationAlertCount =
    preVisitPreparationItem.status === 'needs_confirmation' ? 1 : 0;
  const careTeamReliabilityItem = buildCareTeamReliabilityItem({
    patientId: args.patientId,
    patient: args.patient,
  });
  const careTeamReliabilityAlertCount =
    careTeamReliabilityItem.status === 'needs_confirmation' ? 1 : 0;
  const contactItem = buildContactItem({
    patientId: args.patientId,
    patient: args.patient,
  });
  const rawFoundationItems: PatientFoundationItem[] = [
    contactItem,
    {
      key: 'parking',
      label: '現地条件',
      status: preference?.parking_available == null ? 'needs_confirmation' : 'ready',
      detail:
        preference?.parking_available === true
          ? '駐車場あり'
          : preference?.parking_available === false
            ? '駐車場なし'
            : '駐車可否が未確認です。',
      action_href: `/patients/${args.patientId}/edit?section=visit#intake.parking_available`,
      action_label: '訪問条件を編集',
    },
    {
      key: 'care_level',
      label: '介護度',
      status: preference?.care_level ? 'ready' : 'needs_confirmation',
      detail: preference?.care_level ?? '介護度が未確認です。',
      action_href: `/patients/${args.patientId}/edit?section=care#intake.care_level`,
      action_label: '介護度を編集',
    },
    careTeamReliabilityItem,
    {
      key: 'insurance',
      label: '保険・公費',
      status: insuranceAlertCount > 0 ? 'needs_confirmation' : 'ready',
      detail: hasAnyInsurance
        ? `${insuranceItems.length}件 / ${insuranceAlertCount}件確認`
        : '有効な保険・公費が未登録です。',
      action_href: `/patients/${args.patientId}/edit?section=contact#medical_insurance_number`,
      action_label: '保険を確認',
    },
    {
      key: 'medication_risk',
      label: '薬学リスク',
      status: medicationRiskAlertCount > 0 ? 'needs_confirmation' : 'ready',
      detail: medicationRiskDetail,
      action_href: `/patients/${args.patientId}/safety-check`,
      action_label: '薬学課題を確認',
    },
    {
      ...preVisitPreparationItem,
    },
    {
      key: 'labs',
      label: '最新検査値',
      status: staleLabCount > 0 ? 'needs_confirmation' : 'ready',
      detail:
        args.labSummary.length > 0
          ? `${args.labSummary.length}項目 / 要確認${staleLabCount}件`
          : '薬学判断に使う検査値が未登録です。',
      action_href: `/patients/${args.patientId}/safety-check`,
      action_label: '検査値を確認',
    },
  ];
  const foundationItems = rawFoundationItems.map((item) => withRevisionMeta(item, revisions, now));
  const foundationConfirmationAlertCount = foundationItems.filter(
    (item) => item.meta && item.meta.confirmation_status !== 'confirmed',
  ).length;

  const summary = buildPatientFoundationSummary({
    hasPreferredContact: contactItem.status === 'ready',
    parkingAvailable: preference?.parking_available,
    careLevel: preference?.care_level,
    insuranceAlertCount,
    staleLabCount,
    medicationRiskAlertCount,
    preVisitPreparationAlertCount,
    careTeamReliabilityAlertCount,
    foundationConfirmationAlertCount,
    archived: Boolean(args.patient.archived_at),
  });

  return {
    summary,
    items: foundationItems,
    changes_since_last_visit: changesSinceLastVisit.slice(0, 5).map((revision) => ({
      id: revision.id,
      category: revision.category,
      field_label: revision.field_label,
      field_key: revision.field_key,
      source: safeRevisionSourceLabel(revision.source),
      updated_by_name: revision.updated_by_name,
      created_at: revision.created_at,
    })),
    latest_labs: labItems,
    insurances: insuranceItems,
    archive: {
      archived: Boolean(args.patient.archived_at),
      archived_at: args.patient.archived_at ? formatDateKey(args.patient.archived_at) : null,
      archived_by_name: args.patient.archived_by_name ?? null,
    },
  };
}
