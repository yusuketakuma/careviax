import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  validateOrgReferencesMock,
  pharmacyOperatingHoursFindManyMock,
  businessHolidayFindManyMock,
  withOrgContextMock,
  txPharmacyOperatingHoursFindManyMock,
  txPharmacyOperatingHoursUpsertMock,
  txAuditLogCreateMock,
} = vi.hoisted(() => ({
  validateOrgReferencesMock: vi.fn(),
  pharmacyOperatingHoursFindManyMock: vi.fn(),
  businessHolidayFindManyMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  txPharmacyOperatingHoursFindManyMock: vi.fn(),
  txPharmacyOperatingHoursUpsertMock: vi.fn(),
  txAuditLogCreateMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => Promise<Response>) => {
    return (req: NextRequest, routeContext?: unknown) =>
      handler(
        req,
        {
          orgId: 'org_1',
          userId: 'user_1',
          role: 'admin',
          ipAddress: '127.0.0.1',
          userAgent: 'vitest',
        },
        routeContext,
      );
  },
}));

vi.mock('@/lib/api/org-reference', () => ({
  validateOrgReferences: validateOrgReferencesMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    pharmacyOperatingHours: {
      findMany: pharmacyOperatingHoursFindManyMock,
    },
    businessHoliday: {
      findMany: businessHolidayFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET as rawGET, PUT as rawPUT } from './route';
import type { PharmacyOperatingHoursPutInput } from '@/lib/validations/pharmacy-operating-hours';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);
const PUT = (req: NextRequest) => rawPUT(req, emptyRouteContext);

function createGetRequest(search = '') {
  return new NextRequest(`http://localhost/api/pharmacy-operating-hours${search}`);
}

function createPutRequest(body: unknown) {
  return new NextRequest('http://localhost/api/pharmacy-operating-hours', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createMalformedPutRequest() {
  return new NextRequest('http://localhost/api/pharmacy-operating-hours', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: '{bad-json',
  });
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

function weeklyRows(): PharmacyOperatingHoursPutInput['rows'] {
  return Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    is_open: weekday !== 0,
    open_time: weekday === 0 ? null : '09:00',
    close_time: weekday === 0 ? null : '18:00',
    note: weekday === 0 ? '日曜定休' : '',
  }));
}

function dbRow(weekday: number) {
  return {
    id: `hours_${weekday}`,
    site_id: 'site_1',
    weekday,
    is_open: true,
    open_time: new Date('1970-01-01T09:00:00.000Z'),
    close_time: new Date('1970-01-01T18:00:00.000Z'),
    note: null,
    updated_at: new Date('2026-06-27T00:00:00.000Z'),
  };
}

describe('/api/pharmacy-operating-hours', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateOrgReferencesMock.mockResolvedValue({ ok: true });
    pharmacyOperatingHoursFindManyMock.mockResolvedValue([dbRow(1)]);
    businessHolidayFindManyMock.mockResolvedValue([]);
    txPharmacyOperatingHoursFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(Array.from({ length: 7 }, (_, weekday) => dbRow(weekday)));
    txPharmacyOperatingHoursUpsertMock.mockImplementation(({ create }) =>
      Promise.resolve({ id: `hours_${create.weekday}`, ...create }),
    );
    txAuditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        pharmacyOperatingHours: {
          findMany: txPharmacyOperatingHoursFindManyMock,
          upsert: txPharmacyOperatingHoursUpsertMock,
        },
        auditLog: {
          create: txAuditLogCreateMock,
        },
      }),
    );
  });

  it('returns weekly rows with visible default fallback rows', async () => {
    const response = (await GET(createGetRequest('?site_id=site_1')))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', { site_id: 'site_1' });
    expect(pharmacyOperatingHoursFindManyMock).toHaveBeenCalledWith({
      where: { org_id: 'org_1', site_id: 'site_1' },
      orderBy: [{ weekday: 'asc' }],
    });
    expect(businessHolidayFindManyMock).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.data.weekly).toHaveLength(7);
    expect(body.data.weekly[0]).toMatchObject({
      site_id: 'site_1',
      weekday: 0,
      configured: false,
      source: 'default',
      is_open: true,
      open_time: null,
      close_time: null,
    });
    expect(body.data.weekly[1]).toMatchObject({
      id: 'hours_1',
      configured: true,
      source: 'stored',
      open_time: '09:00',
      close_time: '18:00',
    });
  });

  it('returns resolved days using org-wide and site-specific holiday rows', async () => {
    pharmacyOperatingHoursFindManyMock.mockResolvedValueOnce([dbRow(6)]);
    businessHolidayFindManyMock.mockResolvedValueOnce([
      {
        id: 'holiday_org',
        date: new Date('2026-06-27T00:00:00.000Z'),
        site_id: null,
        name: '全店休業',
        holiday_type: 'org_event',
        is_closed: true,
        open_time: null,
        close_time: null,
      },
      {
        id: 'holiday_site',
        date: new Date('2026-06-28T00:00:00.000Z'),
        site_id: 'site_1',
        name: '臨時営業',
        holiday_type: 'site_closure',
        is_closed: false,
        open_time: new Date('1970-01-01T10:00:00.000Z'),
        close_time: new Date('1970-01-01T12:00:00.000Z'),
      },
    ]);

    const response = (await GET(
      createGetRequest('?site_id=site_1&date_from=2026-06-27&date_to=2026-06-28'),
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(businessHolidayFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        date: {
          gte: new Date('2026-06-27'),
          lte: new Date('2026-06-28'),
        },
        OR: [{ site_id: 'site_1' }, { site_id: null }],
      },
      orderBy: [{ date: 'asc' }, { site_id: 'asc' }],
    });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        holidays: [
          {
            id: 'holiday_org',
            date: '2026-06-27',
            site_id: null,
            is_closed: true,
          },
          {
            id: 'holiday_site',
            date: '2026-06-28',
            site_id: 'site_1',
            is_closed: false,
            open_time: '10:00',
            close_time: '12:00',
          },
        ],
        resolved_days: [
          {
            date: '2026-06-27',
            open: false,
            source: 'holiday',
            reason: 'holiday',
          },
          {
            date: '2026-06-28',
            open: true,
            source: 'holiday',
            from: '10:00',
            to: '12:00',
          },
        ],
      },
    });
  });

  it('rejects invalid GET queries before DB reads', async () => {
    const response = (await GET(createGetRequest('?site_id=site_1&date_from=2026-02-31')))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        date_from: expect.arrayContaining(['日付形式が不正です（YYYY-MM-DD）']),
      },
    });
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(pharmacyOperatingHoursFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects duplicate GET query parameters before DB reads', async () => {
    const response = (await GET(createGetRequest('?site_id=site_1&site_id=site_2')))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        site_id: ['site_id は1つだけ指定してください'],
      },
    });
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(pharmacyOperatingHoursFindManyMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when weekly rows fail to load', async () => {
    pharmacyOperatingHoursFindManyMock.mockRejectedValueOnce(
      new Error('raw operating hours secret'),
    );

    const response = (await GET(createGetRequest('?site_id=site_1')))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const bodyText = await response.text();
    expect(bodyText).toContain('INTERNAL_ERROR');
    expect(bodyText).not.toContain('raw operating hours secret');
  });

  it('upserts exactly seven rows, converts HH:mm to DB time, and records one audit entry', async () => {
    const response = (await PUT(createPutRequest({ site_id: 'site_1', rows: weeklyRows() })))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', { site_id: 'site_1' });
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function));
    expect(txPharmacyOperatingHoursUpsertMock).toHaveBeenCalledTimes(7);
    expect(txPharmacyOperatingHoursUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { site_id_weekday: { site_id: 'site_1', weekday: 1 } },
        create: expect.objectContaining({
          org_id: 'org_1',
          site_id: 'site_1',
          weekday: 1,
          open_time: new Date('1970-01-01T09:00:00.000Z'),
          close_time: new Date('1970-01-01T18:00:00.000Z'),
        }),
        update: expect.objectContaining({
          is_open: true,
          open_time: new Date('1970-01-01T09:00:00.000Z'),
          close_time: new Date('1970-01-01T18:00:00.000Z'),
        }),
      }),
    );
    expect(txPharmacyOperatingHoursUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { site_id_weekday: { site_id: 'site_1', weekday: 0 } },
        create: expect.objectContaining({
          is_open: false,
          open_time: null,
          close_time: null,
          note: '日曜定休',
        }),
      }),
    );
    expect(txAuditLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'pharmacy_operating_hours_updated',
          target_type: 'PharmacyOperatingHours',
          target_id: 'site_1',
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        site_id: 'site_1',
        weekly: expect.arrayContaining([
          expect.objectContaining({
            weekday: 1,
            open_time: '09:00',
            close_time: '18:00',
            configured: true,
          }),
        ]),
      },
    });
  });

  it('rejects invalid PUT rows before reference checks or writes', async () => {
    const invalidRows = weeklyRows();
    invalidRows[1] = {
      weekday: 1,
      is_open: true,
      open_time: '18:00',
      close_time: '09:00',
      note: null,
    };

    const response = (await PUT(createPutRequest({ site_id: 'site_1', rows: invalidRows })))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        rows: expect.any(Array),
      },
    });
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects missing or duplicate weekdays before writes', async () => {
    const duplicateRows = weeklyRows();
    duplicateRows[6] = { ...duplicateRows[6]!, weekday: 5 };

    const response = (await PUT(createPutRequest({ site_id: 'site_1', rows: duplicateRows })))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON PUT payloads before writes', async () => {
    const response = (await PUT(createMalformedPutRequest()))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });
});
