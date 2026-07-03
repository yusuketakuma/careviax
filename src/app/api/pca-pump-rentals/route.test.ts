import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  pcaPumpFindFirstMock,
  prescriberInstitutionFindFirstMock,
  pcaPumpRentalFindManyMock,
  pcaPumpRentalCreateMock,
  pcaPumpRentalAccessoryCreateManyMock,
  pcaPumpUpdateManyMock,
  auditLogCreateMock,
  withOrgContextMock,
  loggerErrorMock,
  allocateDisplayIdMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  pcaPumpFindFirstMock: vi.fn(),
  prescriberInstitutionFindFirstMock: vi.fn(),
  pcaPumpRentalFindManyMock: vi.fn(),
  pcaPumpRentalCreateMock: vi.fn(),
  pcaPumpRentalAccessoryCreateManyMock: vi.fn(),
  pcaPumpUpdateManyMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  allocateDisplayIdMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    pharmacySite: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    pcaPump: {
      findFirst: pcaPumpFindFirstMock,
    },
    prescriberInstitution: {
      findFirst: prescriberInstitutionFindFirstMock,
    },
    pcaPumpRental: {
      findMany: pcaPumpRentalFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/db/display-id', () => ({
  allocateDisplayId: allocateDisplayIdMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: loggerErrorMock,
  },
}));

import { GET as rawGET, POST as rawPOST } from './route';
import { expectNoStore } from '@/test/api-response-assertions';

const GET = (req: NextRequest) => rawGET(req);
const POST = (req: NextRequest) => rawPOST(req);

function createRequest(url: string, body?: unknown) {
  return new NextRequest(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers:
      body === undefined
        ? { 'x-org-id': 'org_1' }
        : { 'content-type': 'application/json', 'x-org-id': 'org_1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/pca-pump-rentals', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-org-id': 'org_1' },
    body: '{',
  });
}

const rentalRecord = {
  id: 'rental_1',
  org_id: 'org_1',
  pump_id: 'pump_1',
  institution_id: 'institution_1',
  status: 'active',
  rented_at: new Date('2026-06-10T00:00:00.000Z'),
  due_at: new Date('2026-06-20T00:00:00.000Z'),
  returned_at: null,
  contact_name: '山田看護師',
  contact_phone: '03-1234-5678',
  rental_fee_yen: 12000,
  notes: null,
  created_at: new Date('2026-06-10T01:00:00.000Z'),
  updated_at: new Date('2026-06-10T01:00:00.000Z'),
  pump: {
    id: 'pump_1',
    asset_code: 'PCA-001',
    serial_number: 'SN-001',
    model_name: 'CADD Legacy PCA',
    status: 'rented',
  },
  institution: {
    id: 'institution_1',
    name: 'みなと病院',
    institution_code: '1234567',
    phone: '03-1111-2222',
    fax: null,
  },
};

