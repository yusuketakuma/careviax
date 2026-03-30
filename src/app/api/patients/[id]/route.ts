import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { updatePatientSchema } from '@/lib/validations/patient';
import { prisma } from '@/lib/db/client';
import type { Prisma } from '@prisma/client';
import {
  assertFacilityReference,
  getFacilityVisitDefaults,
} from '@/lib/patient/facility-reference';
import { listCommunicationQueue } from '@/server/services/communication-queue';
import { listBillingEvidenceBlockers } from '@/server/services/billing-evidence';
import { getPatientHomeCareFeatureSummary } from '@/server/services/home-care-ops';
import { getPatientRiskSummary } from '@/server/services/patient-risk';
import { getPatientVisitBrief } from '@/server/services/visit-brief';

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

  const [
    currentMedications,
    visitSchedules,
    visitRecords,
    careReports,
    communicationEvents,
    selfReports,
    externalShares,
    openTasks,
    medicationIssues,
    inquiryRecords,
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
        created_at: true,
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

  const timeline_events = [
    ...visitSchedules.map((item) => ({
      id: `visit_schedule:${item.id}`,
      event_type: 'visit_schedule',
      occurred_at: item.updated_at ?? item.created_at,
      title: `訪問予定 ${item.schedule_status}`,
      summary: item.confirmed_at ? '電話確定済み' : '候補・準備中',
      href: `/schedules`,
    })),
    ...visitRecords.map((item) => ({
      id: `visit_record:${item.id}`,
      event_type: 'visit_record',
      occurred_at: item.visit_date ?? item.created_at,
      title: `訪問記録 ${item.outcome_status}`,
      summary: item.revisit_reason ?? item.postpone_reason ?? item.cancellation_reason ?? null,
      href: `/visits/${item.schedule_id}/record`,
    })),
    ...careReports.map((item) => ({
      id: `care_report:${item.id}`,
      event_type: 'care_report',
      occurred_at: item.created_at,
      title: `報告書 ${item.report_type}`,
      summary: `状態: ${item.status}`,
      href: `/reports/${item.id}`,
    })),
    ...communicationEvents.map((item) => ({
      id: `communication:${item.id}`,
      event_type: 'communication',
      occurred_at: item.occurred_at,
      title: item.subject || item.event_type,
      summary: `${item.direction} / ${item.channel}${item.counterpart_name ? ` / ${item.counterpart_name}` : ''}`,
      href: `/conferences?patient_id=${id}`,
    })),
    ...selfReports.map((item) => ({
      id: `self_report:${item.id}`,
      event_type: 'self_report',
      occurred_at: item.created_at,
      title: `自己申告 ${item.category}`,
      summary: `${item.reported_by_name}${item.requested_callback ? ' / 折返し希望' : ''}`,
      href: '/external',
    })),
    ...externalShares.map((item) => ({
      id: `external_share:${item.id}`,
      event_type: 'external_share',
      occurred_at: item.created_at,
      title: '外部共有リンク発行',
      summary: `${item.granted_to_name}${item.accessed_at ? ' / 閲覧済み' : ''}`,
      href: `/patients/${id}/share`,
    })),
    ...openTasks.map((item) => ({
      id: `task:${item.id}`,
      event_type: 'task',
      occurred_at: item.created_at,
      title: `運用タスク ${item.title}`,
      summary: item.description ?? `優先度: ${item.priority}`,
      href: '/workflow',
    })),
    ...medicationIssues.map((item) => ({
      id: `medication_issue:${item.id}`,
      event_type: 'medication_issue',
      occurred_at: item.identified_at,
      title: `薬学的課題 ${item.title}`,
      summary: `${item.priority}${item.category ? ` / ${item.category}` : ''}`,
      href: '/patients',
    })),
    ...inquiryRecords.map((item) => {
      const inquiryStatus =
        item.result === 'changed'
          ? '変更あり'
          : item.result === 'unchanged'
            ? '変更なし'
            : '回答待ち';
      const counterpart = item.inquiry_to_physician ? ` / ${item.inquiry_to_physician}` : '';
      const detail = item.change_detail ?? item.inquiry_content ?? null;

      return {
        id: `inquiry:${item.id}`,
        event_type: 'inquiry',
        occurred_at: item.resolved_at ?? item.inquired_at ?? item.created_at,
        title: `疑義照会 ${inquiryStatus}`,
        summary: `${item.reason}${counterpart}${detail ? ` / ${detail}` : ''}`,
        href: '/workflow',
      };
    }),
  ]
    .sort((left, right) => right.occurred_at.getTime() - left.occurred_at.getTime())
    .slice(0, 24);

  return success({
    ...patient,
    current_medications: currentMedications,
    visit_schedules: visitSchedules,
    visit_records: visitRecords,
    care_reports: careReports,
    self_reports: selfReports,
    external_shares: externalShares,
    open_tasks: openTasks,
    medication_issues: medicationIssues,
    communication_queue: communicationQueue,
    risk_summary: riskSummary,
    home_care_feature_summary: homeCareFeatureSummary,
    visit_brief: visitBrief,
    first_visit_documents: firstVisitDocuments.map((item) => ({
      ...item,
      emergency_contacts: normalizeFirstVisitDocumentContacts(item.emergency_contacts),
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
    timeline_events,
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
    ...rest
  } = parsed.data;

  const patient = await withOrgContext(ctx.orgId, async (tx) => {
    const facilityVisitDefaults =
      facility_id !== undefined
        ? await getFacilityVisitDefaults(tx, ctx.orgId, facility_id || null)
        : null;

    if (facility_id !== undefined) {
      await assertFacilityReference(tx, ctx.orgId, facility_id || null);
    }

    const updated = await tx.patient.update({
      where: { id },
      data: {
        ...(birth_date ? { birth_date: new Date(birth_date) } : {}),
        ...rest,
      },
    });

    if (
      address !== undefined ||
      building_id !== undefined ||
      facility_id !== undefined ||
      facility_unit_id !== undefined ||
      unit_name !== undefined
    ) {
      const primary = await tx.residence.findFirst({
        where: { patient_id: id, is_primary: true },
      });
      if (primary) {
        await tx.residence.update({
          where: { id: primary.id },
          data: {
            ...(address !== undefined ? { address } : {}),
            ...(building_id !== undefined ? { building_id: building_id || null } : {}),
            ...(facility_id !== undefined ? { facility_id: facility_id || null } : {}),
            ...(facility_unit_id !== undefined ? { facility_unit_id: facility_unit_id || null } : {}),
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
            facility_id: facility_id || null,
            facility_unit_id: facility_unit_id || null,
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
}
