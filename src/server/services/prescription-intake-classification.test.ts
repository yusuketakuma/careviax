import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { findLatestPrescriptionIntakeClassification } from './prescription-intake-classification';

describe('findLatestPrescriptionIntakeClassification', () => {
  it('returns latest classification when columns are available', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      prescription_category: 'emergency',
      emergency_category: 'online',
    });

    await expect(
      findLatestPrescriptionIntakeClassification(
        { prescriptionIntake: { findFirst } },
        { orgId: 'org_1', caseId: 'case_1' },
      ),
    ).resolves.toEqual({
      prescription_category: 'emergency',
      emergency_category: 'online',
    });
  });

  it('falls back to null when the database is missing new classification columns', async () => {
    const findFirst = vi.fn().mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('missing column', {
        code: 'P2022',
        clientVersion: '7.6.0',
      }),
    );

    await expect(
      findLatestPrescriptionIntakeClassification(
        { prescriptionIntake: { findFirst } },
        { orgId: 'org_1', cycleId: 'cycle_1' },
      ),
    ).resolves.toBeNull();
  });
});
