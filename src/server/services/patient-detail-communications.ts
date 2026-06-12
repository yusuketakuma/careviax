import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { readJsonObjectString } from '@/lib/db/json';
import { listBillingEvidenceBlockers } from '@/server/services/billing-evidence';
import { listCommunicationQueue } from '@/server/services/communication-queue';
import { listPatientBillingCaseRefs } from '@/server/services/patient-detail-billing-refs';
import {
  buildAssignedCareCaseWhere,
  buildPatientDetailWhere,
  type PatientDetailScopeArgs,
} from '@/server/services/patient-detail-scope';

type PatientCommunicationsDb = typeof prisma | Prisma.TransactionClient;

export async function getPatientCommunicationsData(
  db: PatientCommunicationsDb,
  args: PatientDetailScopeArgs,
) {
  const patient = await db.patient.findFirst({
    where: buildPatientDetailWhere(args),
    select: {
      id: true,
      cases: {
        ...(buildAssignedCareCaseWhere(args) ? { where: buildAssignedCareCaseWhere(args) } : {}),
        select: {
          id: true,
        },
      },
    },
  });
  if (!patient) return null;

  const caseIds = patient.cases.map((item) => item.id);
  const billingRefs = await listPatientBillingCaseRefs(db, args, caseIds);
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
  const [
    openTasks,
    medicationIssues,
    billingEvidence,
    billingEvidenceBlockers,
    billingCandidates,
    communicationQueue,
  ] = await Promise.all([
    db.task.findMany({
      where: {
        org_id: args.orgId,
        status: {
          in: ['pending', 'in_progress'],
        },
        OR: [
          {
            related_entity_type: 'patient',
            related_entity_id: args.patientId,
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
    db.medicationIssue.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
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
    db.billingEvidence.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
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
        calculation_context: true,
      },
    }),
    listBillingEvidenceBlockers(db, {
      orgId: args.orgId,
      patientId: args.patientId,
      visitRecordIds: billingRefs.visitRecordIds,
      cycleIds: billingRefs.cycleIds,
      limit: 6,
    }),
    db.billingCandidate.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
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
        source_snapshot: true,
      },
    }),
    listCommunicationQueue(db, {
      orgId: args.orgId,
      patientId: args.patientId,
      caseIds,
      limit: 6,
    }),
  ]);

  return {
    communication_queue: communicationQueue,
    open_tasks: openTasks,
    medication_issues: medicationIssues,
    billing_summary: {
      evidence: billingEvidence.map((item) => ({
        ...item,
        effective_revision_code: readJsonObjectString(
          item.calculation_context,
          'effective_revision_code',
        ),
        site_config_status: readJsonObjectString(item.calculation_context, 'site_config_status'),
        blockers: billingEvidenceBlockers.find((blocker) => blocker.id === item.id)?.blockers ?? [],
      })),
      candidates: billingCandidates.map((item) => ({
        ...item,
        effective_revision_code: readJsonObjectString(item.source_snapshot, 'revision_code'),
        site_config_status: readJsonObjectString(item.source_snapshot, 'site_config_status'),
      })),
      claimable_count: billingEvidence.filter((item) => item.claimable).length,
      blocked_count: billingEvidence.filter((item) => !item.claimable).length,
    },
  };
}