describe('/api/pca-pump-rentals', () => {
  const originalTimeZone = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = 'Asia/Tokyo';
  });

  afterAll(() => {
    if (originalTimeZone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimeZone;
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin', site_id: null });
    pcaPumpFindFirstMock.mockResolvedValue({ id: 'pump_1', status: 'available' });
    prescriberInstitutionFindFirstMock.mockResolvedValue({ id: 'institution_1' });
    pcaPumpRentalFindManyMock.mockResolvedValue([rentalRecord]);
    pcaPumpRentalCreateMock.mockResolvedValue({
      ...rentalRecord,
      display_id: 'pcar0000000001',
    });
    allocateDisplayIdMock.mockResolvedValue('pcar0000000001');
    pcaPumpRentalAccessoryCreateManyMock.mockResolvedValue({ count: 9 });
    pcaPumpUpdateManyMock.mockResolvedValue({ count: 1 });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        pcaPumpRental: {
          findMany: pcaPumpRentalFindManyMock,
          create: pcaPumpRentalCreateMock,
        },
        pcaPumpRentalAccessory: {
          createMany: pcaPumpRentalAccessoryCreateManyMock,
        },
        pcaPump: {
          findFirst: pcaPumpFindFirstMock,
          updateMany: pcaPumpUpdateManyMock,
        },
        prescriberInstitution: {
          findFirst: prescriberInstitutionFindFirstMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it('lists PCA pump rentals scoped to org and status', async () => {
    const response = await GET(
      createRequest('http://localhost/api/pca-pump-rentals?status=active'),
    );

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({ orgId: 'org_1' }),
      maxWaitMs: 10_000,
      timeoutMs: 20_000,
    });
    expect(pcaPumpRentalFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          status: 'active',
        },
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          id: 'rental_1',
          rented_at: '2026-06-10',
          due_at: '2026-06-20',
          pump: { asset_code: 'PCA-001' },
          institution: { name: 'みなと病院' },
        },
      ],
    });
  });

  it('lists only open PCA pump rentals for operational queues', async () => {
    const response = await GET(createRequest('http://localhost/api/pca-pump-rentals?status=open'));

    expect(response.status).toBe(200);
    expect(pcaPumpRentalFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          status: { in: ['scheduled', 'active', 'overdue'] },
        },
      }),
    );
  });

  it('filters returned PCA pump rentals by return inspection status', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/pca-pump-rentals?status=returned&inspection_status=pending',
      ),
    );

    expect(response.status).toBe(200);
    expect(pcaPumpRentalFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          status: 'returned',
          return_inspection_status: 'pending',
        },
      }),
    );
  });

  it('rejects invalid rental status filters', async () => {
    const response = await GET(
      createRequest('http://localhost/api/pca-pump-rentals?status=broken'),
    );

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(pcaPumpRentalFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects invalid return inspection status filters', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/pca-pump-rentals?status=returned&inspection_status=unknown',
      ),
    );

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(pcaPumpRentalFindManyMock).not.toHaveBeenCalled();
  });

  it.each([
    ['empty', 'http://localhost/api/pca-pump-rentals?institution_id='],
    ['blank', 'http://localhost/api/pca-pump-rentals?institution_id=%20%20'],
  ])('rejects %s institution filters before querying rentals', async (_label, url) => {
    const response = await GET(createRequest(url));

    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '貸出先医療機関の指定が不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pcaPumpRentalFindManyMock).not.toHaveBeenCalled();
  });

  it('trims valid institution filters before querying rentals', async () => {
    const response = await GET(
      createRequest('http://localhost/api/pca-pump-rentals?institution_id=%20institution_1%20'),
    );

    expect(response.status).toBe(200);
    expect(pcaPumpRentalFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          institution_id: 'institution_1',
        },
      }),
    );
  });

  it('returns a sanitized no-store 500 when PCA pump rental listing fails unexpectedly', async () => {
    pcaPumpRentalFindManyMock.mockRejectedValueOnce(
      new Error('raw PCA rental contact phone serial secret'),
    );

    const response = await GET(createRequest('http://localhost/api/pca-pump-rentals'));

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
    });
    expect(JSON.stringify(body)).not.toContain('contact phone serial secret');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'route_handler_unhandled_error',
        route: '/api/pca-pump-rentals',
        method: 'GET',
      }),
      expect.any(Error),
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('contact phone serial secret');
  });

  it('returns no-store auth failure before parsing POST body or reading PCA references', async () => {
    authMock.mockResolvedValueOnce(null);

    const response = await POST(createMalformedJsonRequest());

    expect(response.status).toBe(401);
    expectNoStore(response);
    expect(membershipFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(allocateDisplayIdMock).not.toHaveBeenCalled();
    expect(pcaPumpFindFirstMock).not.toHaveBeenCalled();
    expect(prescriberInstitutionFindFirstMock).not.toHaveBeenCalled();
    expect(pcaPumpRentalCreateMock).not.toHaveBeenCalled();
  });

  it('creates a rental and marks the pump as rented in the same org transaction', async () => {
    pcaPumpRentalCreateMock.mockResolvedValue({
      ...rentalRecord,
      rented_at: new Date('2026-06-09T15:30:00.000Z'),
      due_at: new Date('2026-06-19T15:30:00.000Z'),
    });

    const response = await POST(
      createRequest('http://localhost/api/pca-pump-rentals', {
        pump_id: 'pump_1',
        institution_id: 'institution_1',
        rented_at: '2026-06-10',
        due_at: '2026-06-20',
        contact_name: '山田看護師',
        contact_phone: '03-1234-5678',
        rental_fee_yen: 12000,
      }),
    );

    expect(response.status).toBe(201);
    expect(pcaPumpFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'pump_1', org_id: 'org_1' },
      select: { id: true, status: true },
    });
    expect(prescriberInstitutionFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'institution_1', org_id: 'org_1' },
      select: { id: true },
    });
    expect(pcaPumpRentalCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        display_id: 'pcar0000000001',
        pump_id: 'pump_1',
        institution_id: 'institution_1',
        status: 'active',
        rented_at: new Date('2026-06-10'),
        due_at: new Date('2026-06-20'),
        contact_name: '山田看護師',
        contact_phone: '03-1234-5678',
        rental_fee_yen: 12000,
      }),
      include: {
        pump: true,
        institution: true,
      },
    });
    expect(allocateDisplayIdMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pcaPumpRental: expect.objectContaining({ create: pcaPumpRentalCreateMock }),
        pcaPump: expect.objectContaining({ updateMany: pcaPumpUpdateManyMock }),
      }),
      'PcaPumpRental',
      'org_1',
    );
    expect(pcaPumpUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'pump_1',
        org_id: 'org_1',
        status: 'available',
      },
      data: { status: 'rented' },
    });
    expect(pcaPumpRentalAccessoryCreateManyMock).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          org_id: 'org_1',
          rental_id: 'rental_1',
          accessory_key: 'pump_body',
          name: 'ポンプ本体',
          discrepancy_status: 'unchecked',
        }),
      ]),
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        actor_id: 'user_1',
        action: 'pca_pump_rental_created',
        target_type: 'PcaPumpRental',
        target_id: 'rental_1',
        changes: expect.objectContaining({
          pump_id: 'pump_1',
          institution_id: 'institution_1',
          status: 'active',
          rented_at: '2026-06-10',
          due_at: '2026-06-20',
          returned_at: null,
        }),
      }),
    });
  });

  it('rejects open rentals without a due date', async () => {
    const response = await POST(
      createRequest('http://localhost/api/pca-pump-rentals', {
        pump_id: 'pump_1',
        institution_id: 'institution_1',
        status: 'active',
        rented_at: '2026-06-10',
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '入力値が不正です',
      details: {
        due_at: ['貸出中・予定・延滞のPCAポンプには返却予定日が必須です'],
      },
    });
    expect(pcaPumpFindFirstMock).not.toHaveBeenCalled();
    expect(allocateDisplayIdMock).not.toHaveBeenCalled();
    expect(pcaPumpRentalCreateMock).not.toHaveBeenCalled();
  });

  it('creates a returned rental with pending inspection and marks the pump maintenance', async () => {
    pcaPumpRentalCreateMock.mockResolvedValue({
      ...rentalRecord,
      status: 'returned',
      rented_at: new Date('2026-06-09T15:30:00.000Z'),
      due_at: null,
      returned_at: new Date('2026-06-17T15:30:00.000Z'),
      return_inspection_status: 'pending',
      pump: { ...rentalRecord.pump, status: 'maintenance' },
    });

    const response = await POST(
      createRequest('http://localhost/api/pca-pump-rentals', {
        pump_id: 'pump_1',
        institution_id: 'institution_1',
        status: 'returned',
        rented_at: '2026-06-10',
        returned_at: '2026-06-18',
      }),
    );

    expect(response.status).toBe(201);
    expect(pcaPumpUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'pump_1',
        org_id: 'org_1',
        status: 'available',
      },
      data: { status: 'maintenance' },
    });
    expect(pcaPumpRentalCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        display_id: 'pcar0000000001',
        status: 'returned',
        returned_at: new Date('2026-06-18'),
        return_inspection_status: 'pending',
      }),
      include: {
        pump: true,
        institution: true,
      },
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changes: expect.objectContaining({
          rented_at: '2026-06-10',
          due_at: null,
          returned_at: '2026-06-18',
        }),
      }),
    });
  });

  it('rejects a rental if the pump cannot be claimed inside the transaction', async () => {
    pcaPumpUpdateManyMock.mockResolvedValue({ count: 0 });

    const response = await POST(
      createRequest('http://localhost/api/pca-pump-rentals', {
        pump_id: 'pump_1',
        institution_id: 'institution_1',
        rented_at: '2026-06-10',
        due_at: '2026-06-20',
      }),
    );

    expect(response.status).toBe(400);
    expect(allocateDisplayIdMock).not.toHaveBeenCalled();
    expect(pcaPumpRentalCreateMock).not.toHaveBeenCalled();
  });

  it('returns a validation error if the open-rental unique index rejects a race', async () => {
    withOrgContextMock
      .mockImplementationOnce(async (_orgId, callback) =>
        callback({
          pcaPump: { findFirst: pcaPumpFindFirstMock },
          prescriberInstitution: { findFirst: prescriberInstitutionFindFirstMock },
        }),
      )
      .mockRejectedValueOnce({ code: 'P2002' });

    const response = await POST(
      createRequest('http://localhost/api/pca-pump-rentals', {
        pump_id: 'pump_1',
        institution_id: 'institution_1',
        rented_at: '2026-06-10',
        due_at: '2026-06-20',
      }),
    );

    expect(response.status).toBe(400);
    expect(allocateDisplayIdMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      message: 'このPCAポンプには未完了の貸出があるため登録できません',
    });
  });

  it('returns a sanitized no-store 500 when PCA pump rental creation fails unexpectedly', async () => {
    pcaPumpRentalCreateMock.mockRejectedValueOnce(
      new Error('raw PCA rental creation contact phone serial secret'),
    );

    const response = await POST(
      createRequest('http://localhost/api/pca-pump-rentals', {
        pump_id: 'pump_1',
        institution_id: 'institution_1',
        rented_at: '2026-06-10',
        due_at: '2026-06-20',
      }),
    );

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('contact phone serial secret');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'route_handler_unhandled_error',
        route: '/api/pca-pump-rentals',
        method: 'POST',
      }),
      expect.any(Error),
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('contact phone serial secret');
  });

  it('rejects already rented pumps before creating a rental', async () => {
    pcaPumpFindFirstMock.mockResolvedValue({ id: 'pump_1', status: 'rented' });

    const response = await POST(
      createRequest('http://localhost/api/pca-pump-rentals', {
        pump_id: 'pump_1',
        institution_id: 'institution_1',
        rented_at: '2026-06-10',
        due_at: '2026-06-20',
      }),
    );

    expect(response.status).toBe(400);
    expect(withOrgContextMock).toHaveBeenCalledTimes(1);
    expect(allocateDisplayIdMock).not.toHaveBeenCalled();
    expect(pcaPumpRentalCreateMock).not.toHaveBeenCalled();
    expect(pcaPumpUpdateManyMock).not.toHaveBeenCalled();
  });
});
