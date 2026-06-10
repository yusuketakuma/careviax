export type ProposalRejectAuditChanges = {
  proposal_status_from: string;
  proposal_status_to: 'rejected';
  patient_contact_status_from: string;
  patient_contact_status_to: string;
  reject_reason_recorded: boolean;
  reject_reason_length?: number;
  reject_reason_storage: 'VisitScheduleProposal.reject_reason' | null;
  reject_reason_text_stored: false;
};

export function buildProposalRejectAuditChanges(args: {
  rejectReason: string | undefined;
  proposalStatusFrom: string;
  patientContactStatusFrom: string;
  patientContactStatusTo: string;
}): ProposalRejectAuditChanges {
  const { rejectReason, proposalStatusFrom, patientContactStatusFrom, patientContactStatusTo } =
    args;
  const trimmedReason = rejectReason?.trim();

  return {
    proposal_status_from: proposalStatusFrom,
    proposal_status_to: 'rejected',
    patient_contact_status_from: patientContactStatusFrom,
    patient_contact_status_to: patientContactStatusTo,
    reject_reason_recorded: Boolean(trimmedReason),
    ...(trimmedReason
      ? {
          reject_reason_length: trimmedReason.length,
          reject_reason_storage: 'VisitScheduleProposal.reject_reason' as const,
        }
      : {
          reject_reason_storage: null,
        }),
    reject_reason_text_stored: false,
  };
}
