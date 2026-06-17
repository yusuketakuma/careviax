import { describe, expect, it, vi } from 'vitest';
import {
  detectDuplicatePatientContacts,
  findPatientDuplicateCandidates,
  parsePatientDuplicateBirthDate,
} from './duplicate-detection';
import { formatUtcDateKey } from '@/lib/date-key';

describe('patient duplicate detection', () => {
  it('rejects impossible calendar dates before duplicate lookup', () => {
    expect(parsePatientDuplicateBirthDate('2026-02-31')).toBeNull();
    expect(parsePatientDuplicateBirthDate('1950-13-01')).toBeNull();
    expect(formatUtcDateKey(parsePatientDuplicateBirthDate('1950-01-01')!)).toBe('1950-01-01');
  });

  it('applies assignment scope and excludes the current patient when finding duplicates', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await findPatientDuplicateCandidates(
      {
        patient: { findMany },
      } as never,
      {
        orgId: 'org_1',
        name: '山田 太郎',
        birthDate: new Date('1950-01-01T00:00:00.000Z'),
        gender: 'male',
        excludePatientId: 'patient_current',
        access: {
          userId: 'driver_1',
          role: 'driver',
        },
      },
    );

    expect(findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        org_id: 'org_1',
        id: { not: 'patient_current' },
        AND: [
          {
            cases: {
              some: {
                OR: [
                  { primary_pharmacist_id: 'driver_1' },
                  { backup_pharmacist_id: 'driver_1' },
                  { visit_schedules: { some: { pharmacist_id: 'driver_1' } } },
                ],
              },
            },
          },
        ],
      }),
      select: {
        id: true,
        name: true,
        name_kana: true,
        birth_date: true,
        gender: true,
      },
      take: 10,
    });
  });

  it('returns PHI-free duplicate contact warnings', () => {
    const warnings = detectDuplicatePatientContacts([
      { name: '長男', relation: 'child', phone: '090-1111-1111' },
      { name: '長男', relation: 'child', phone: '090-1111-1111' },
    ]);

    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'DUPLICATE_CONTACT',
          contact_indexes: [0, 1],
        }),
      ]),
    );
    expect(JSON.stringify(warnings)).not.toMatch(/長男|090-1111-1111/);
  });
});
