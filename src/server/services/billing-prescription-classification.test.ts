import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  findLatestBillingPrescriptionClassification,
  findLatestBillingPrescriptionClassificationsByCaseIds,
} from './billing-prescription-classification';

describe('billing prescription classification read model', () => {
  it('returns latest classification when columns are available', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      prescription_category: 'emergency',
      emergency_category: 'online',
    });

    await expect(
      findLatestBillingPrescriptionClassification(
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
      findLatestBillingPrescriptionClassification(
        { prescriptionIntake: { findFirst } },
        { orgId: 'org_1', cycleId: 'cycle_1' },
      ),
    ).resolves.toBeNull();
  });

  it('returns the latest classification per case from one ordered batch query', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        prescription_category: 'emergency',
        emergency_category: 'online',
        cycle: { case_id: 'case_2' },
      },
      {
        prescription_category: 'regular',
        emergency_category: null,
        cycle: { case_id: 'case_1' },
      },
      {
        prescription_category: 'emergency',
        emergency_category: 'other_exacerbation',
        cycle: { case_id: 'case_1' },
      },
    ]);

    await expect(
      findLatestBillingPrescriptionClassificationsByCaseIds(
        { prescriptionIntake: { findMany } },
        { orgId: 'org_1', caseIds: ['case_1', 'case_2', 'case_1', 'case_3'] },
      ),
    ).resolves.toEqual(
      new Map([
        ['case_1', { prescription_category: 'regular', emergency_category: null }],
        ['case_2', { prescription_category: 'emergency', emergency_category: 'online' }],
        ['case_3', null],
      ]),
    );
    expect(findMany).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        cycle: {
          case_id: { in: ['case_1', 'case_2', 'case_3'] },
        },
      },
      orderBy: [{ created_at: 'desc' }],
      select: {
        prescription_category: true,
        emergency_category: true,
        cycle: {
          select: {
            case_id: true,
          },
        },
      },
    });
  });

  it('falls back to null entries for batch classification when columns are missing', async () => {
    const findMany = vi.fn().mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('missing column', {
        code: 'P2022',
        clientVersion: '7.6.0',
      }),
    );

    await expect(
      findLatestBillingPrescriptionClassificationsByCaseIds(
        { prescriptionIntake: { findMany } },
        { orgId: 'org_1', caseIds: ['case_1', 'case_2'] },
      ),
    ).resolves.toEqual(
      new Map([
        ['case_1', null],
        ['case_2', null],
      ]),
    );
  });
});
