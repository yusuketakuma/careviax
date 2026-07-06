import { describe, expect, it, vi } from 'vitest';
import { createCollaborationAccessRegistry } from './registry';

describe('createCollaborationAccessRegistry', () => {
  it('returns a provider for a known entity type', () => {
    const provider = {
      entityType: 'patient',
      canAccess: vi.fn(),
    };
    const registry = createCollaborationAccessRegistry([provider]);

    expect(registry.get('patient')).toBe(provider);
    expect(registry.entityTypes()).toEqual(['patient']);
  });

  it('returns null for unknown entity types', () => {
    const registry = createCollaborationAccessRegistry([
      {
        entityType: 'patient',
        canAccess: vi.fn(),
      },
    ]);

    expect(registry.get('unknown')).toBeNull();
  });

  it('rejects duplicate entity type providers', () => {
    expect(() =>
      createCollaborationAccessRegistry([
        {
          entityType: 'patient',
          canAccess: vi.fn(),
        },
        {
          entityType: 'patient',
          canAccess: vi.fn(),
        },
      ]),
    ).toThrow(/Duplicate collaboration access provider: patient/);
  });

  it('fails closed when a provider is missing or throws', async () => {
    const registry = createCollaborationAccessRegistry([
      {
        entityType: 'patient',
        canAccess: vi.fn().mockRejectedValue(new Error('database unavailable')),
      },
    ]);

    await expect(
      registry.canAccess({
        ctx: {},
        db: {},
        entityType: 'unknown',
        entityId: 'entity_1',
        orgScoped: true,
      }),
    ).resolves.toBe(false);
    await expect(
      registry.canAccess({
        ctx: {},
        db: {},
        entityType: 'patient',
        entityId: 'patient_1',
        orgScoped: true,
      }),
    ).resolves.toBe(false);
  });

  it('requires a strict true return to grant access', async () => {
    const registry = createCollaborationAccessRegistry([
      {
        entityType: 'patient',
        canAccess: vi.fn().mockResolvedValue({ allowed: true }),
      },
    ]);

    await expect(
      registry.canAccess({
        ctx: {},
        db: {},
        entityType: 'patient',
        entityId: 'patient_1',
        orgScoped: true,
      }),
    ).resolves.toBe(false);
  });
});
