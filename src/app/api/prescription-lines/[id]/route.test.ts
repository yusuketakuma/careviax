import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  prescriptionLineFindFirstMock,
  prescriptionLineUpdateManyMock,
  drugMasterFindFirstMock,
  drugMasterFindManyMock,
  auditLogCreateMock,
  withOrgContextMock,
  buildPrescriptionIntakeAssignmentWhereMock,
} = vi.hoisted(() => ({
  prescriptionLineFindFirstMock: vi.fn(),
  prescriptionLineUpdateManyMock: vi.fn(),
  drugMasterFindFirstMock: vi.fn(),
  drugMasterFindManyMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  buildPrescriptionIntakeAssignmentWhereMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/prescription-access', () => ({
  buildPrescriptionIntakeAssignmentWhere: buildPrescriptionIntakeAssignmentWhereMock,
}));

import { PATCH } from './route';

function createRequest(body?: unknown) {
  return new NextRequest('http://localhost/api/prescription-lines/line_1', {
    method: 'PATCH',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function createMalformedRequest() {
  return new NextRequest('http://localhost/api/prescription-lines/line_1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: '{"days":',
  });
}

describe('/api/prescription-lines/[id] PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildPrescriptionIntakeAssignmentWhereMock.mockReturnValue(null);
    const existingLine = {
      id: 'line_1',
      intake_id: 'intake_1',
      start_date: new Date('2026-06-01T00:00:00.000Z'),
      end_date: new Date('2026-06-07T00:00:00.000Z'),
      days: 7,
      frequency: '1日3回',
      dose: '1錠',
      quantity: 21,
      unit: '錠',
      drug_name: 'Drug A',
      drug_code: null,
      drug_master_id: null,
      source_drug_code: null,
      source_drug_code_type: null,
      drug_resolution_status: 'missing_code',
      updated_at: new Date('2026-06-16T00:00:00.000Z'),
      intake: { cycle_id: 'cycle_1', cycle: { patient_id: 'patient_1' } },
    };
    const updatedLine = {
      id: 'line_1',
      intake_id: 'intake_1',
      line_number: 1,
      drug_name: 'Drug A',
      drug_code: 'YJ001',
      dosage_form: '錠剤',
      dose: '2錠',
      frequency: '1日2回',
      days: 14,
      quantity: 28,
      unit: '錠',
      drug_master_id: null,
      source_drug_code: null,
      source_drug_code_type: null,
      drug_resolution_status: 'missing_code',
      start_date: new Date('2026-06-02T00:00:00.000Z'),
      end_date: new Date('2026-06-15T00:00:00.000Z'),
      packaging_group_id: null,
      updated_at: new Date('2026-06-17T00:00:00.000Z'),
    };
    prescriptionLineFindFirstMock
      .mockResolvedValueOnce(existingLine)
      .mockResolvedValue(updatedLine);
    prescriptionLineUpdateManyMock.mockResolvedValue({ count: 1 });
    drugMasterFindFirstMock.mockResolvedValue({
      id: 'drug_master_1',
      yj_code: 'YJ001',
      receipt_code: 'RC001',
      hot_code: null,
      drug_name: 'Drug A',
    });
    drugMasterFindManyMock.mockResolvedValue([
      {
        id: 'drug_master_1',
        yj_code: 'YJ001',
        receipt_code: 'RC001',
        hot_code: null,
      },
    ]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        prescriptionLine: {
          findFirst: prescriptionLineFindFirstMock,
          updateMany: prescriptionLineUpdateManyMock,
        },
        drugMaster: {
          findFirst: drugMasterFindFirstMock,
          findMany: drugMasterFindManyMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it('updates a prescription line and records an audit entry', async () => {
    const response = (await PATCH(
      createRequest({
        expected_updated_at: '2026-06-16T00:00:00.000Z',
        start_date: '2026-06-02',
        days: 14,
        frequency: '1日2回',
        dose: '2錠',
        quantity: 28,
      }),
      { params: Promise.resolve({ id: 'line_1' }) },
    ))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { id: 'line_1' } });

    expect(prescriptionLineUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'line_1',
        org_id: 'org_1',
        updated_at: new Date('2026-06-16T00:00:00.000Z'),
      },
      data: expect.objectContaining({
        start_date: new Date('2026-06-02T00:00:00.000Z'),
        days: 14,
        frequency: '1日2回',
        dose: '2錠',
        quantity: 28,
      }),
    });

    expect(auditLogCreateMock).toHaveBeenCalledTimes(1);
    const auditArg = auditLogCreateMock.mock.calls[0][0];
    expect(auditArg.data).toMatchObject({
      org_id: 'org_1',
      actor_id: 'user_1',
      patient_id: 'patient_1',
      action: 'prescription_line.update',
      target_type: 'PrescriptionLine',
      target_id: 'line_1',
    });
    expect(auditArg.data.changes.before).toMatchObject({ days: 7, frequency: '1日3回' });
    expect(auditArg.data.changes.after).toMatchObject({ days: 14, frequency: '1日2回' });
    expect(auditArg.data.changes.before.start_date).toBe('2026-06-01');
    expect(auditArg.data.changes.after.start_date).toBe('2026-06-02');
  });

  it('accepts nullable quantity/unit clearing', async () => {
    const response = (await PATCH(
      createRequest({
        expected_updated_at: '2026-06-16T00:00:00.000Z',
        quantity: null,
        unit: null,
      }),
      {
        params: Promise.resolve({ id: 'line_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(prescriptionLineUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'line_1',
        org_id: 'org_1',
        updated_at: new Date('2026-06-16T00:00:00.000Z'),
      },
      data: expect.objectContaining({ quantity: null, unit: null }),
    });
  });

  it('rejects an empty update payload before transaction side effects', async () => {
    const response = (await PATCH(
      createRequest({ expected_updated_at: '2026-06-16T00:00:00.000Z' }),
      {
        params: Promise.resolve({ id: 'line_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(prescriptionLineFindFirstMock).not.toHaveBeenCalled();
    expect(prescriptionLineUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid date format', async () => {
    const response = (await PATCH(
      createRequest({
        expected_updated_at: '2026-06-16T00:00:00.000Z',
        start_date: '2026/06/02',
      }),
      {
        params: Promise.resolve({ id: 'line_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(prescriptionLineUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects impossible calendar dates before transaction side effects', async () => {
    const response = (await PATCH(
      createRequest({
        expected_updated_at: '2026-06-16T00:00:00.000Z',
        start_date: '2026-02-30',
      }),
      {
        params: Promise.resolve({ id: 'line_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      details: { start_date: ['日付はYYYY-MM-DD形式です'] },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(prescriptionLineUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects date ranges that become invalid against the current stored start date', async () => {
    const response = (await PATCH(
      createRequest({
        expected_updated_at: '2026-06-16T00:00:00.000Z',
        end_date: '2026-05-31',
      }),
      {
        params: Promise.resolve({ id: 'line_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      details: { end_date: ['終了日は開始日以降にしてください'] },
    });
    expect(prescriptionLineUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns 409 when expected_updated_at is stale before update side effects', async () => {
    const response = (await PATCH(
      createRequest({
        expected_updated_at: '2026-06-15T00:00:00.000Z',
        days: 10,
      }),
      {
        params: Promise.resolve({ id: 'line_1' }),
      },
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: { updated_at: '2026-06-16T00:00:00.000Z' },
    });
    expect(prescriptionLineUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns 409 when the line changes between read and atomic update', async () => {
    prescriptionLineUpdateManyMock.mockResolvedValue({ count: 0 });
    prescriptionLineFindFirstMock.mockReset();
    prescriptionLineFindFirstMock
      .mockResolvedValueOnce({
        id: 'line_1',
        intake_id: 'intake_1',
        start_date: new Date('2026-06-01T00:00:00.000Z'),
        end_date: new Date('2026-06-07T00:00:00.000Z'),
        days: 7,
        frequency: '1日3回',
        dose: '1錠',
        quantity: 21,
        unit: '錠',
        updated_at: new Date('2026-06-16T00:00:00.000Z'),
        intake: { cycle_id: 'cycle_1' },
      })
      .mockResolvedValueOnce({
        updated_at: new Date('2026-06-17T00:00:00.000Z'),
      });

    const response = (await PATCH(
      createRequest({
        expected_updated_at: '2026-06-16T00:00:00.000Z',
        days: 10,
      }),
      {
        params: Promise.resolve({ id: 'line_1' }),
      },
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: { updated_at: '2026-06-17T00:00:00.000Z' },
    });
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('re-applies assignment scope to the atomic update and post-update read', async () => {
    const assignmentWhere = { cycle: { case_: { primary_pharmacist_id: 'user_1' } } };
    buildPrescriptionIntakeAssignmentWhereMock.mockReturnValue(assignmentWhere);

    const response = (await PATCH(
      createRequest({
        expected_updated_at: '2026-06-16T00:00:00.000Z',
        days: 10,
      }),
      {
        params: Promise.resolve({ id: 'line_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(prescriptionLineFindFirstMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ intake: assignmentWhere }),
      }),
    );
    expect(prescriptionLineUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ intake: assignmentWhere }),
      }),
    );
    expect(prescriptionLineFindFirstMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ intake: assignmentWhere }),
      }),
    );
  });

  it('rejects non-object payloads before transaction side effects', async () => {
    const response = (await PATCH(createRequest([]), {
      params: Promise.resolve({ id: 'line_1' }),
    }))!;

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(prescriptionLineUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before transaction side effects', async () => {
    const response = (await PATCH(createMalformedRequest(), {
      params: Promise.resolve({ id: 'line_1' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(prescriptionLineUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns 404 for unassigned pharmacist line updates before side effects', async () => {
    prescriptionLineFindFirstMock.mockReset();
    prescriptionLineFindFirstMock.mockResolvedValue(null);

    const response = (await PATCH(
      createRequest({ expected_updated_at: '2026-06-16T00:00:00.000Z', days: 10 }),
      {
        params: Promise.resolve({ id: 'line_1' }),
      },
    ))!;

    expect(response.status).toBe(404);
    expect(prescriptionLineUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('resolves a review-required prescription line to the selected DrugMaster identity', async () => {
    prescriptionLineFindFirstMock.mockReset();
    prescriptionLineFindFirstMock
      .mockResolvedValueOnce({
        id: 'line_1',
        intake_id: 'intake_1',
        start_date: new Date('2026-06-01T00:00:00.000Z'),
        end_date: new Date('2026-06-07T00:00:00.000Z'),
        days: 7,
        frequency: '1日3回',
        dose: '1錠',
        quantity: 21,
        unit: '錠',
        drug_name: 'Drug A',
        drug_code: null,
        drug_master_id: null,
        source_drug_code: 'RC001',
        source_drug_code_type: 'receipt',
        drug_resolution_status: 'code_not_found',
        updated_at: new Date('2026-06-16T00:00:00.000Z'),
        intake: { cycle_id: 'cycle_1', cycle: { patient_id: 'patient_1' } },
      })
      .mockResolvedValueOnce({
        id: 'line_1',
        intake_id: 'intake_1',
        line_number: 1,
        drug_name: 'Drug A',
        drug_code: 'YJ001',
        drug_master_id: 'drug_master_1',
        source_drug_code: 'RC001',
        source_drug_code_type: 'receipt',
        drug_resolution_status: 'resolved',
        dosage_form: '錠剤',
        dose: '1錠',
        frequency: '1日3回',
        days: 7,
        quantity: 21,
        unit: '錠',
        start_date: new Date('2026-06-01T00:00:00.000Z'),
        end_date: new Date('2026-06-07T00:00:00.000Z'),
        packaging_group_id: null,
        updated_at: new Date('2026-06-17T00:00:00.000Z'),
      });

    const response = (await PATCH(
      createRequest({
        expected_updated_at: '2026-06-16T00:00:00.000Z',
        drug_master_id: 'drug_master_1',
      }),
      {
        params: Promise.resolve({ id: 'line_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: 'line_1',
        drug_code: 'YJ001',
        drug_master_id: 'drug_master_1',
        source_drug_code: 'RC001',
        source_drug_code_type: 'receipt',
        drug_resolution_status: 'resolved',
      },
    });
    expect(drugMasterFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'drug_master_1' },
      select: {
        id: true,
        yj_code: true,
        receipt_code: true,
        hot_code: true,
        drug_name: true,
      },
    });
    expect(drugMasterFindManyMock).toHaveBeenCalledWith({
      where: {
        OR: [
          { yj_code: { in: ['RC001'] } },
          { receipt_code: { in: ['RC001'] } },
          { hot_code: { in: ['RC001'] } },
        ],
      },
      select: {
        id: true,
        yj_code: true,
        receipt_code: true,
        hot_code: true,
      },
    });
    expect(prescriptionLineUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          drug_master_id: 'drug_master_1',
          drug_code: 'YJ001',
          drug_resolution_status: 'resolved',
        },
      }),
    );
    const auditArg = auditLogCreateMock.mock.calls[0][0];
    expect(auditArg.data.patient_id).toBe('patient_1');
    expect(auditArg.data.changes.before).toMatchObject({
      drug_code: null,
      drug_master_id: null,
      source_drug_code: 'RC001',
      source_drug_code_type: 'receipt',
      drug_resolution_status: 'code_not_found',
    });
    expect(auditArg.data.changes.after).toMatchObject({
      drug_code: 'YJ001',
      drug_master_id: 'drug_master_1',
      source_drug_code: 'RC001',
      source_drug_code_type: 'receipt',
      drug_resolution_status: 'resolved',
    });
  });

  it.each(['drug_code', 'source_drug_code', 'source_drug_code_type', 'drug_resolution_status'])(
    'rejects client-supplied server-derived drug identity field %s before side effects',
    async (field) => {
      const response = (await PATCH(
        createRequest({
          expected_updated_at: '2026-06-16T00:00:00.000Z',
          drug_master_id: 'drug_master_1',
          [field]: 'client-value',
        }),
        {
          params: Promise.resolve({ id: 'line_1' }),
        },
      ))!;

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        details: { [field]: ['薬剤コードは医薬品マスターからサーバー側で確定します'] },
      });
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(prescriptionLineUpdateManyMock).not.toHaveBeenCalled();
      expect(auditLogCreateMock).not.toHaveBeenCalled();
    },
  );

  it('rejects drug identity confirmation mixed with prescription content edits before side effects', async () => {
    const response = (await PATCH(
      createRequest({
        expected_updated_at: '2026-06-16T00:00:00.000Z',
        drug_master_id: 'drug_master_1',
        days: 14,
      }),
      {
        params: Promise.resolve({ id: 'line_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      details: { days: ['薬剤確定と処方内容編集は同時に行えません'] },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(prescriptionLineUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns 400 when the selected DrugMaster does not exist', async () => {
    drugMasterFindFirstMock.mockResolvedValue(null);

    const response = (await PATCH(
      createRequest({
        expected_updated_at: '2026-06-16T00:00:00.000Z',
        drug_master_id: 'missing_drug_master',
      }),
      {
        params: Promise.resolve({ id: 'line_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { drug_master_id: ['存在する医薬品マスターを選択してください'] },
    });
    expect(prescriptionLineUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns 409 when a line is already linked to a different DrugMaster', async () => {
    prescriptionLineFindFirstMock.mockReset();
    prescriptionLineFindFirstMock.mockResolvedValueOnce({
      id: 'line_1',
      intake_id: 'intake_1',
      start_date: new Date('2026-06-01T00:00:00.000Z'),
      end_date: new Date('2026-06-07T00:00:00.000Z'),
      days: 7,
      frequency: '1日3回',
      dose: '1錠',
      quantity: 21,
      unit: '錠',
      drug_name: 'Drug A',
      drug_code: 'YJ_OLD',
      drug_master_id: 'drug_master_old',
      source_drug_code: 'YJ_OLD',
      source_drug_code_type: 'yj',
      drug_resolution_status: 'resolved',
      updated_at: new Date('2026-06-16T00:00:00.000Z'),
      intake: { cycle_id: 'cycle_1', cycle: { patient_id: 'patient_1' } },
    });

    const response = (await PATCH(
      createRequest({
        expected_updated_at: '2026-06-16T00:00:00.000Z',
        drug_master_id: 'drug_master_1',
      }),
      {
        params: Promise.resolve({ id: 'line_1' }),
      },
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: {
        drug_master_id: 'drug_master_old',
        requested_drug_master_id: 'drug_master_1',
      },
    });
    expect(drugMasterFindFirstMock).not.toHaveBeenCalled();
    expect(prescriptionLineUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns 409 when the stored source code resolves to a different DrugMaster', async () => {
    prescriptionLineFindFirstMock.mockReset();
    prescriptionLineFindFirstMock.mockResolvedValueOnce({
      id: 'line_1',
      intake_id: 'intake_1',
      start_date: new Date('2026-06-01T00:00:00.000Z'),
      end_date: new Date('2026-06-07T00:00:00.000Z'),
      days: 7,
      frequency: '1日3回',
      dose: '1錠',
      quantity: 21,
      unit: '錠',
      drug_name: 'Drug A',
      drug_code: null,
      drug_master_id: null,
      source_drug_code: 'RC999',
      source_drug_code_type: 'receipt',
      drug_resolution_status: 'code_not_found',
      updated_at: new Date('2026-06-16T00:00:00.000Z'),
      intake: { cycle_id: 'cycle_1', cycle: { patient_id: 'patient_1' } },
    });
    drugMasterFindManyMock.mockResolvedValue([
      {
        id: 'drug_master_other',
        yj_code: 'YJ999',
        receipt_code: 'RC999',
        hot_code: null,
      },
    ]);

    const response = (await PATCH(
      createRequest({
        expected_updated_at: '2026-06-16T00:00:00.000Z',
        drug_master_id: 'drug_master_1',
      }),
      {
        params: Promise.resolve({ id: 'line_1' }),
      },
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: {
        field: 'source_drug_code',
        drug_code: 'RC999',
        resolved_drug_master_id: 'drug_master_other',
        requested_drug_master_id: 'drug_master_1',
      },
    });
    expect(prescriptionLineUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns 409 when source code is unknown but stored drug_code resolves elsewhere', async () => {
    prescriptionLineFindFirstMock.mockReset();
    prescriptionLineFindFirstMock.mockResolvedValueOnce({
      id: 'line_1',
      intake_id: 'intake_1',
      start_date: new Date('2026-06-01T00:00:00.000Z'),
      end_date: new Date('2026-06-07T00:00:00.000Z'),
      days: 7,
      frequency: '1日3回',
      dose: '1錠',
      quantity: 21,
      unit: '錠',
      drug_name: 'Drug A',
      drug_code: 'YJ999',
      drug_master_id: null,
      source_drug_code: 'UNKNOWN',
      source_drug_code_type: 'receipt',
      drug_resolution_status: 'code_not_found',
      updated_at: new Date('2026-06-16T00:00:00.000Z'),
      intake: { cycle_id: 'cycle_1', cycle: { patient_id: 'patient_1' } },
    });
    drugMasterFindManyMock.mockResolvedValue([
      {
        id: 'drug_master_other',
        yj_code: 'YJ999',
        receipt_code: null,
        hot_code: null,
      },
    ]);

    const response = (await PATCH(
      createRequest({
        expected_updated_at: '2026-06-16T00:00:00.000Z',
        drug_master_id: 'drug_master_1',
      }),
      {
        params: Promise.resolve({ id: 'line_1' }),
      },
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: {
        field: 'drug_code',
        drug_code: 'YJ999',
        resolved_drug_master_id: 'drug_master_other',
        requested_drug_master_id: 'drug_master_1',
      },
    });
    expect(drugMasterFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { yj_code: { in: ['UNKNOWN', 'YJ999'] } },
            { receipt_code: { in: ['UNKNOWN', 'YJ999'] } },
            { hot_code: { in: ['UNKNOWN', 'YJ999'] } },
          ],
        },
      }),
    );
    expect(prescriptionLineUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('allows manual confirmation when the stored source code is ambiguous and no canonical code conflicts', async () => {
    prescriptionLineFindFirstMock.mockReset();
    prescriptionLineFindFirstMock
      .mockResolvedValueOnce({
        id: 'line_1',
        intake_id: 'intake_1',
        start_date: new Date('2026-06-01T00:00:00.000Z'),
        end_date: new Date('2026-06-07T00:00:00.000Z'),
        days: 7,
        frequency: '1日3回',
        dose: '1錠',
        quantity: 21,
        unit: '錠',
        drug_name: 'Drug A',
        drug_code: null,
        drug_master_id: null,
        source_drug_code: 'RC_DUP',
        source_drug_code_type: 'receipt',
        drug_resolution_status: 'ambiguous_code',
        updated_at: new Date('2026-06-16T00:00:00.000Z'),
        intake: { cycle_id: 'cycle_1', cycle: { patient_id: 'patient_1' } },
      })
      .mockResolvedValueOnce({
        id: 'line_1',
        intake_id: 'intake_1',
        line_number: 1,
        drug_name: 'Drug A',
        drug_code: 'YJ001',
        drug_master_id: 'drug_master_1',
        source_drug_code: 'RC_DUP',
        source_drug_code_type: 'receipt',
        drug_resolution_status: 'resolved',
        dosage_form: '錠剤',
        dose: '1錠',
        frequency: '1日3回',
        days: 7,
        quantity: 21,
        unit: '錠',
        start_date: new Date('2026-06-01T00:00:00.000Z'),
        end_date: new Date('2026-06-07T00:00:00.000Z'),
        packaging_group_id: null,
        updated_at: new Date('2026-06-17T00:00:00.000Z'),
      });
    drugMasterFindManyMock.mockResolvedValue([
      {
        id: 'drug_master_1',
        yj_code: 'YJ001',
        receipt_code: 'RC_DUP',
        hot_code: null,
      },
      {
        id: 'drug_master_other',
        yj_code: 'YJ999',
        receipt_code: 'RC_DUP',
        hot_code: null,
      },
    ]);

    const response = (await PATCH(
      createRequest({
        expected_updated_at: '2026-06-16T00:00:00.000Z',
        drug_master_id: 'drug_master_1',
      }),
      {
        params: Promise.resolve({ id: 'line_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(prescriptionLineUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          drug_master_id: 'drug_master_1',
          drug_code: 'YJ001',
          drug_resolution_status: 'resolved',
        },
      }),
    );
    expect(auditLogCreateMock).toHaveBeenCalledTimes(1);
  });
});
