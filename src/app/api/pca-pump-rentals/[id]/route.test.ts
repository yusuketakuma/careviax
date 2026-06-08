import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  withOrgContextMock,
  pcaPumpRentalFindFirstMock,
  prescriberInstitutionFindFirstMock,
  pcaPumpRentalUpdateMock,
  pcaPumpUpdateMock,
  openRentalFindFirstMock,
  auditLogCreateMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  pcaPumpRentalFindFirstMock: vi.fn(),
  prescriberInstitutionFindFirstMock: vi.fn(),
  pcaPumpRentalUpdateMock: vi.fn(),
  pcaPumpUpdateMock: vi.fn(),
  openRentalFindFirstMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    pcaPumpRental: {
      findFirst: pcaPumpRentalFindFirstMock,
    },
    prescriberInstitution: {
      findFirst: prescriberInstitutionFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { PATCH } from './route';

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/pca-pump-rentals/rental_1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const updatedRental = {
  id: 'rental_1',
  pump_id: 'pump_1',
  institution_id: 'institution_1',
  status: 'returned',
  rented_at: new Date('2026-06-10T00:00:00.000Z'),
  due_at: new Date('2026-06-20T00:00:00.000Z'),
  returned_at: new Date('2026-06-18T00:00:00.000Z'),
  created_at: new Date('2026-06-10T01:00:00.000Z'),
  updated_at: new Date('2026-06-18T01:00:00.000Z'),
  pump: { id: 'pump_1', asset_code: 'PCA-001' },
  institution: { id: 'institution_1', name: 'みなと病院' },
};

describe('/api/pca-pump-rentals/[id] PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: { orgId: 'org_1', userId: 'user_1', role: 'admin' },
    });
    pcaPumpRentalFindFirstMock.mockResolvedValue({
      id: 'rental_1',
      pump_id: 'pump_1',
      status: 'active',
      rented_at: new Date('2026-06-10T00:00:00.000Z'),
      due_at: new Date('2026-06-20T00:00:00.000Z'),
      returned_at: null,
    });
    prescriberInstitutionFindFirstMock.mockResolvedValue({ id: 'institution_1' });
    openRentalFindFirstMock.mockResolvedValue(null);
    pcaPumpRentalUpdateMock.mockResolvedValue(updatedRental);
    pcaPumpUpdateMock.mockResolvedValue({ id: 'pump_1', status: 'available' });
    let contextCall = 0;
    withOrgContextMock.mockImplementation(async (_orgId, callback) => {
      contextCall += 1;
      return callback({
        pcaPumpRental: {
          findFirst: contextCall === 1 ? pcaPumpRentalFindFirstMock : openRentalFindFirstMock,
          update: pcaPumpRentalUpdateMock,
        },
        prescriberInstitution: {
          findFirst: prescriberInstitutionFindFirstMock,
        },
        pcaPump: {
          update: pcaPumpUpdateMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      });
    });
  });

  it('rejects reactivating a rental when the same pump has another open rental', async () => {
    openRentalFindFirstMock.mockResolvedValue({ id: 'rental_2', status: 'active' });

    const response = await PATCH(createRequest({ status: 'active' }), {
      params: Promise.resolve({ id: 'rental_1' }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'このPCAポンプには未完了の貸出があるため状態を変更できません',
    });
    expect(pcaPumpRentalUpdateMock).not.toHaveBeenCalled();
    expect(pcaPumpUpdateMock).not.toHaveBeenCalled();
  });

  it('returns a validation error if the open-rental unique index rejects a race', async () => {
    withOrgContextMock
      .mockImplementationOnce(async (_orgId, callback) =>
        callback({
          pcaPumpRental: { findFirst: pcaPumpRentalFindFirstMock },
        }),
      )
      .mockRejectedValueOnce({ code: 'P2002' });

    const response = await PATCH(createRequest({ status: 'active' }), {
      params: Promise.resolve({ id: 'rental_1' }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'このPCAポンプには未完了の貸出があるため状態を変更できません',
    });
  });

  it('keeps the pump rented when returning one rental but another open rental remains', async () => {
    openRentalFindFirstMock.mockResolvedValueOnce({ id: 'rental_2', status: 'scheduled' });

    const response = await PATCH(
      createRequest({
        status: 'returned',
        returned_at: '2026-06-18',
      }),
      { params: Promise.resolve({ id: 'rental_1' }) },
    );

    expect(response.status).toBe(200);
    expect(pcaPumpRentalUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'returned',
          returned_at: new Date('2026-06-18'),
        }),
      }),
    );
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        actor_id: 'user_1',
        action: 'pca_pump_rental_updated',
        target_type: 'PcaPumpRental',
        target_id: 'rental_1',
        changes: expect.objectContaining({
          previous_status: 'active',
          status: 'returned',
          returned_at: '2026-06-18',
        }),
      }),
    });
    expect(pcaPumpUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects a partial due date update before the existing rental date', async () => {
    const response = await PATCH(createRequest({ due_at: '2026-06-09' }), {
      params: Promise.resolve({ id: 'rental_1' }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '返却予定日は貸出日以降の日付を指定してください',
    });
    expect(withOrgContextMock).toHaveBeenCalledTimes(1);
    expect(pcaPumpRentalUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects marking a rental returned without a returned date', async () => {
    const response = await PATCH(createRequest({ status: 'returned' }), {
      params: Promise.resolve({ id: 'rental_1' }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '返却済みにする場合は返却日が必須です',
    });
    expect(withOrgContextMock).toHaveBeenCalledTimes(1);
    expect(pcaPumpRentalUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects a returned date without returned status', async () => {
    const response = await PATCH(createRequest({ returned_at: '2026-06-18' }), {
      params: Promise.resolve({ id: 'rental_1' }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '返却日は返却済み状態でのみ指定できます',
    });
    expect(withOrgContextMock).toHaveBeenCalledTimes(1);
    expect(pcaPumpRentalUpdateMock).not.toHaveBeenCalled();
  });

  it('marks the pump maintenance when the returned rental is the only open rental', async () => {
    const response = await PATCH(
      createRequest({
        status: 'returned',
        returned_at: '2026-06-18',
      }),
      { params: Promise.resolve({ id: 'rental_1' }) },
    );

    expect(response.status).toBe(200);
    expect(pcaPumpUpdateMock).toHaveBeenCalledWith({
      where: { id: 'pump_1' },
      data: { status: 'maintenance' },
    });
  });

  it('marks the pump available when cancelling the only open rental', async () => {
    const response = await PATCH(createRequest({ status: 'cancelled' }), {
      params: Promise.resolve({ id: 'rental_1' }),
    });

    expect(response.status).toBe(200);
    expect(pcaPumpUpdateMock).toHaveBeenCalledWith({
      where: { id: 'pump_1' },
      data: { status: 'available' },
    });
  });
});
