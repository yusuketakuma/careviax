import { describe, expect, it } from 'vitest';
import {
  createPcaPumpRentalSchema,
  createPcaPumpSchema,
  updatePcaPumpSchema,
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

  it('accepts maintenance event metadata only with a pump status change', () => {
    expect(
      updatePcaPumpSchema.parse({
        status: 'available',
        maintenance_event_type: 'maintenance_completed',
        maintenance_result: 'available',
        maintenance_notes: '整備完了',
      }),
    ).toMatchObject({
      status: 'available',
      maintenance_event_type: 'maintenance_completed',
      maintenance_result: 'available',
    });

    expect(
      updatePcaPumpSchema.safeParse({
        maintenance_event_type: 'maintenance_completed',
        maintenance_result: 'available',
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

  it('requires a due date for open PCA pump rentals', () => {
    expect(
      createPcaPumpRentalSchema.safeParse({
        pump_id: 'pump_1',
        institution_id: 'institution_1',
        status: 'active',
        rented_at: '2026-06-10',
      }).success,
    ).toBe(false);

    expect(
      createPcaPumpRentalSchema.safeParse({
        pump_id: 'pump_1',
        institution_id: 'institution_1',
        status: 'cancelled',
        rented_at: '2026-06-10',
      }).success,
    ).toBe(true);
  });

  it('requires returned status and returned date to match on create', () => {
    expect(
      createPcaPumpRentalSchema.safeParse({
        pump_id: 'pump_1',
        institution_id: 'institution_1',
        status: 'returned',
        rented_at: '2026-06-10',
      }).success,
    ).toBe(false);

    expect(
      createPcaPumpRentalSchema.safeParse({
        pump_id: 'pump_1',
        institution_id: 'institution_1',
        status: 'active',
        rented_at: '2026-06-10',
        due_at: '2026-06-20',
        returned_at: '2026-06-18',
      }).success,
    ).toBe(false);
  });

  it('accepts a structured return inspection checklist for passed inspections', () => {
    expect(
      updatePcaPumpRentalSchema.parse({
        status: 'returned',
        returned_at: '2026-06-18',
        return_inspection_status: 'passed',
        accessory_checklist: {
          pump_body: { status: 'ok' },
          power_adapter: { status: 'ok' },
          power_cable: { status: 'ok' },
          carrying_case: { status: 'ok' },
          manual: { status: 'not_applicable' },
          lock_key: { status: 'not_applicable' },
          clamp: { status: 'not_applicable' },
          cleaning_completed: { status: 'ok' },
          operation_check: { status: 'ok', notes: 'No alarm at startup' },
        },
      }),
    ).toMatchObject({
      return_inspection_status: 'passed',
      accessory_checklist: {
        pump_body: { status: 'ok' },
      },
    });
  });

  it('rejects passed inspections with missing or damaged accessory items', () => {
    expect(
      updatePcaPumpRentalSchema.safeParse({
        status: 'returned',
        returned_at: '2026-06-18',
        return_inspection_status: 'passed',
        accessory_checklist: {
          pump_body: { status: 'ok' },
          power_adapter: { status: 'missing', notes: 'Not returned by hospital' },
        },
      }).success,
    ).toBe(false);
  });

  it('rejects damaged or missing inspection checklist entries without notes', () => {
    expect(
      updatePcaPumpRentalSchema.safeParse({
        status: 'returned',
        returned_at: '2026-06-18',
        return_inspection_status: 'needs_maintenance',
        accessory_checklist: {
          pump_body: { status: 'damaged' },
        },
      }).success,
    ).toBe(false);
  });

  it('requires a reason when a return inspection needs maintenance', () => {
    expect(
      updatePcaPumpRentalSchema.safeParse({
        status: 'returned',
        returned_at: '2026-06-18',
        return_inspection_status: 'needs_maintenance',
        accessory_checklist: {
          pump_body: { status: 'ok' },
        },
      }).success,
    ).toBe(false);

    expect(
      updatePcaPumpRentalSchema.safeParse({
        status: 'returned',
        returned_at: '2026-06-18',
        return_inspection_status: 'needs_maintenance',
        return_inspection_notes: 'メーカー点検へ回す',
      }).success,
    ).toBe(true);
  });

  it('rejects unknown return inspection checklist keys', () => {
    expect(
      updatePcaPumpRentalSchema.safeParse({
        status: 'returned',
        returned_at: '2026-06-18',
        return_inspection_status: 'needs_maintenance',
        accessory_checklist: {
          unexpected_item: { status: 'ok' },
        },
      }).success,
    ).toBe(false);
  });
});
