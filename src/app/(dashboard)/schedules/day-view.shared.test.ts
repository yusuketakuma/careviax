import { describe, expect, it } from 'vitest';
import { buildProposalFlowSteps } from './day-view.shared';

const states = (steps: ReturnType<typeof buildProposalFlowSteps>) =>
  steps.map((step) => step.state);

describe('buildProposalFlowSteps', () => {
  it('puts a fresh proposal at the clerk-confirmation step', () => {
    expect(
      states(
        buildProposalFlowSteps({ proposal_status: 'proposed', patient_contact_status: 'pending' }),
      ),
    ).toEqual(['done', 'current', 'pending', 'pending', 'pending']);
  });

  it('keeps the clerk step current until the first call is logged', () => {
    expect(
      states(
        buildProposalFlowSteps({
          proposal_status: 'patient_contact_pending',
          patient_contact_status: 'pending',
        }),
      ),
    ).toEqual(['done', 'current', 'pending', 'pending', 'pending']);
  });

  it('moves to the family-approval step after a contact attempt', () => {
    expect(
      states(
        buildProposalFlowSteps({
          proposal_status: 'patient_contact_pending',
          patient_contact_status: 'attempted',
        }),
      ),
    ).toEqual(['done', 'done', 'current', 'pending', 'pending']);
  });

  it('points at the formal-decision step once the patient confirms', () => {
    expect(
      states(
        buildProposalFlowSteps({
          proposal_status: 'patient_contact_pending',
          patient_contact_status: 'confirmed',
        }),
      ),
    ).toEqual(['done', 'done', 'done', 'current', 'pending']);
  });

  it('marks every step done for a confirmed proposal', () => {
    expect(
      states(
        buildProposalFlowSteps({
          proposal_status: 'confirmed',
          patient_contact_status: 'confirmed',
        }),
      ),
    ).toEqual(['done', 'done', 'done', 'done', 'done']);
  });

  it('treats a reschedule as returning to the clerk-confirmation step', () => {
    expect(
      states(
        buildProposalFlowSteps({
          proposal_status: 'reschedule_pending',
          patient_contact_status: 'change_requested',
        }),
      ),
    ).toEqual(['done', 'current', 'pending', 'pending', 'pending']);
  });
});
