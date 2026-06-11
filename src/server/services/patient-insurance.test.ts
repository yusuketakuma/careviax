import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { resolvePatientInsurance } from './patient-insurance';

const ORIGINAL_TZ = process.env.TZ;

function createReader() {
  const findFirst = vi.fn().mockResolvedValue(null);
  return { reader: { patientInsurance: { findFirst } }, findFirst };
}

describe('resolvePatientInsurance', () => {
  beforeAll(() => {
    process.env.TZ = 'Asia/Tokyo';
  });

  afterAll(() => {
    if (ORIGINAL_TZ === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = ORIGINAL_TZ;
    }
  });

  it('JST 朝(UTC では前日)でも valid_from/valid_until(@db.Date)を当日 UTC 深夜で比較する', async () => {
    const { reader, findFirst } = createReader();

    // JST 2026-06-12 08:00(UTC では 2026-06-11T23:00Z)
    await resolvePatientInsurance(reader, {
      orgId: 'org_1',
      patientId: 'patient_1',
      type: 'medical',
      asOf: new Date('2026-06-12T08:00:00+09:00'),
    });

    const where = findFirst.mock.calls[0][0].where;
    const expected = new Date('2026-06-12T00:00:00.000Z');
    expect(where.OR).toEqual([{ valid_from: null }, { valid_from: { lte: expected } }]);
    expect(where.AND).toEqual([
      { OR: [{ valid_until: null }, { valid_until: { gte: expected } }] },
    ]);
  });

  it('asOf 省略時は現在時刻のローカル日付を基準にする', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T23:30:00+09:00'));
    try {
      const { reader, findFirst } = createReader();
      await resolvePatientInsurance(reader, {
        orgId: 'org_1',
        patientId: 'patient_1',
        type: 'care',
      });

      const where = findFirst.mock.calls[0][0].where;
      expect(where.OR[1].valid_from.lte.toISOString()).toBe('2026-06-12T00:00:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });
});
