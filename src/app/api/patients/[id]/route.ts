import { format } from 'date-fns';
import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { updatePatientSchema } from '@/lib/validations/patient';
import { prisma } from '@/lib/db/client';
import { Prisma } from '@prisma/client';
import {
  assertFacilityReference,
  assertFacilityUnitReference,
  FacilityReferenceValidationError,
  FacilityUnitReferenceValidationError,
  getFacilityVisitDefaults,
} from '@/lib/patient/facility-reference';
import {
  getPatientPrivacyFlags,
  maskAddressDetail,
  maskContactValue,
  maskInsuranceNumber,
  maskPhoneNumber,
} from '@/lib/patient/privacy';
import { listCommunicationQueue } from '@/server/services/communication-queue';
import { listBillingEvidenceBlockers } from '@/server/services/billing-evidence';
import { getPatientHomeCareFeatureSummary } from '@/server/services/home-care-ops';
import { getPatientRiskSummary } from '@/server/services/patient-risk';
import { getPatientVisitBrief } from '@/server/services/visit-brief';
import { batchResolveNames } from '@/lib/utils/name-resolver';
import {
  CHANNEL_LABELS,
  PRIORITY_LABELS,
  REPORT_STATUS_CONFIG,
  REPORT_TYPE_LABELS,
  SCHEDULE_STATUS_LABELS,
  VISIT_OUTCOME_LABELS,
} from '@/lib/constants/status-labels';

type FirstVisitDocumentContact = {
  id?: string;
  name: string;
  relation: string | null;
  phone: string | null;
  email: string | null;
  fax: string | null;
  organization_name: string | null;
  department: string | null;
  is_primary: boolean;
  is_emergency_contact: boolean;
};

function normalizeFirstVisitDocumentContacts(
  value: Prisma.JsonValue | null | undefined
): FirstVisitDocumentContact[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];

    const record = item as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name : null;
    if (!name) return [];

    return [
      {
        id: typeof record.id === 'string' ? record.id : undefined,
        name,
        relation: typeof record.relation === 'string' ? record.relation : null,
        phone: typeof record.phone === 'string' ? record.phone : null,
        email: typeof record.email === 'string' ? record.email : null,
        fax: typeof record.fax === 'string' ? record.fax : null,
        organization_name:
          typeof record.organization_name === 'string' ? record.organization_name : null,
        department: typeof record.department === 'string' ? record.department : null,
        is_primary: record.is_primary === true,
        is_emergency_contact: record.is_emergency_contact === true,
      },
    ];
  });
}

const PRESCRIPTION_SOURCE_LABELS: Record<string, string> = {
  paper: '紙処方箋',
  fax: 'FAX',
  e_prescription: '電子処方箋',
  facility_batch: '施設一括',
  refill: 'リフィル',
  qr_scan: 'QR取込',
};

const CYCLE_STATUS_LABELS: Record<string, string> = {
  intake_received: '受付済',
  structuring: '構造化中',
  inquiry_pending: '疑義照会中',
  inquiry_resolved: '照会解決',
  ready_to_dispense: '調剤待ち',
  dispensing: '調剤中',
  dispensed: '調剤済',
  audit_pending: '鑑査待ち',
  audited: '鑑査済',
  setting: 'セット中',
  set_audited: 'セット済',
  visit_ready: '訪問準備完了',
  visit_completed: '訪問完了',
  reported: '報告済',
  on_hold: '保留',
  cancelled: '取消',
};

const MANAGEMENT_PLAN_STATUS_LABELS: Record<string, string> = {
  draft: '下書き',
  approved: '承認済み',
};

const CARRY_TYPE_LABELS: Record<string, string> = {
  carry: '持参',
  facility_deposit: '施設預け',
  deferred: '後送',
};

const VISIT_TYPE_LABELS: Record<string, string> = {
  initial: '初回訪問',
  regular: '定期訪問',
  temporary: '臨時訪問',
  revisit: '再訪問',
  delivery_only: '配薬のみ',
  emergency: '緊急訪問',
  physician_co_visit: '同行訪問',
};

function formatTimelineDate(value: Date | null | undefined) {
  return value ? format(value, 'yyyy/MM/dd') : null;
}

