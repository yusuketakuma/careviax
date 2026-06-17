import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { estimateScenarios, parseCostConfig } from './aws-cost-estimate';

describe('aws cost estimate', () => {
  it('calculates monthly and annual totals for selected scenarios', () => {
    const config = parseCostConfig({
      metadata: {
        currency: 'USD',
        region: 'ap-northeast-1',
        hoursPerMonth: 730,
        updatedAt: '2026-06-17',
        sources: ['https://aws.amazon.com/lightsail/pricing/'],
      },
      scenarios: [
        {
          id: 'pilot',
          name: 'Pilot',
          description: 'Pilot scenario',
          items: [
            { name: 'compute', monthlyUsd: 12 },
            { name: 'database', monthlyUsd: 30.125 },
          ],
          notes: ['not HA'],
        },
        {
          id: 'production',
          name: 'Production',
          description: 'Production scenario',
          items: [{ name: 'compute', monthlyUsd: 100 }],
        },
      ],
    });

    expect(estimateScenarios(config, 'pilot')).toEqual([
      {
        id: 'pilot',
        name: 'Pilot',
        description: 'Pilot scenario',
        monthlyUsd: 42.13,
        annualUsd: 505.56,
        items: [
          { name: 'compute', monthlyUsd: 12 },
          { name: 'database', monthlyUsd: 30.125 },
        ],
        notes: ['not HA'],
      },
    ]);
  });

  it('rejects missing scenario ids', () => {
    const config = parseCostConfig({
      metadata: {
        currency: 'USD',
        region: 'ap-northeast-1',
        hoursPerMonth: 730,
        updatedAt: '2026-06-17',
        sources: ['https://aws.amazon.com/lightsail/pricing/'],
      },
      scenarios: [
        {
          id: 'pilot',
          name: 'Pilot',
          description: 'Pilot scenario',
          items: [{ name: 'compute', monthlyUsd: 12 }],
        },
      ],
    });

    expect(() => estimateScenarios(config, 'missing')).toThrow('Unknown cost scenario: missing');
  });

  it('rejects negative line items', () => {
    expect(() =>
      parseCostConfig({
        metadata: {
          currency: 'USD',
          region: 'ap-northeast-1',
          hoursPerMonth: 730,
          updatedAt: '2026-06-17',
          sources: ['https://aws.amazon.com/lightsail/pricing/'],
        },
        scenarios: [
          {
            id: 'pilot',
            name: 'Pilot',
            description: 'Pilot scenario',
            items: [{ name: 'compute', monthlyUsd: -1 }],
          },
        ],
      }),
    ).toThrow('monthlyUsd must be a non-negative finite number');
  });

  it('keeps the committed AWS scenario set aligned with current AWS container guidance', () => {
    const config = parseCostConfig(
      JSON.parse(readFileSync('tools/aws-cost-minimal-scenarios.json', 'utf8')),
    );
    const scenarioIds = config.scenarios.map((scenario) => scenario.id);
    const ecsEstimate = estimateScenarios(config, 'ecs-express-role-capable-minimum')[0];

    expect(scenarioIds).toContain('lightsail-pilot-encrypted-db');
    expect(scenarioIds).toContain('ecs-express-role-capable-minimum');
    expect(scenarioIds).not.toContain('app-runner-managed-minimum');
    expect(config.metadata.sources).toContain(
      'https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html',
    );
    expect(config.metadata.sources).toContain(
      'https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-overview.html',
    );
    expect(ecsEstimate.monthlyUsd).toBe(76.42);
    expect(ecsEstimate.notes.join(' ')).toContain('App Runner is no longer open to new customers');
  });
});
