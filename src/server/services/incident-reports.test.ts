import { beforeEach, describe, expect, it, vi } from 'vitest';

const { incidentFindFirstMock, incidentFindManyMock, incidentCreateMock, incidentUpdateMock } =
  vi.hoisted(() => ({
    incidentFindFirstMock: vi.fn(),
    incidentFindManyMock: vi.fn(),
    incidentCreateMock: vi.fn(),
    incidentUpdateMock: vi.fn(),
  }));

const auditLogCreateMock = vi.hoisted(() => vi.fn());
const withOrgContextMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db/client', () => ({
  prisma: {
    incidentReport: {
      findFirst: incidentFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import {
  buildIncidentAuditChanges,
  buildIncidentCreateData,
  buildIncidentUpdateData,
  createIncidentReport,
  listIncidentReports,
  updateIncidentReport,
} from './incident-reports';

const ctx = {
  orgId: 'org_1',
  userId: 'user_1',
  ipAddress: '127.0.0.1',
  userAgent: 'vitest',
};

function report(overrides: Record<string, unknown> = {}) {
  return {
    id: 'incident_1',
    title: 'セット日付間違い',
    what_happened: '土曜セットに金曜の薬を入れた',
    cause: 'カレンダー確認漏れ',
    immediate_action: '訪問前に差し替え',
    prevention_plan: '二人で日付確認',
    related_process: 'set',
    severity: 'near_miss',
    status: 'open',
    occurred_at: null,
    reported_by: 'user_1',
    created_at: new Date('2026-06-13T00:00:00.000Z'),
    updated_at: new Date('2026-06-13T00:00:00.000Z'),
    ...overrides,
  };
}

describe('incident report service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withOrgContextMock.mockImplementation(
      async (_orgId: string, callback: (tx: unknown) => unknown) =>
        callback({
          incidentReport: {
            findMany: incidentFindManyMock,
            create: incidentCreateMock,
            update: incidentUpdateMock,
          },
          auditLog: { create: auditLogCreateMock },
        }),
    );
    incidentFindManyMock.mockResolvedValue([]);
    incidentCreateMock.mockResolvedValue(report());
    incidentUpdateMock.mockResolvedValue(report({ status: 'reviewed' }));
    incidentFindFirstMock.mockResolvedValue({ id: 'incident_1' });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
  });

  it('lists reports through org-scoped RLS context', async () => {
    await listIncidentReports({ orgId: 'org_1' }, 'open');

    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function));
    expect(incidentFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { org_id: 'org_1', status: 'open' },
        orderBy: [{ created_at: 'desc' }],
        take: 100,
      }),
    );
  });

  it('normalizes create input without putting memo body in audit changes', async () => {
    const input = {
      title: ' セット日付間違い ',
      what_happened: '自由記述の本文',
      cause: undefined,
      immediate_action: null,
      prevention_plan: '二人で日付確認',
      related_process: 'set' as const,
      severity: 'level1' as const,
      occurred_at: '2026-06-13T09:00:00.000+09:00',
    };

    expect(buildIncidentCreateData(ctx, input)).toMatchObject({
      org_id: 'org_1',
      reported_by: 'user_1',
      title: ' セット日付間違い ',
      what_happened: '自由記述の本文',
      cause: null,
      immediate_action: null,
      prevention_plan: '二人で日付確認',
      related_process: 'set',
      severity: 'level1',
      occurred_at: new Date('2026-06-13T09:00:00.000+09:00'),
    });

    await createIncidentReport(ctx, input);

    expect(incidentCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ what_happened: '自由記述の本文' }),
      }),
    );
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'incident_report_created',
        target_type: 'IncidentReport',
        changes: {
          title: 'セット日付間違い',
          severity: 'near_miss',
          status: 'open',
          related_process: 'set',
        },
      }),
    });
    expect(JSON.stringify(auditLogCreateMock.mock.calls[0][0].data.changes)).not.toContain(
      '自由記述',
    );
  });

  it('builds sparse update data and audits only safe fields plus updated field names', async () => {
    const input = {
      what_happened: '本文変更',
      cause: null,
      status: 'reviewed' as const,
    };

    expect(buildIncidentUpdateData(input)).toEqual({
      what_happened: '本文変更',
      cause: null,
      status: 'reviewed',
    });

    await updateIncidentReport(ctx, 'incident_1', input);

    expect(incidentFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'incident_1', org_id: 'org_1' },
      select: { id: true },
    });
    expect(incidentUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'incident_1' },
        data: { what_happened: '本文変更', cause: null, status: 'reviewed' },
      }),
    );
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'incident_report_updated',
        changes: {
          title: 'セット日付間違い',
          severity: 'near_miss',
          status: 'reviewed',
          related_process: 'set',
          updated_fields: ['what_happened', 'cause', 'status'],
        },
      }),
    });
    expect(JSON.stringify(auditLogCreateMock.mock.calls[0][0].data.changes)).not.toContain(
      '本文変更',
    );
  });

  it('returns null without writing when the report is outside the org scope', async () => {
    incidentFindFirstMock.mockResolvedValueOnce(null);

    await expect(updateIncidentReport(ctx, 'missing', { status: 'reviewed' })).resolves.toBeNull();

    expect(incidentUpdateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('keeps audit changes limited to metadata', () => {
    expect(
      buildIncidentAuditChanges(
        {
          title: '表題',
          severity: 'near_miss',
          status: 'open',
          related_process: 'audit',
        },
        ['prevention_plan'],
      ),
    ).toEqual({
      title: '表題',
      severity: 'near_miss',
      status: 'open',
      related_process: 'audit',
      updated_fields: ['prevention_plan'],
    });
  });
});
