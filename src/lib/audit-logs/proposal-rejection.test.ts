import { describe, expect, it } from 'vitest';
import { buildProposalRejectAuditChanges } from './proposal-rejection';

describe('buildProposalRejectAuditChanges', () => {
  it('stores proposal rejection reason metadata without storing free text in the audit log', () => {
    const changes = buildProposalRejectAuditChanges({
      rejectReason: '  東京都港区2-2-2 090-1234-5678 アムロジピン 処方詳細  ',
      proposalStatusFrom: 'proposed',
      patientContactStatusFrom: 'pending',
      patientContactStatusTo: 'pending',
    });
    const changesText = JSON.stringify(changes);

    expect(changes).toEqual({
      proposal_status_from: 'proposed',
      proposal_status_to: 'rejected',
      patient_contact_status_from: 'pending',
      patient_contact_status_to: 'pending',
      reject_reason_recorded: true,
      reject_reason_length: '東京都港区2-2-2 090-1234-5678 アムロジピン 処方詳細'.length,
      reject_reason_storage: 'VisitScheduleProposal.reject_reason',
      reject_reason_text_stored: false,
    });
    expect(changesText).not.toContain('東京都港区2-2-2');
    expect(changesText).not.toContain('090-1234-5678');
    expect(changesText).not.toContain('アムロジピン');
    expect(changesText).not.toContain('処方詳細');
  });

  it('records status transitions without reason metadata for legacy rejects without a reason', () => {
    expect(
      buildProposalRejectAuditChanges({
        rejectReason: undefined,
        proposalStatusFrom: 'patient_contact_pending',
        patientContactStatusFrom: 'pending',
        patientContactStatusTo: 'declined',
      }),
    ).toEqual({
      proposal_status_from: 'patient_contact_pending',
      proposal_status_to: 'rejected',
      patient_contact_status_from: 'pending',
      patient_contact_status_to: 'declined',
      reject_reason_recorded: false,
      reject_reason_storage: null,
      reject_reason_text_stored: false,
    });
  });
});
