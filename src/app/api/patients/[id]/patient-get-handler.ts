import { NextRequest } from 'next/server';
import type { AuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { normalizeJsonInput, readJsonObject } from '@/lib/db/json';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { success, validationError, notFound } from '@/lib/api/response';
import type { Prisma } from '@prisma/client';
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
import { localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { KEY_LAB_ANALYTE_CODES } from '@/lib/patient/lab-analytes';
import {
  buildCareReportCaseScope,
  buildPatientDetailWhere,
  buildVisitRecordCaseScope,
} from '@/server/services/patient-detail-scope';
import { buildPatientOverviewBaseSelect } from '@/server/services/patient-overview-base-query';
import {
  buildVisibleExternalAccessGrantWhere,
  toPublicExternalAccessScope,
} from '@/server/services/external-access';
import { recordPhiReadAuditForRequest } from '@/lib/audit/phi-read-audit';
import { listPatientBillingCaseRefs } from '@/server/services/patient-detail-billing-refs';
import {
  canCreateTaskInDashboardAssignmentScope,
  resolveDashboardAssignmentScope,
} from '@/server/services/dashboard-assignment-scope';

const PATIENT_EXTERNAL_SHARE_LIMIT = 8;

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

function isInputJsonObject(
  value: Prisma.InputJsonValue | null | undefined,
): value is Prisma.InputJsonObject {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !('toJSON' in value)
  );
}

export function normalizeInputJsonObject(value: unknown): Prisma.InputJsonObject {
  const normalized = normalizeJsonInput(value);
  return isInputJsonObject(normalized) ? normalized : {};
}

function normalizeFirstVisitDocumentContacts(
  value: Prisma.JsonValue | null | undefined,
): FirstVisitDocumentContact[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    const record = readJsonObject(item);
    if (!record) return [];

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

async function listVisibleExternalSharesForPatient(
  db: Pick<Prisma.TransactionClient, 'externalAccessGrant'>,
  args: {
    orgId: string;
    patientId: string;
    caseIds: string[];
  },
) {
  return db.externalAccessGrant.findMany({
    where: buildVisibleExternalAccessGrantWhere(args),
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    take: PATIENT_EXTERNAL_SHARE_LIMIT,
    select: {
      id: true,
      granted_to_name: true,
      granted_to_contact: true,
      scope: true,
      expires_at: true,
      accessed_at: true,
      created_at: true,
    },
  });
}

export async function authenticatedPatientGET(
  _req: NextRequest,
  ctx: AuthContext,
  { params }: { params: Promise<{ id: string }> },
  permissions: {
    canManageBilling: boolean;
    canCreateExternalShare: boolean;
    canCreateReplyRequest: boolean;
    canCreateFollowupTask: boolean;
  },
) {
  const canManageBilling = permissions.canManageBilling;
  const basePatientSharePermissions = {
    can_create_external_share: permissions.canCreateExternalShare,
    can_create_reply_request: permissions.canCreateReplyRequest,
    can_create_followup_task: permissions.canCreateFollowupTask,
  };

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('患者IDが不正です');

  return withOrgContext(
    ctx.orgId,
    async (tx) => {
      const patient = await tx.patient.findFirst({
        where: buildPatientDetailWhere({
          orgId: ctx.orgId,
          patientId: id,
          role: ctx.role,
          userId: ctx.userId,
        }),
        select: buildPatientOverviewBaseSelect({
          orgId: ctx.orgId,
          patientId: id,
          role: ctx.role,
          userId: ctx.userId,
        }),
      });

      if (!patient) return notFound('患者が見つかりません');

      const caseIds = (patient.cases ?? []).map((item) => item.id);
      const [billingRefs, followupAssignmentScope] = await Promise.all([
        canManageBilling
          ? listPatientBillingCaseRefs(tx, { orgId: ctx.orgId, patientId: id }, caseIds)
          : Promise.resolve({ visitRecordIds: [] as string[], cycleIds: [] as string[] }),
        basePatientSharePermissions.can_create_followup_task
          ? resolveDashboardAssignmentScope({
              db: tx,
              orgId: ctx.orgId,
              accessContext: ctx,
            })
          : Promise.resolve(null),
      ]);
      const patientSharePermissions = {
        ...basePatientSharePermissions,
        can_create_followup_task:
          followupAssignmentScope !== null &&
          canCreateTaskInDashboardAssignmentScope(followupAssignmentScope, {
            related_entity_type: 'patient',
            related_entity_id: id,
          }),
      };
      const billingEvidenceScope =
        billingRefs.visitRecordIds.length === 0 && billingRefs.cycleIds.length === 0
          ? { id: { in: [] } }
          : {
              OR: [
                { visit_record_id: { in: billingRefs.visitRecordIds } },
                { cycle_id: { in: billingRefs.cycleIds } },
              ],
            };
      const billingCandidateScope =
        billingRefs.cycleIds.length === 0
          ? { id: { in: [] } }
          : { cycle_id: { in: billingRefs.cycleIds } };
      const billingEvidenceBlockersPromise = canManageBilling
        ? listBillingEvidenceBlockers(tx, {
            orgId: ctx.orgId,
            patientId: id,
            visitRecordIds: billingRefs.visitRecordIds,
            cycleIds: billingRefs.cycleIds,
            limit: 6,
          })
        : Promise.resolve([]);
      // scheduled_date(@db.Date)比較用: ローカル今月の月初/翌月初を UTC 深夜で表す
      const todayKey = localDateKey();
      const [currentYear, currentMonth] = todayKey.split('-').map(Number);
      const currentMonthStart = utcDateFromLocalKey(
        `${currentYear}-${`${currentMonth}`.padStart(2, '0')}-01`,
      );
      const nextMonthStart = new Date(
        Date.UTC(currentYear, currentMonth, 1), // monthIndex = currentMonth で翌月 1 日
      );

      const [
        currentMedications,
        visitSchedules,
        currentMonthVisitCount,
        visitRecords,
        careReports,
        selfReports,
        externalShares,
        openTasks,
        medicationIssues,
        billingEvidence,
        billingEvidenceBlockers,
        billingCandidates,
        communicationQueue,
        riskSummary,
        visitBrief,
        firstVisitDocuments,
      ] = await Promise.all([
        tx.medicationProfile.findMany({
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
          : tx.visitSchedule.findMany({
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
          : tx.visitSchedule.count({
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
          : tx.visitRecord.findMany({
              where: {
                org_id: ctx.orgId,
                patient_id: id,
                ...buildVisitRecordCaseScope(caseIds),
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
        tx.careReport.findMany({
          where: {
            org_id: ctx.orgId,
            patient_id: id,
            ...buildCareReportCaseScope(caseIds),
          },
          orderBy: [{ created_at: 'desc' }],
          take: 8,
          select: {
            id: true,
            report_type: true,
            status: true,
            pdf_url: true,
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
        tx.patientSelfReport.findMany({
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
        listVisibleExternalSharesForPatient(tx, {
          orgId: ctx.orgId,
          patientId: id,
          caseIds,
        }),
        tx.task.findMany({
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
        tx.medicationIssue.findMany({
          where: {
            org_id: ctx.orgId,
            patient_id: id,
            OR: [{ case_id: { in: caseIds } }, { case_id: null }],
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
        canManageBilling
          ? tx.billingEvidence.findMany({
              where: {
                org_id: ctx.orgId,
                patient_id: id,
                ...billingEvidenceScope,
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
            })
          : Promise.resolve([]),
        billingEvidenceBlockersPromise,
        canManageBilling
          ? tx.billingCandidate.findMany({
              where: {
                org_id: ctx.orgId,
                patient_id: id,
                ...billingCandidateScope,
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
                updated_at: true,
              },
            })
          : Promise.resolve([]),
        listCommunicationQueue(tx, {
          orgId: ctx.orgId,
          patientId: id,
          caseIds,
          limit: 6,
        }),
        getPatientRiskSummary(tx, {
          orgId: ctx.orgId,
          patientId: id,
          caseIds,
        }),
        canManageBilling
          ? billingEvidenceBlockersPromise.then((blockers) =>
              getPatientVisitBrief(tx, {
                orgId: ctx.orgId,
                patientId: id,
                context: 'patient',
                caseIds,
                role: ctx.role,
                userId: ctx.userId,
                billingContext: {
                  visitRecordIds: billingRefs.visitRecordIds,
                  cycleIds: billingRefs.cycleIds,
                  blockers,
                },
              }),
            )
          : getPatientVisitBrief(tx, {
              orgId: ctx.orgId,
              patientId: id,
              context: 'patient',
              caseIds,
              role: ctx.role,
              userId: ctx.userId,
            }),
        caseIds.length === 0
          ? Promise.resolve([])
          : tx.firstVisitDocument.findMany({
              where: {
                org_id: ctx.orgId,
                patient_id: id,
                case_id: { in: caseIds },
              },
              orderBy: [{ created_at: 'desc' }],
              take: 8,
              select: {
                id: true,
                case_id: true,
                emergency_contacts: true,
                delivered_at: true,
                delivered_to: true,
                created_at: true,
                updated_at: true,
              },
            }),
      ]);

      const [homeCareFeatureSummary, labRows] = await Promise.all([
        getPatientHomeCareFeatureSummary(tx, {
          orgId: ctx.orgId,
          patientId: id,
        }),
        // Lab summary: most recent value per analyte for key analytes
        tx.patientLabObservation.findMany({
          where: {
            org_id: ctx.orgId,
            patient_id: id,
            analyte_code: { in: [...KEY_LAB_ANALYTE_CODES] },
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
        }),
      ]);

      // Latest per analyte (labRows は上の Promise.all で並列取得済み)
      const labSummaryMap = new Map<string, (typeof labRows)[number]>();
      for (const row of labRows) {
        if (!labSummaryMap.has(row.analyte_code)) {
          labSummaryMap.set(row.analyte_code, row);
        }
      }
      const labSummary = Array.from(labSummaryMap.values());
      const privacy = getPatientPrivacyFlags(ctx.role);

      // PHI 閲覧監査（3省2GL アクセス記録）。ベストエフォート、await しない。
      recordPhiReadAuditForRequest(ctx, { patientId: id, view: 'patient_detail' });

      return success({
        data: {
          id: patient.id,
          display_id: patient.display_id,
          name: patient.name,
          name_kana: patient.name_kana,
          birth_date: patient.birth_date,
          gender: patient.gender,
          billing_support_flag: patient.billing_support_flag,
          primary_pharmacist_id: patient.primary_pharmacist_id,
          backup_pharmacist_id: patient.backup_pharmacist_id,
          primary_staff_id: patient.primary_staff_id,
          backup_staff_id: patient.backup_staff_id,
          allergy_info: patient.allergy_info,
          notes: patient.notes,
          archived_at: patient.archived_at,
          archived_by: patient.archived_by,
          created_at: patient.created_at,
          updated_at: patient.updated_at,
          scheduling_preference: patient.scheduling_preference,
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
            address: privacy.addressFieldsMasked
              ? maskAddressDetail(contact.address)
              : contact.address,
          })),
          current_medications: currentMedications,
          visit_schedules: visitSchedules,
          monthly_visit_count: currentMonthVisitCount,
          visit_records: visitRecords,
          care_reports: careReports.map(({ pdf_url, ...report }) => ({
            ...report,
            has_pdf: typeof pdf_url === 'string' && pdf_url.trim().length > 0,
          })),
          self_reports: selfReports,
          external_shares: externalShares.map((item) => ({
            ...item,
            scope: toPublicExternalAccessScope(item.scope),
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
          first_visit_documents: firstVisitDocuments.map((rawItem) => {
            const item = {
              ...rawItem,
            } as typeof rawItem & { document_url?: unknown };
            delete item.document_url;

            return {
              ...item,
              emergency_contacts: normalizeFirstVisitDocumentContacts(item.emergency_contacts).map(
                (contact) => ({
                  ...contact,
                  phone: privacy.sensitiveFieldsMasked
                    ? maskPhoneNumber(contact.phone)
                    : contact.phone,
                  fax: privacy.sensitiveFieldsMasked ? maskPhoneNumber(contact.fax) : contact.fax,
                  email: privacy.sensitiveFieldsMasked
                    ? maskContactValue(contact.email)
                    : contact.email,
                }),
              ),
            };
          }),
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
          timeline_events: [],
          privacy: {
            sensitive_fields_masked: privacy.sensitiveFieldsMasked,
            address_fields_masked: privacy.addressFieldsMasked,
            can_view_detail: privacy.canViewDetail,
          },
          patient_share_permissions: patientSharePermissions,
        },
      });
    },
    { requestContext: ctx },
  );
}
