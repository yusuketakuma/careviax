import { describe, expect, it } from 'vitest';
import {
  createPcaPumpRentalSchema,
  createPcaPumpSchema,
  updatePcaPumpRentalSchema,
} from './pca-pump-rental';

describe('pca-pump-rental validations', () => {
  it('accepts a minimum valid PCA pump asset', () => {
    expect(
      createPcaPumpSchema.parse({
        asset_code: 'PCA-001',
        model_name: 'CADD Legacy PCA',
        maintenance_due_at: '2026-07-01',
      }),
    ).toMatchObject({
      asset_code: 'PCA-001',
      model_name: 'CADD Legacy PCA',
      maintenance_due_at: '2026-07-01',
    });
  });

  it('rejects invalid calendar dates for maintenance dates', () => {
    expect(
      createPcaPumpSchema.safeParse({
        asset_code: 'PCA-001',
        model_name: 'CADD Legacy PCA',
        maintenance_due_at: '2026-02-30',
      }).success,
    ).toBe(false);
  });

  it('rejects reversed rental due and return dates', () => {
    expect(
      createPcaPumpRentalSchema.safeParse({
        pump_id: 'pump_1',
        institution_id: 'institution_1',
        rented_at: '2026-06-10',
        due_at: '2026-06-09',
      }).success,
    ).toBe(false);

    expect(
      updatePcaPumpRentalSchema.safeParse({
        rented_at: '2026-06-10',
        returned_at: '2026-06-09',
      }).success,
    ).toBe(false);
  });

  it('accepts a valid active rental payload with fee and contact details', () => {
    expect(
      createPcaPumpRentalSchema.parse({
        pump_id: 'pump_1',
        institution_id: 'institution_1',
        status: 'active',
        rented_at: '2026-06-10',
        due_at: '2026-06-20',
        contact_name: '山田看護師',
        contact_phone: '03-1234-5678',
        rental_fee_yen: 12000,
      }),
    ).toMatchObject({
      pump_id: 'pump_1',
      institution_id: 'institution_1',
      status: 'active',
      rental_fee_yen: 12000,
    });
  });
});
