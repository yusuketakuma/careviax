import { describe, expect, it } from 'vitest';
import {
  evaluateLightsailPilotStatus,
  type LightsailPilotStatusInput,
} from './aws-lightsail-pilot-status';

function baseInput(): LightsailPilotStatusInput {
  return {
    region: 'ap-northeast-1',
    instanceName: 'ph-os-pilot-app',
    staticIpName: 'ph-os-pilot-ip',
    databaseName: 'ph-os-pilot-db',
    instance: {
      ok: true,
      data: {
        name: 'ph-os-pilot-app',
        state: 'running',
        isStaticIp: true,
        blueprintId: 'amazon_linux_2023',
        bundleId: 'small_3_0',
      },
    },
    staticIp: {
      ok: true,
      data: {
        name: 'ph-os-pilot-ip',
        ipAddress: '203.0.113.10',
        isAttached: true,
        attachedTo: 'ph-os-pilot-app',
      },
    },
    database: {
      ok: true,
      data: {
        name: 'ph-os-pilot-db',
        state: 'available',
        publiclyAccessible: false,
        bundleId: 'small_2_0',
        blueprintId: 'postgres_16',
        endpointAddress: 'ls-db.example.ap-northeast-1.rds.amazonaws.com',
        endpointPort: 5432,
      },
    },
    portStates: {
      ok: true,
      data: [
        { fromPort: 80, toPort: 80, protocol: 'tcp', state: 'open' },
        { fromPort: 443, toPort: 443, protocol: 'tcp', state: 'open' },
      ],
    },
  };
}

describe('evaluateLightsailPilotStatus', () => {
  it('passes for a running pilot with private database and public web ports', () => {
    const report = evaluateLightsailPilotStatus(baseInput(), new Date('2026-06-17T00:00:00Z'));

    expect(report.summary).toEqual({ pass: 4, warn: 0, fail: 0 });
    expect(report.checks.map((check) => check.name)).toEqual([
      'instance',
      'static-ip',
      'database',
      'public-ports',
    ]);
  });

  it('fails when the database is publicly accessible', () => {
    const input = baseInput();
    const database = input.database;
    if (!database.ok) throw new Error('base input database must be ok');
    input.database = {
      ok: true,
      data: {
        ...database.data,
        publiclyAccessible: true,
      },
    };

    const report = evaluateLightsailPilotStatus(input);

    expect(report.summary.fail).toBe(1);
    expect(report.checks.find((check) => check.name === 'database')?.status).toBe('fail');
  });

  it('warns for missing resources and fails credential errors', () => {
    const input = baseInput();
    input.instance = {
      ok: false,
      error: { kind: 'missing', message: 'NotFoundException: instance does not exist' },
    };
    input.staticIp = {
      ok: false,
      error: { kind: 'auth', message: 'NoCredentials: Unable to locate credentials' },
    };

    const report = evaluateLightsailPilotStatus(input);

    expect(report.checks.find((check) => check.name === 'instance')?.status).toBe('warn');
    expect(report.checks.find((check) => check.name === 'static-ip')?.status).toBe('fail');
    expect(report.summary).toMatchObject({ warn: 1, fail: 1 });
  });
});
