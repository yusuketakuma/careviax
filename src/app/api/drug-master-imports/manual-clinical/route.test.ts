import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { z } from 'zod';

const { importManualClinicalRulesMock } = vi.hoisted(() => ({
  importManualClinicalRulesMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'admin' });
  },
  isAdmin: (role: string) => role === 'admin',
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

vi.mock('@/server/services/drug-master-import/manual', () => ({
  importManualClinicalRules: importManualClinicalRulesMock,
  manualClinicalRuleBundleSchema: z.object({
    pim_rules: z.array(z.object({ name: z.string() })).optional().default([]),
    high_risk_rules: z.array(z.object({ name: z.string() })).optional().default([]),
    renal_rules: z.array(z.object({ name: z.string() })).optional().default([]),
  }),
}));

import { POST } from './route';

describe('/api/drug-master-imports/manual-clinical', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    importManualClinicalRulesMock.mockResolvedValue({
      log: { id: 'log_1', status: 'success' },
      importedCount: 3,
      pimCount: 1,
      highRiskCount: 1,
      renalCount: 1,
    });
  });

  it('imports manual clinical rules', async () => {
    const response = (await POST({
      json: async () => ({
        pim_rules: [{ name: 'PIM A' }],
        high_risk_rules: [{ name: 'High Risk A' }],
        renal_rules: [{ name: 'Renal A' }],
      }),
    } as NextRequest, { params: Promise.resolve({}) }))!;

    expect(response.status).toBe(201);
    expect(importManualClinicalRulesMock).toHaveBeenCalledWith({}, {
      pim_rules: [{ name: 'PIM A' }],
      high_risk_rules: [{ name: 'High Risk A' }],
      renal_rules: [{ name: 'Renal A' }],
    });
  });
});
