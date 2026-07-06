import { describe, expect, it, vi } from 'vitest';
import { createPharmacyCollaborationAccessProviders } from './access-providers';

const orgScopedCtx = {
  orgId: 'org_1',
  userId: 'user_1',
  role: 'pharmacist' as const,
};

const scopedCtx = {
  orgId: 'org_1',
  userId: 'driver_1',
  role: 'driver' as const,
};

function createDbMock() {
  return {
    dispenseTask: { findFirst: vi.fn() },
    medicationCycle: { findFirst: vi.fn() },
    setPlan: { findFirst: vi.fn() },
  };
}

function providerByType() {
  return new Map(
    createPharmacyCollaborationAccessProviders().map((provider) => [provider.entityType, provider]),
  );
}

describe('pharmacy collaboration access providers', () => {
  it('checks dispense tasks with org scope only for org-wide roles', async () => {
    const db = createDbMock();
    db.dispenseTask.findFirst.mockResolvedValue({ id: 'dt_1' });
    const provider = providerByType().get('dispense_task');

    await expect(
      provider!.canAccess({
        ctx: orgScopedCtx,
        db,
        entityId: 'dt_1',
        orgScoped: true,
      }),
    ).resolves.toBe(true);

    expect(db.dispenseTask.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'dt_1',
        org_id: 'org_1',
      },
      select: { id: true },
    });
  });

  it('keeps medication-cycle assignment scope for scoped dispense task access', async () => {
    const db = createDbMock();
    db.dispenseTask.findFirst.mockResolvedValue({ id: 'dt_1' });
    const provider = providerByType().get('dispense_task');

    await expect(
      provider!.canAccess({
        ctx: scopedCtx,
        db,
        entityId: 'dt_1',
        orgScoped: false,
      }),
    ).resolves.toBe(true);

    expect(db.dispenseTask.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'dt_1',
        org_id: 'org_1',
        cycle: expect.objectContaining({
          case_: expect.objectContaining({
            OR: expect.any(Array),
          }),
        }),
      },
      select: { id: true },
    });
  });

  it('keeps assignment scope for medication cycle access', async () => {
    const db = createDbMock();
    db.medicationCycle.findFirst.mockResolvedValue({ id: 'mc_1' });
    const provider = providerByType().get('medication_cycle');

    await expect(
      provider!.canAccess({
        ctx: scopedCtx,
        db,
        entityId: 'mc_1',
        orgScoped: false,
      }),
    ).resolves.toBe(true);

    expect(db.medicationCycle.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'mc_1',
        org_id: 'org_1',
        case_: expect.objectContaining({
          OR: expect.any(Array),
        }),
      },
      select: { id: true },
    });
  });

  it('keeps assignment scope for set plan access', async () => {
    const db = createDbMock();
    db.setPlan.findFirst.mockResolvedValue({ id: 'sp_1' });
    const provider = providerByType().get('set_plan');

    await expect(
      provider!.canAccess({
        ctx: scopedCtx,
        db,
        entityId: 'sp_1',
        orgScoped: false,
      }),
    ).resolves.toBe(true);

    expect(db.setPlan.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'sp_1',
        org_id: 'org_1',
        cycle: expect.objectContaining({
          case_: expect.objectContaining({
            OR: expect.any(Array),
          }),
        }),
      },
      select: { id: true },
    });
  });

  it('denies missing pharmacy entities', async () => {
    const db = createDbMock();
    db.medicationCycle.findFirst.mockResolvedValue(null);
    const provider = providerByType().get('medication_cycle');

    await expect(
      provider!.canAccess({
        ctx: orgScopedCtx,
        db,
        entityId: 'mc_missing',
        orgScoped: true,
      }),
    ).resolves.toBe(false);
  });
});
