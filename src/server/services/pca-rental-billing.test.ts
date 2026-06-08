import { describe, expect, it, vi } from 'vitest';
import { generatePcaRentalBillingCandidatesForMonth } from './pca-rental-billing';

describe('generatePcaRentalBillingCandidatesForMonth', () => {
  it('creates institution-target billing candidates for chargeable PCA rentals', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ status: 'candidate' });
    const deleteManyMock = vi.fn().mockResolvedValue({ count: 0 });
    const tx = {
      pcaPumpRental: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'rental_1',
            institution_id: 'institution_1',
            rented_at: new Date('2026-06-01T00:00:00.000Z'),
            due_at: new Date('2026-06-30T00:00:00.000Z'),
            returned_at: null,
            rental_fee_yen: 12000,
            contact_name: '訪問看護師',
            pump: {
              id: 'pump_1',
              asset_code: 'PCA-001',
              model_name: 'CADD Legacy PCA',
              serial_number: 'SN-001',
            },
            institution: {
              id: 'institution_1',
              name: 'みなと病院',
              institution_code: '1312345678',
            },
          },
        ]),
      },
      billingCandidate: {
        findMany: vi.fn().mockResolvedValue([]),
        upsert: upsertMock,
        deleteMany: deleteManyMock,
      },
    };

    const candidates = await generatePcaRentalBillingCandidatesForMonth(tx, {
      orgId: 'org_1',
      billingMonth: new Date('2026-06-01T00:00:00.000Z'),
    });

    expect(candidates).toEqual([{ status: 'candidate' }]);
    expect(tx.pcaPumpRental.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          rental_fee_yen: { gt: 0 },
          status: { not: 'cancelled' },
        }),
      }),
    );
    expect(upsertMock).toHaveBeenCalledWith({
      where: {
        org_id_dedupe_key: {
          org_id: 'org_1',
          dedupe_key: 'pca-rental:2026-06-01:rental_1',
        },
      },
      create: expect.objectContaining({
        org_id: 'org_1',
        patient_id: null,
        billing_domain: 'pca_rental',
        billing_target_type: 'institution',
        billing_target_id: 'institution_1',
        billing_target_name: 'みなと病院',
        billing_month: new Date('2026-06-01T00:00:00.000Z'),
        billing_code: 'PCA_PUMP_RENTAL',
        billing_name: 'PCAポンプレンタル料',
        points: null,
        calculation_breakdown: expect.objectContaining({
          calculation_unit: 'yen',
          amount_yen: 12000,
        }),
        source_snapshot: expect.objectContaining({
          source_type: 'pca_pump_rental',
          billing_target: expect.objectContaining({
            type: 'institution',
            id: 'institution_1',
            name: 'みなと病院',
          }),
          pca_rental: expect.objectContaining({
            rental_id: 'rental_1',
            pump_asset_code: 'PCA-001',
          }),
        }),
        status: 'candidate',
      }),
      update: expect.objectContaining({
        billing_domain: 'pca_rental',
        billing_target_type: 'institution',
        billing_target_id: 'institution_1',
        billing_target_name: 'みなと病院',
        status: 'candidate',
      }),
    });
    expect(deleteManyMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        org_id: 'org_1',
        billing_month: new Date('2026-06-01T00:00:00.000Z'),
        billing_domain: 'pca_rental',
        status: { not: 'exported' },
      }),
    });
  });

  it('preserves confirmed review state for existing PCA rental candidates', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ status: 'confirmed' });
    const tx = {
      pcaPumpRental: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'rental_1',
            institution_id: 'institution_1',
            rented_at: new Date('2026-06-01T00:00:00.000Z'),
            due_at: null,
            returned_at: null,
            rental_fee_yen: 12000,
            contact_name: null,
            pump: {
              id: 'pump_1',
              asset_code: 'PCA-001',
              model_name: 'CADD Legacy PCA',
              serial_number: null,
            },
            institution: {
              id: 'institution_1',
              name: 'みなと病院',
              institution_code: null,
            },
          },
        ]),
      },
      billingCandidate: {
        findMany: vi.fn().mockResolvedValue([
          {
            dedupe_key: 'pca-rental:2026-06-01:rental_1',
            source_snapshot: {
              billing_close: {
                review_state: 'reviewed',
                resolution_state: 'confirmed',
                reviewed_at: '2026-06-30T00:00:00.000Z',
                reviewed_by: 'user_1',
              },
            },
          },
        ]),
        upsert: upsertMock,
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const candidates = await generatePcaRentalBillingCandidatesForMonth(tx, {
      orgId: 'org_1',
      billingMonth: new Date('2026-06-01T00:00:00.000Z'),
    });

    expect(candidates).toEqual([{ status: 'confirmed' }]);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: 'confirmed' }),
        update: expect.objectContaining({ status: 'confirmed' }),
      }),
    );
  });
});
