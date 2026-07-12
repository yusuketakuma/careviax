import { describe, expect, it } from 'vitest';
import {
  buildPcaPumpRentalsResponseSchema,
  buildPcaPumpsResponseSchema,
  pcaPumpInstitutionOptionsResponseSchema,
} from './response-schema';

const institution = {
  id: 'institution_1',
  name: '在宅クリニック',
  institution_code: '1312345678',
};

const pump = {
  id: 'pump_1',
  asset_code: 'PCA-001',
  serial_number: 'SERIAL-1',
  model_name: 'PCA Model',
  manufacturer: 'Maker',
  status: 'rented',
  maintenance_due_at: '2026-12-31',
  notes: null,
  maintenance_events: [],
  rentals: [
    {
      id: 'rental_1',
      status: 'active',
      due_at: '2026-06-30',
      institution,
    },
  ],
};

const rental = {
  id: 'rental_1',
  status: 'returned',
  rented_at: '2026-06-01',
  due_at: '2026-06-07',
  returned_at: '2026-06-08',
  return_inspection_status: 'pending',
  return_inspection_notes: null,
  accessory_checklist: null,
  inspected_at: null,
  inspected_by: null,
  rental_fee_yen: 12_000,
  contact_name: null,
  contact_phone: null,
  pump: {
    id: 'pump_1',
    asset_code: 'PCA-001',
    serial_number: 'SERIAL-1',
    model_name: 'PCA Model',
    status: 'maintenance',
  },
  institution: { ...institution, phone: null, fax: null },
};

describe('buildPcaPumpsResponseSchema', () => {
  it('accepts a rented pump with one open rental', () => {
    expect(buildPcaPumpsResponseSchema(false).safeParse({ data: [pump] }).success).toBe(true);
  });

  it('rejects lifecycle and asset identity drift', () => {
    expect(
      buildPcaPumpsResponseSchema(false).safeParse({
        data: [{ ...pump, status: 'available' }],
      }).success,
    ).toBe(false);
    expect(
      buildPcaPumpsResponseSchema(false).safeParse({
        data: [pump, { ...pump, id: 'pump_2' }],
      }).success,
    ).toBe(false);
  });
});

describe('buildPcaPumpRentalsResponseSchema', () => {
  it('accepts the requested returned/pending inspection state', () => {
    const schema = buildPcaPumpRentalsResponseSchema({
      statuses: ['returned'],
      inspectionStatus: 'pending',
    });
    expect(schema.safeParse({ data: [rental] }).success).toBe(true);
  });

  it('rejects invalid date and inspection lifecycle combinations', () => {
    const schema = buildPcaPumpRentalsResponseSchema({ statuses: ['returned'] });
    expect(schema.safeParse({ data: [{ ...rental, returned_at: null }] }).success).toBe(false);
    expect(
      schema.safeParse({
        data: [{ ...rental, status: 'active', return_inspection_status: 'pending' }],
      }).success,
    ).toBe(false);
  });
});

describe('pcaPumpInstitutionOptionsResponseSchema', () => {
  it('strips unused institution contact and prescription metadata', () => {
    expect(
      pcaPumpInstitutionOptionsResponseSchema.parse({
        data: [{ ...institution, address: '東京都', notes: 'internal', prescription_count: 10 }],
      }),
    ).toEqual({ data: [institution] });
  });
});
