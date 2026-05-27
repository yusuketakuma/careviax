import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConferenceSyncService } from './conference-sync';

type EvidenceDetails = {
  claimableHint: boolean;
  missingConditions: string[];
  evidenceNotes: string[];
};

type ConferenceSyncInternals = {
  buildBillingEvidenceDetails: (...args: unknown[]) => Promise<EvidenceDetails>;
  registerBillingCandidate: (...args: unknown[]) => Promise<{ id: string } | null>;
};

const internals = ConferenceSyncService as unknown as ConferenceSyncInternals;
const originalBuildBillingEvidenceDetails = internals.buildBillingEvidenceDetails;

describe('ConferenceSyncService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    internals.buildBillingEvidenceDetails = originalBuildBillingEvidenceDetails;
  });

  it('uses the canonical UTC Japan billing month for conference billing candidates', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ id: 'candidate_1' });
    const tx = {
      billingCandidate: {
        upsert: upsertMock,
      },
    };
    internals.buildBillingEvidenceDetails = vi.fn(async () => ({
      claimableHint: true,
      missingConditions: [],
      evidenceNotes: [],
    }));

    const candidate = await internals.registerBillingCandidate(
      tx,
      'org_1',
      {
        id: 'note_1',
        case_id: 'case_1',
        patient_id: 'patient_1',
        note_type: 'service_manager',
        title: 'サービス担当者会議',
        conference_date: new Date('2026-02-28T15:30:00.000Z'),
        participants: [],
        structured_content: { sections: [] },
        metadata: {},
        action_items: [],
      },
      'patient_1',
    );

    expect(candidate).toEqual({ id: 'candidate_1' });
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id_dedupe_key: {
            org_id: 'org_1',
            dedupe_key:
              'conference-billing:org_1:patient_1:MED_INFO_PROVISION_2_HA:2026-03-01:note_1',
          },
        },
        create: expect.objectContaining({
          billing_month: new Date('2026-03-01T00:00:00.000Z'),
          dedupe_key:
            'conference-billing:org_1:patient_1:MED_INFO_PROVISION_2_HA:2026-03-01:note_1',
        }),
        update: expect.objectContaining({
          billing_month: new Date('2026-03-01T00:00:00.000Z'),
        }),
      }),
    );
  });
});
