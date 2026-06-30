import type { Prisma } from '@prisma/client';

const PATIENT_OPERATION_HISTORY_ACTIONS = [
  'patient_contacts_updated',
  'patient_mcs_profile_updated',
  'patient_mcs_check_log_created',
] as const;

const BILLING_PATIENT_OPERATION_HISTORY_ACTIONS = ['billing_payment_profile_updated'] as const;

export function buildPatientTimelineConferenceNoteWhere(args: {
  orgId: string;
  patientId: string;
  caseIds: string[];
}): Prisma.ConferenceNoteWhereInput {
  return {
    org_id: args.orgId,
    OR: [
      { patient_id: args.patientId, case_id: null },
      ...(args.caseIds.length > 0 ? [{ case_id: { in: args.caseIds } }] : []),
    ],
  };
}

export function buildPatientTimelineOperationHistoryFilters(args: {
  patientId: string;
  prescriptionIntakeIds: string[];
  firstVisitDocumentIds: string[];
  billingCandidateIds: string[];
  conferenceNoteIds: string[];
  canManageBilling: boolean;
}): Prisma.AuditLogWhereInput[] {
  const patientActions = [
    ...(args.canManageBilling ? BILLING_PATIENT_OPERATION_HISTORY_ACTIONS : []),
    ...PATIENT_OPERATION_HISTORY_ACTIONS,
  ];
  const filters: Prisma.AuditLogWhereInput[] = [
    {
      target_type: 'Patient',
      target_id: args.patientId,
      action: { in: [...patientActions] },
    },
    {
      target_type: {
        in: [
          'medication_history',
          'medication_calendar',
          'visit_record_list',
          'prescription_history',
        ],
      },
      target_id: args.patientId,
      action: 'export',
    },
  ];

  if (args.prescriptionIntakeIds.length > 0) {
    filters.push({
      target_type: 'prescription_intake',
      target_id: { in: args.prescriptionIntakeIds },
      action: {
        in: ['prescription_original_management_updated', 'prescription_original_document_saved'],
      },
    });
  }

  if (args.firstVisitDocumentIds.length > 0) {
    filters.push({
      target_type: 'first_visit_document',
      target_id: { in: args.firstVisitDocumentIds },
      action: { startsWith: 'first_visit_document.' },
    });
  }

  if (args.canManageBilling && args.billingCandidateIds.length > 0) {
    filters.push({
      target_type: 'BillingCandidate',
      target_id: { in: args.billingCandidateIds },
      action: { in: ['billing_collection_updated'] },
    });
    filters.push({
      target_type: { in: ['billing_receipt', 'billing_invoice'] },
      target_id: { in: args.billingCandidateIds },
      action: 'export',
    });
  }

  if (args.conferenceNoteIds.length > 0) {
    filters.push({
      target_type: 'conference_note',
      target_id: { in: args.conferenceNoteIds },
      action: { startsWith: 'conference_note.' },
    });
  }

  return filters;
}