function compactTimelineValues(values: Array<string | null | undefined | false>) {
  return values.filter((value): value is string => Boolean(value && value.trim()));
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '患者情報の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id } = await params;

  const patient = await prisma.patient.findFirst({
    where: { id, org_id: ctx.orgId },
    include: {
      residences: true,
      cases: {
        orderBy: { created_at: 'desc' },
        include: {
          care_team_links: true,
        },
      },
      contacts: true,
      conditions: {
        orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
      },
      consents: true,
    },
  });

  if (!patient) return notFound('患者が見つかりません');

  const caseIds = (patient.cases ?? []).map((item) => item.id);
  const currentMonthStart = new Date();
  currentMonthStart.setHours(0, 0, 0, 0);
  currentMonthStart.setDate(1);
  const nextMonthStart = new Date(currentMonthStart);
  nextMonthStart.setMonth(nextMonthStart.getMonth() + 1);

  const [
    currentMedications,
    visitSchedules,
    currentMonthVisitCount,
    visitRecords,
    careReports,
    communicationEvents,
    selfReports,
    externalShares,
    openTasks,
    medicationIssues,
    inquiryRecords,
    prescriptionIntakes,
    dispenseResults,
    managementPlans,
    billingEvidence,
    billingEvidenceBlockers,
    billingCandidates,
    communicationQueue,
    riskSummary,
    visitBrief,
    firstVisitDocuments,
  ] = await Promise.all([
    prisma.medicationProfile.findMany({
      where: {
        org_id: ctx.orgId,
        patient_id: id,
        is_current: true,
      },
      orderBy: [{ created_at: 'desc' }],
      take: 20,
      select: {
        id: true,
        drug_name: true,
        dose: true,
        frequency: true,
        start_date: true,
        end_date: true,
        prescriber: true,
        is_current: true,
        source: true,
        created_at: true,
      },
    }),
    caseIds.length === 0
      ? Promise.resolve([])
      : prisma.visitSchedule.findMany({
          where: {
            org_id: ctx.orgId,
            case_id: { in: caseIds },
          },
          orderBy: [{ scheduled_date: 'desc' }, { time_window_start: 'desc' }],
          take: 12,
          select: {
            id: true,
            case_id: true,
            visit_type: true,
            scheduled_date: true,
            time_window_start: true,
            time_window_end: true,
            schedule_status: true,
            priority: true,
            pharmacist_id: true,
            assignment_mode: true,
            confirmed_at: true,
            route_order: true,
            created_at: true,
            updated_at: true,
            visit_record: {
              select: {
                id: true,
                outcome_status: true,
                visit_date: true,
                next_visit_suggestion_date: true,
                created_at: true,
              },
            },
          },
        }),
    caseIds.length === 0
      ? Promise.resolve(0)
      : prisma.visitSchedule.count({
          where: {
            org_id: ctx.orgId,
            case_id: { in: caseIds },
            scheduled_date: {
              gte: currentMonthStart,
              lt: nextMonthStart,
            },
          },
        }),
    caseIds.length === 0
      ? Promise.resolve([])
      : prisma.visitRecord.findMany({
          where: {
            org_id: ctx.orgId,
            patient_id: id,
          },
          orderBy: [{ visit_date: 'desc' }, { created_at: 'desc' }],
          take: 12,
          select: {
            id: true,
            schedule_id: true,
            pharmacist_id: true,
            visit_date: true,
            outcome_status: true,
            next_visit_suggestion_date: true,
            cancellation_reason: true,
            postpone_reason: true,
            revisit_reason: true,
            created_at: true,
          },
        }),
    prisma.careReport.findMany({
      where: {
        org_id: ctx.orgId,
        patient_id: id,
      },
      orderBy: [{ created_at: 'desc' }],
      take: 8,
      select: {
        id: true,
        report_type: true,
        status: true,
        created_by: true,
        created_at: true,
        delivery_records: {
          orderBy: [{ created_at: 'desc' }],
          take: 4,
          select: {
            id: true,
            channel: true,
            recipient_name: true,
            status: true,
            sent_at: true,
            confirmed_at: true,
            created_at: true,
          },
        },
      },
    }),
    prisma.communicationEvent.findMany({
      where: {
        org_id: ctx.orgId,
        patient_id: id,
      },
      orderBy: [{ occurred_at: 'desc' }],
      take: 8,
      select: {
        id: true,
        event_type: true,
        channel: true,
        direction: true,
        subject: true,
        counterpart_name: true,
        occurred_at: true,
      },
    }),
    prisma.patientSelfReport.findMany({
      where: {
        org_id: ctx.orgId,
        patient_id: id,
      },
      orderBy: [{ created_at: 'desc' }],
      take: 8,
      select: {
        id: true,
        subject: true,
        category: true,
        content: true,
        relation: true,
        status: true,
        reported_by_name: true,
        requested_callback: true,
        preferred_contact_time: true,
        created_at: true,
      },
    }),
    prisma.externalAccessGrant.findMany({
      where: {
        org_id: ctx.orgId,
        patient_id: id,
        revoked_at: null,
      },
      orderBy: [{ created_at: 'desc' }],
      take: 8,
      select: {
        id: true,
        granted_to_name: true,
        granted_to_contact: true,
        scope: true,
        expires_at: true,
        accessed_at: true,
        created_at: true,
      },
    }),
    prisma.task.findMany({
      where: {
        org_id: ctx.orgId,
        status: {
          in: ['pending', 'in_progress'],
        },
        OR: [
          {
            related_entity_type: 'patient',
            related_entity_id: id,
          },
          ...(caseIds.length > 0
            ? [
                {
                  related_entity_type: 'case',
                  related_entity_id: {
                    in: caseIds,
                  },
                },
              ]
            : []),
        ],
      },
      orderBy: [{ sla_due_at: 'asc' }, { due_date: 'asc' }, { created_at: 'asc' }],
      take: 8,
      select: {
        id: true,
        task_type: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        due_date: true,
        sla_due_at: true,
        created_at: true,
      },
    }),
    prisma.medicationIssue.findMany({
      where: {
        org_id: ctx.orgId,
        patient_id: id,
        status: {
          in: ['open', 'in_progress'],
        },
      },
      orderBy: [{ priority: 'desc' }, { identified_at: 'desc' }],
      take: 6,
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        category: true,
        identified_at: true,
      },
    }),
    prisma.inquiryRecord.findMany({
      where: {
        org_id: ctx.orgId,
        cycle: {
          patient_id: id,
        },
      },
      orderBy: [{ resolved_at: 'desc' }, { inquired_at: 'desc' }, { created_at: 'desc' }],
      take: 8,
      select: {
        id: true,
        reason: true,
        inquiry_to_physician: true,
        inquiry_content: true,
        result: true,
        change_detail: true,
        inquired_at: true,
        resolved_at: true,
        created_at: true,
        line: {
          select: {
            intake: {
              select: {
                id: true,
              },
            },
          },
        },
      },
    }),
    prisma.prescriptionIntake.findMany({
      where: {
        org_id: ctx.orgId,
        cycle: {
          patient_id: id,
        },
      },
      orderBy: [{ created_at: 'desc' }],
      take: 10,
      select: {
        id: true,
        source_type: true,
        prescribed_date: true,
        prescriber_name: true,
        prescriber_institution: true,
        original_collected_by: true,
        created_at: true,
        cycle: {
          select: {
            overall_status: true,
          },
        },
        lines: {
          take: 3,
          select: {
            id: true,
          },
        },
      },
    }),
    prisma.dispenseResult.findMany({
      where: {
        org_id: ctx.orgId,
        line: {
          intake: {
            cycle: {
              patient_id: id,
            },
          },
        },
      },
      orderBy: [{ dispensed_at: 'desc' }],
      take: 12,
      select: {
        id: true,
        actual_drug_name: true,
        actual_quantity: true,
        actual_unit: true,
        carry_type: true,
        dispensed_by: true,
        dispensed_at: true,
        task: {
          select: {
            cycle: {
              select: {
                overall_status: true,
              },
            },
          },
        },
        line: {
          select: {
            intake: {
              select: {
                id: true,
              },
            },
          },
        },
      },
    }),
    caseIds.length === 0
      ? Promise.resolve([])
      : prisma.managementPlan.findMany({
          where: {
            org_id: ctx.orgId,
            case_id: {
              in: caseIds,
            },
          },
          orderBy: [{ updated_at: 'desc' }],
          take: 6,
          select: {
            id: true,
            status: true,
            title: true,
            effective_from: true,
            next_review_date: true,
            created_by: true,
            approved_by: true,
            approved_at: true,
            reviewed_by: true,
            reviewed_at: true,
            created_at: true,
          },
        }),
    prisma.billingEvidence.findMany({
      where: {
        org_id: ctx.orgId,
        patient_id: id,
      },
      orderBy: [{ billing_month: 'desc' }, { created_at: 'desc' }],
      take: 6,
      select: {
        id: true,
        billing_month: true,
        claimable: true,
        exclusion_reason: true,
        validation_notes: true,
      },
    }),
    listBillingEvidenceBlockers(prisma, {
      orgId: ctx.orgId,
      patientId: id,
      limit: 6,
    }),
    prisma.billingCandidate.findMany({
      where: {
        org_id: ctx.orgId,
        patient_id: id,
      },
      orderBy: [{ billing_month: 'desc' }, { created_at: 'desc' }],
      take: 6,
      select: {
        id: true,
        billing_month: true,
        billing_code: true,
        billing_name: true,
        points: true,
        status: true,
        exclusion_reason: true,
      },
    }),
    listCommunicationQueue(prisma, {
      orgId: ctx.orgId,
      patientId: id,
      limit: 6,
    }),
    getPatientRiskSummary(prisma, {
      orgId: ctx.orgId,
      patientId: id,
    }),
    getPatientVisitBrief(prisma, {
      orgId: ctx.orgId,
      patientId: id,
      context: 'patient',
    }),
    caseIds.length === 0
      ? Promise.resolve([])
      : prisma.firstVisitDocument.findMany({
          where: {
            org_id: ctx.orgId,
            patient_id: id,
            case_id: { in: caseIds },
          },
          orderBy: [{ created_at: 'desc' }],
          select: {
            id: true,
            case_id: true,
            emergency_contacts: true,
            document_url: true,
            delivered_at: true,
            delivered_to: true,
            created_at: true,
            updated_at: true,
          },
        }),
  ]);
  const homeCareFeatureSummary = await getPatientHomeCareFeatureSummary(prisma, {
    orgId: ctx.orgId,
    patientId: id,
  });

  const actorNameMap = await batchResolveNames(
    prisma,
    ctx.orgId,
    Array.from(
      new Set(
        compactTimelineValues([
          ...visitSchedules.map((item) => item.pharmacist_id),
          ...visitRecords.map((item) => item.pharmacist_id),
          ...careReports.map((item) => item.created_by),
          ...dispenseResults.map((item) => item.dispensed_by),
          ...managementPlans.flatMap((item) => [
            item.created_by,
            item.approved_by,
            item.reviewed_by,
          ]),
        ])
      )
    )
  );

  // Lab summary: most recent value per analyte for key analytes
  const KEY_ANALYTES = ['egfr', 'scr', 'k', 'crp', 'hba1c', 'pt_inr', 'alb'] as const;
  const labRows = await prisma.patientLabObservation.findMany({
    where: {
      org_id: ctx.orgId,
      patient_id: id,
      analyte_code: { in: KEY_ANALYTES as unknown as never[] },
    },
    orderBy: [{ measured_at: 'desc' }],
    take: 50,
    select: {
      id: true,
      analyte_code: true,
      measured_at: true,
      value_numeric: true,
      value_text: true,
      unit: true,
      abnormal_flag: true,
    },
  });

  // Latest per analyte
  const labSummaryMap = new Map<string, (typeof labRows)[number]>();
  for (const row of labRows) {
    if (!labSummaryMap.has(row.analyte_code)) {
      labSummaryMap.set(row.analyte_code, row);
    }
  }
  const labSummary = Array.from(labSummaryMap.values());
  const privacy = getPatientPrivacyFlags(ctx.role);

  const timeline_events = [
    ...visitSchedules.map((item) => ({
      id: `visit_schedule:${item.id}`,
      event_type: 'visit_schedule' as const,
      category: 'visit' as const,
      occurred_at: item.confirmed_at ?? item.updated_at ?? item.created_at,
      title: item.confirmed_at ? '訪問予定を確定' : '訪問予定を登録',
      summary:
        compactTimelineValues([
          VISIT_TYPE_LABELS[item.visit_type] ?? item.visit_type,
          formatTimelineDate(item.scheduled_date)
            ? `訪問日 ${formatTimelineDate(item.scheduled_date)}`
            : null,
          item.visit_record ? '訪問記録あり' : null,
        ]).join(' / ') || null,
      href: `/visits/${item.id}`,
      action_label: '訪問予定を開く',
      status: item.schedule_status,
      status_label: SCHEDULE_STATUS_LABELS[item.schedule_status] ?? item.schedule_status,
      actor_name: actorNameMap.get(item.pharmacist_id) ?? null,
      metadata: compactTimelineValues([
        item.priority ? `優先度 ${PRIORITY_LABELS[item.priority] ?? item.priority}` : null,
        item.route_order ? `ルート順 ${item.route_order}` : null,
      ]),
    })),
    ...visitRecords.map((item) => ({
      id: `visit_record:${item.id}`,
      event_type: 'visit_record' as const,
      category: 'visit' as const,
      occurred_at: item.visit_date ?? item.created_at,
      title: '訪問記録を登録',
      summary:
        compactTimelineValues([
          item.revisit_reason,
          item.postpone_reason,
          item.cancellation_reason,
        ]).join(' / ') || null,
      href: item.schedule_id ? `/visits/${item.schedule_id}/record` : `/visits/${item.id}`,
      action_label: '訪問記録を開く',
      status: item.outcome_status,
      status_label: VISIT_OUTCOME_LABELS[item.outcome_status] ?? item.outcome_status,
      actor_name: actorNameMap.get(item.pharmacist_id) ?? null,
      metadata: compactTimelineValues([
        item.next_visit_suggestion_date
          ? `次回提案 ${formatTimelineDate(item.next_visit_suggestion_date)}`
          : null,
      ]),
    })),
    ...prescriptionIntakes.map((item) => ({
      id: `prescription_intake:${item.id}`,
      event_type: 'prescription_intake' as const,
      category: 'prescription' as const,
      occurred_at: item.created_at,
      title: '処方受付を登録',
      summary:
        compactTimelineValues([
          PRESCRIPTION_SOURCE_LABELS[item.source_type] ?? item.source_type,
          item.prescriber_name ?? item.prescriber_institution,
          formatTimelineDate(item.prescribed_date)
            ? `処方日 ${formatTimelineDate(item.prescribed_date)}`
            : null,
        ]).join(' / ') || null,
      href: `/prescriptions/${item.id}`,
      action_label: '処方受付を開く',
      status: item.cycle.overall_status,
      status_label: CYCLE_STATUS_LABELS[item.cycle.overall_status] ?? item.cycle.overall_status,
      actor_name: item.original_collected_by ?? null,
      metadata: compactTimelineValues([
        item.lines.length > 0 ? `${item.lines.length}剤まで表示` : null,
      ]),
    })),
    ...dispenseResults.map((item) => ({
      id: `dispense_result:${item.id}`,
      event_type: 'dispense_result' as const,
      category: 'prescription' as const,
      occurred_at: item.dispensed_at,
      title: '調剤を記録',
      summary:
        compactTimelineValues([
          item.actual_drug_name,
          `${item.actual_quantity}${item.actual_unit ?? ''}`,
          CARRY_TYPE_LABELS[item.carry_type] ?? item.carry_type,
        ]).join(' / ') || null,
      href: `/prescriptions/${item.line.intake.id}`,
      action_label: '調剤詳細を開く',
      status: item.task.cycle?.overall_status ?? 'dispensed',
      status_label: CYCLE_STATUS_LABELS[item.task.cycle?.overall_status ?? 'dispensed'] ?? '調剤済',
      actor_name: actorNameMap.get(item.dispensed_by) ?? null,
      metadata: [],
    })),
    ...inquiryRecords.map((item) => {
      const inquiryStatus =
        item.result === 'changed'
          ? '変更あり'
          : item.result === 'unchanged'
            ? '変更なし'
            : '回答待ち';
      const detail = item.change_detail ?? item.inquiry_content ?? null;

      return {
        id: `inquiry:${item.id}`,
        event_type: 'inquiry' as const,
        category: 'prescription' as const,
        occurred_at: item.resolved_at ?? item.inquired_at ?? item.created_at,
        title: `疑義照会 ${inquiryStatus}`,
        summary:
          compactTimelineValues([
            item.reason,
            item.inquiry_to_physician,
            detail,
          ]).join(' / ') || null,
        href: item.line?.intake?.id ? `/prescriptions/${item.line.intake.id}` : '/workflow',
        action_label: item.line?.intake?.id ? '処方受付を開く' : 'ワークフローを開く',
        status: item.result ?? 'pending',
        status_label: inquiryStatus,
        actor_name: null,
        metadata: compactTimelineValues([
          item.inquired_at ? `照会 ${formatTimelineDate(item.inquired_at)}` : null,
        ]),
      };
    }),
    ...careReports.flatMap((item) => [
      {
        id: `care_report:${item.id}`,
        event_type: 'care_report' as const,
        category: 'document' as const,
        occurred_at: item.created_at,
        title: '報告書を作成',
        summary:
          compactTimelineValues([
            REPORT_TYPE_LABELS[item.report_type] ?? item.report_type,
            REPORT_STATUS_CONFIG[item.status]?.label ?? item.status,
          ]).join(' / ') || null,
        href: `/reports/${item.id}`,
        action_label: '報告書を開く',
        status: item.status,
        status_label: REPORT_STATUS_CONFIG[item.status]?.label ?? item.status,
        actor_name: actorNameMap.get(item.created_by) ?? null,
        metadata: [],
      },
      ...item.delivery_records.map((delivery) => ({
        id: `delivery_record:${delivery.id}`,
        event_type: 'delivery_record' as const,
        category: 'document' as const,
        occurred_at: delivery.confirmed_at ?? delivery.sent_at ?? delivery.created_at,
        title:
          delivery.status === 'confirmed' ? '報告書の受領を確認' : '報告書を送付',
        summary:
          compactTimelineValues([
            delivery.recipient_name,
            CHANNEL_LABELS[delivery.channel] ?? delivery.channel,
            REPORT_TYPE_LABELS[item.report_type] ?? item.report_type,
          ]).join(' / ') || null,
        href: `/reports/${item.id}`,
        action_label: '送付元報告書を開く',
        status: delivery.status,
        status_label: REPORT_STATUS_CONFIG[delivery.status]?.label ?? delivery.status,
        actor_name: actorNameMap.get(item.created_by) ?? null,
        metadata: [],
      })),
    ]),
    ...managementPlans.map((item) => {
      const actorId = item.approved_by ?? item.reviewed_by ?? item.created_by;
      const occurredAt = item.approved_at ?? item.reviewed_at ?? item.created_at;

      return {
        id: `management_plan:${item.id}`,
        event_type: 'management_plan' as const,
        category: 'document' as const,
        occurred_at: occurredAt,
        title: item.approved_at ? '管理計画書を承認' : '管理計画書を作成',
        summary:
          compactTimelineValues([
            item.title,
            item.effective_from
              ? `適用開始 ${formatTimelineDate(item.effective_from)}`
              : null,
            item.next_review_date
              ? `次回見直し ${formatTimelineDate(item.next_review_date)}`
              : null,
          ]).join(' / ') || null,
        href: `/patients/${id}/management-plan`,
        action_label: '計画書を開く',
        status: item.status,
        status_label: MANAGEMENT_PLAN_STATUS_LABELS[item.status] ?? item.status,
        actor_name: actorNameMap.get(actorId) ?? null,
        metadata: [],
      };
    }),
    ...firstVisitDocuments.map((item) => {
      const isDelivered = Boolean(item.delivered_at);
      return {
        id: `first_visit_document:${item.id}`,
        event_type: 'first_visit_document' as const,
        category: 'document' as const,
        occurred_at: item.delivered_at ?? item.created_at,
        title: isDelivered ? '初回訪問文書を交付' : '初回訪問文書を作成',
        summary:
          compactTimelineValues([
            item.delivered_to,
            isDelivered ? '交付記録あり' : '交付未記録',
          ]).join(' / ') || null,
        href: item.document_url ?? `/patients/${id}`,
        action_label: item.document_url ? 'PDFを見る' : '患者詳細を開く',
        status: isDelivered ? 'delivered' : 'created',
        status_label: isDelivered ? '交付済み' : '作成済み',
        actor_name: null,
        metadata: [],
      };
    }),
    ...communicationEvents
      .filter((item) => item.direction !== 'incoming')
      .map((item) => ({
        id: `communication:${item.id}`,
        event_type: 'communication' as const,
        category: 'communication' as const,
        occurred_at: item.occurred_at,
        title: '連絡を記録',
        summary:
          compactTimelineValues([
            CHANNEL_LABELS[item.channel] ?? item.channel,
            item.counterpart_name,
            item.subject ?? item.event_type,
          ]).join(' / ') || null,
        href: `/conferences?patient_id=${id}`,
        action_label: '連絡履歴を開く',
        status: item.direction,
        status_label: '発信',
        actor_name: null,
        metadata: [],
      })),
    ...externalShares.map((item) => ({
      id: `external_share:${item.id}`,
      event_type: 'external_share' as const,
      category: 'communication' as const,
      occurred_at: item.created_at,
      title: '外部共有リンクを発行',
      summary:
        compactTimelineValues([
          item.granted_to_name,
          item.accessed_at ? '閲覧済み' : '未閲覧',
        ]).join(' / ') || null,
      href: `/patients/${id}/share`,
      action_label: '共有設定を開く',
      status: item.accessed_at ? 'accessed' : 'issued',
      status_label: item.accessed_at ? '閲覧済み' : '共有中',
      actor_name: null,
      metadata: compactTimelineValues([
        `期限 ${formatTimelineDate(item.expires_at)}`,
      ]),
    })),
  ]
    .sort((left, right) => right.occurred_at.getTime() - left.occurred_at.getTime())
    .slice(0, 40);

  return success({
    ...patient,
    phone: privacy.sensitiveFieldsMasked ? maskPhoneNumber(patient.phone) : patient.phone,
    medical_insurance_number: privacy.sensitiveFieldsMasked
      ? maskInsuranceNumber(patient.medical_insurance_number)
      : patient.medical_insurance_number,
    care_insurance_number: privacy.sensitiveFieldsMasked
      ? maskInsuranceNumber(patient.care_insurance_number)
      : patient.care_insurance_number,
    residences: (patient.residences ?? []).map((residence) => ({
      ...residence,
      address: privacy.addressFieldsMasked
        ? maskAddressDetail(residence.address)
        : residence.address,
    })),
    contacts: (patient.contacts ?? []).map((contact) => ({
      ...contact,
      phone: privacy.sensitiveFieldsMasked ? maskPhoneNumber(contact.phone) : contact.phone,
      fax: privacy.sensitiveFieldsMasked ? maskPhoneNumber(contact.fax) : contact.fax,
      email: privacy.sensitiveFieldsMasked ? maskContactValue(contact.email) : contact.email,
      address: privacy.addressFieldsMasked ? maskAddressDetail(contact.address) : contact.address,
    })),
    current_medications: currentMedications,
    visit_schedules: visitSchedules,
    monthly_visit_count: currentMonthVisitCount,
    visit_records: visitRecords,
    care_reports: careReports,
    self_reports: selfReports,
    external_shares: externalShares.map((item) => ({
      ...item,
      granted_to_contact: privacy.sensitiveFieldsMasked
        ? maskContactValue(item.granted_to_contact)
        : item.granted_to_contact,
    })),
    open_tasks: openTasks,
    medication_issues: medicationIssues,
    communication_queue: communicationQueue,
    risk_summary: riskSummary,
    home_care_feature_summary: homeCareFeatureSummary,
    visit_brief: visitBrief,
    first_visit_documents: firstVisitDocuments.map((item) => ({
      ...item,
      emergency_contacts: normalizeFirstVisitDocumentContacts(item.emergency_contacts).map(
        (contact) => ({
          ...contact,
          phone: privacy.sensitiveFieldsMasked ? maskPhoneNumber(contact.phone) : contact.phone,
          fax: privacy.sensitiveFieldsMasked ? maskPhoneNumber(contact.fax) : contact.fax,
          email: privacy.sensitiveFieldsMasked
            ? maskContactValue(contact.email)
            : contact.email,
        })
      ),
    })),
    billing_summary: {
      evidence: billingEvidence.map((item) => ({
        ...item,
        blockers:
          billingEvidenceBlockers.find((blocker) => blocker.id === item.id)?.blockers ?? [],
      })),
      candidates: billingCandidates,
      claimable_count: billingEvidence.filter((item) => item.claimable).length,
      blocked_count: billingEvidence.filter((item) => !item.claimable).length,
    },
    lab_summary: labSummary,
    timeline_events,
    privacy: {
      sensitive_fields_masked: privacy.sensitiveFieldsMasked,
      address_fields_masked: privacy.addressFieldsMasked,
      can_view_detail: privacy.canViewDetail,
    },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '患者情報の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = updatePatientSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const existing = await prisma.patient.findFirst({
    where: { id, org_id: ctx.orgId },
  });
  if (!existing) return notFound('患者が見つかりません');

  const {
    address,
    birth_date,
    building_id,
    facility_id,
    facility_unit_id,
    unit_name,
    contacts,
    conditions,
    requester: _requester,
    intake: _intake,
    ...rest
  } = parsed.data;
  void _requester;
  void _intake;

  try {
    const patient = await withOrgContext(ctx.orgId, async (tx) => {
      const primaryResidence = await tx.residence.findFirst({
        where: { patient_id: id, is_primary: true },
        select: {
          id: true,
          facility_id: true,
          facility_unit_id: true,
        },
      });

      const currentFacilityId = primaryResidence?.facility_id ?? null;
      const nextFacilityId =
        facility_id !== undefined ? facility_id || null : currentFacilityId;
      const nextFacilityUnitId =
        facility_unit_id !== undefined
          ? facility_unit_id || null
          : facility_id !== undefined && nextFacilityId !== currentFacilityId
            ? null
            : primaryResidence?.facility_unit_id ?? null;

      const facilityVisitDefaults =
        facility_id !== undefined
          ? await getFacilityVisitDefaults(tx, ctx.orgId, nextFacilityId)
          : null;

      if (facility_id !== undefined) {
        await assertFacilityReference(tx, ctx.orgId, nextFacilityId);
      }
      if (facility_id !== undefined || facility_unit_id !== undefined) {
        await assertFacilityUnitReference(
          tx,
          ctx.orgId,
          nextFacilityId,
          nextFacilityUnitId
        );
      }

    const updated = await tx.patient.update({
      where: { id },
      data: {
        ...(birth_date ? { birth_date: new Date(birth_date) } : {}),
        ...rest,
      } as Prisma.PatientUpdateInput,
    });

    if (
      address !== undefined ||
      building_id !== undefined ||
      facility_id !== undefined ||
      facility_unit_id !== undefined ||
      unit_name !== undefined
    ) {
      if (primaryResidence) {
        await tx.residence.update({
          where: { id: primaryResidence.id },
          data: {
            ...(address !== undefined ? { address } : {}),
            ...(building_id !== undefined ? { building_id: building_id || null } : {}),
            ...(facility_id !== undefined ? { facility_id: nextFacilityId } : {}),
            ...(facility_unit_id !== undefined ||
            (facility_id !== undefined && nextFacilityId !== currentFacilityId)
              ? { facility_unit_id: nextFacilityUnitId }
              : {}),
            ...(unit_name !== undefined ? { unit_name: unit_name || null } : {}),
          },
        });
      } else {
        await tx.residence.create({
          data: {
            org_id: ctx.orgId,
            patient_id: id,
            address: address ?? '',
            building_id: building_id || null,
            facility_id: nextFacilityId,
            facility_unit_id: nextFacilityUnitId,
            unit_name: unit_name || null,
            is_primary: true,
          },
        });
      }
    }

    if (contacts) {
      await tx.contactParty.deleteMany({
        where: { org_id: ctx.orgId, patient_id: id },
      });
      if (contacts.length > 0) {
        await tx.contactParty.createMany({
          data: contacts.map((contact) => ({
            org_id: ctx.orgId,
            patient_id: id,
            name: contact.name,
            relation: contact.relation,
            phone: contact.phone || null,
            email: contact.email || null,
            fax: contact.fax || null,
            organization_name: contact.organization_name || null,
            department: contact.department || null,
            address: contact.address || null,
            is_primary: contact.is_primary,
            is_emergency_contact: contact.is_emergency_contact,
            notes: contact.notes || null,
          })),
        });
      }
    }

    if (conditions) {
      await tx.patientCondition.deleteMany({
        where: { org_id: ctx.orgId, patient_id: id },
      });
      if (conditions.length > 0) {
        await tx.patientCondition.createMany({
          data: conditions.map((condition) => ({
            org_id: ctx.orgId,
            patient_id: id,
            condition_type: condition.condition_type,
            name: condition.name,
            is_primary: condition.is_primary,
            is_active: condition.is_active,
            noted_at: condition.noted_at ? new Date(condition.noted_at) : null,
            notes: condition.notes || null,
          })),
        });
      }
    }

    if (facility_id !== undefined) {
      if (
        facilityVisitDefaults?.acceptance_time_from ||
        facilityVisitDefaults?.acceptance_time_to
      ) {
        await tx.patientSchedulePreference.upsert({
          where: {
            patient_id: id,
          },
          create: {
            org_id: ctx.orgId,
            patient_id: id,
            facility_time_from: facilityVisitDefaults.acceptance_time_from,
            facility_time_to: facilityVisitDefaults.acceptance_time_to,
          },
          update: {
            facility_time_from: facilityVisitDefaults.acceptance_time_from,
            facility_time_to: facilityVisitDefaults.acceptance_time_to,
          },
        });
      } else {
        await tx.patientSchedulePreference.updateMany({
          where: {
            org_id: ctx.orgId,
            patient_id: id,
          },
          data: {
            facility_time_from: null,
            facility_time_to: null,
          },
        });
      }
    }

      return updated;
    }, { requestContext: ctx });

    return success(patient);
  } catch (error) {
    if (
      error instanceof FacilityReferenceValidationError ||
      error instanceof FacilityUnitReferenceValidationError
    ) {
      return validationError(error.message);
    }
    throw error;
  }
}
