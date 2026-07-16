import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { operationsInsightsResponseSchema } from '@/lib/analytics/operations-insights-response-schema';

const authState = vi.hoisted(() => ({ orgId: '' }));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext:
    (handler: (req: NextRequest, ctx: { orgId: string }) => Promise<Response>) =>
    (req: NextRequest) =>
      handler(req, { orgId: authState.orgId }),
}));

import { prisma } from '@/lib/db/client';
import { GET } from './route';

describe.runIf(process.env.OPERATIONS_INSIGHTS_DATABASE_INTEGRATION === '1')(
  '/api/admin/operations-insights PostgreSQL integration',
  () => {
    beforeAll(async () => {
      const organization = await prisma.organization.findFirst({ select: { id: true } });
      if (!organization) throw new Error('An organization fixture is required');
      authState.orgId = organization.id;
    });

    afterAll(async () => {
      await prisma.$disconnect();
    });

    it('executes all bounded aggregates against PostgreSQL and returns the strict response contract', async () => {
      const response = await GET(
        new NextRequest('http://localhost/api/admin/operations-insights'),
        {
          params: Promise.resolve({}),
        },
      );
      expect(response?.status).toBe(200);
      const body = await response?.json();
      expect(() => operationsInsightsResponseSchema.parse(body)).not.toThrow();
      expect(body.data.monthly_visits).toHaveLength(5);
      expect(body.data.processes).toHaveLength(5);
    });
  },
);
