import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  withOrgContextMock,
  notifyWebhookEventForOrgMock,
  upsertOperationalTaskMock,
  createDispenseDraftMock,
  prismaMock,
} =
  vi.hoisted(() => ({
    withOrgContextMock: vi.fn(),
    notifyWebhookEventForOrgMock: vi.fn(),
    upsertOperationalTaskMock: vi.fn(),
    createDispenseDraftMock: vi.fn(),
    prismaMock: {
      prescriptionIntake: {
        findFirst: vi.fn(),
      },
      medicationProfile: {
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
    },
  }));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: prismaMock,
}));

vi.mock('@/server/services/outbound-webhook', () => ({
  notifyWebhookEventForOrg: notifyWebhookEventForOrgMock,
}));

vi.mock('@/server/services/operational-tasks', () => ({
  upsertOperationalTask: upsertOperationalTaskMock,
}));

vi.mock('@/server/services/dispense-draft-service', () => ({
  createDispenseDraft: createDispenseDraftMock,
}));

import { createPrescriptionIntake, createPrescriptionIntakeInTx } from './prescription-intake-service';

function createMockTx() {
  return {
    careCase: {
      findFirst: vi.fn(),
    },
    medicationCycle: {
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    cycleTransitionLog: {
      create: vi.fn(),
    },
    workflowException: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    prescriberInstitution: {
      findFirst: vi.fn(),
    },
    prescriptionIntake: {
      create: vi.fn(),
    },
    inquiryRecord: {
      count: vi.fn(),
      create: vi.fn(),
    },
    communicationRequest: {
      create: vi.fn(),
    },
    communicationEvent: {
      create: vi.fn(),
    },
    dispenseTask: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    task: {
      create: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
  };
}

function validLine() {
  return {
    line_number: 1,
    drug_name: 'アムロジピン錠5mg',
    drug_code: '2149001',
    dose: '1錠',
    frequency: '1日1回朝食後',
    days: 14,
  };
}

describe('createPrescriptionIntake', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.prescriptionIntake.findFirst.mockResolvedValue(null);
    prismaMock.medicationProfile.findMany.mockResolvedValue([]);
    prismaMock.medicationProfile.create.mockResolvedValue({});
    prismaMock.medicationProfile.update.mockResolvedValue({});
    prismaMock.medicationProfile.updateMany.mockResolvedValue({ count: 0 });
    notifyWebhookEventForOrgMock.mockResolvedValue(undefined);
    upsertOperationalTaskMock.mockResolvedValue({ id: 'task_1' });
    createDispenseDraftMock.mockResolvedValue({
      id: 'cycle_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      overall_status: 'ready_to_dispense',
      primary_pharmacist_id: 'pharmacist_1',
    });
  });

  it('rejects patient/case or org mismatch before creating a cycle or intake', async () => {
    const tx = createMockTx();
    tx.careCase.findFirst.mockResolvedValue(null);

    withOrgContextMock.mockImplementation(async (_orgId, callback) => callback(tx));

    const result = await createPrescriptionIntake(
      {
        patient_id: 'patient_other',
        case_id: 'case_1',
        source_type: 'qr_scan',
        prescribed_date: '2026-04-01',
        lines: [validLine()],
      },
      'org_1',
      'user_1',
      { skipExpiryCheck: true, skipStructuringCheck: true },
    );

    expect(result).toEqual({ ok: false, error: 'cycle_not_found' });
    expect(tx.careCase.findFirst).toHaveBeenCalledWith({
      where: { id: 'case_1', org_id: 'org_1', patient_id: 'patient_other' },
      select: {
        id: true,
        patient_id: true,
        primary_pharmacist_id: true,
      },
    });
    expect(tx.medicationCycle.create).not.toHaveBeenCalled();
    expect(tx.prescriptionIntake.create).not.toHaveBeenCalled();
    expect(tx.dispenseTask.create).not.toHaveBeenCalled();
    expect(notifyWebhookEventForOrgMock).not.toHaveBeenCalled();
    expect(prismaMock.prescriptionIntake.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.medicationProfile.findMany).not.toHaveBeenCalled();
  });

  it('maps a missing prescriber institution to a validation result before intake side effects', async () => {
    const tx = createMockTx();
    tx.medicationCycle.findFirst.mockResolvedValue({
      id: 'cycle_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      overall_status: 'ready_to_dispense',
      version: 1,
      case_: {
        primary_pharmacist_id: 'pharmacist_1',
      },
      prescription_intakes: [],
      dispense_tasks: [],
    });
    tx.prescriberInstitution.findFirst.mockResolvedValue(null);

    withOrgContextMock.mockImplementation(async (_orgId, callback) => callback(tx));

    const result = await createPrescriptionIntake(
      {
        cycle_id: 'cycle_1',
        source_type: 'qr_scan',
        prescribed_date: '2026-04-01',
        prescriber_institution_id: 'institution_missing',
        lines: [validLine()],
      },
      'org_1',
      'user_1',
      { skipExpiryCheck: true, skipStructuringCheck: true },
    );

    expect(result).toEqual({
      ok: false,
      error: 'prescriber_institution_not_found',
      message: '選択した医療機関が見つかりません',
    });
    expect(tx.prescriberInstitution.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'institution_missing',
        org_id: 'org_1',
      },
      select: {
        id: true,
        name: true,
        institution_code: true,
        address: true,
        phone: true,
        fax: true,
        notes: true,
      },
    });
    expect(tx.prescriptionIntake.create).not.toHaveBeenCalled();
    expect(tx.dispenseTask.create).not.toHaveBeenCalled();
    expect(notifyWebhookEventForOrgMock).not.toHaveBeenCalled();
    expect(prismaMock.prescriptionIntake.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.medicationProfile.findMany).not.toHaveBeenCalled();
  });

  it('normalizes inquiry communication request context snapshots in transaction flow', async () => {
    const tx = createMockTx();
    tx.medicationCycle.findFirst.mockResolvedValue({
      id: 'cycle_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      overall_status: 'ready_to_dispense',
      version: 1,
      case_: {
        primary_pharmacist_id: 'pharmacist_1',
      },
      prescription_intakes: [],
      dispense_tasks: [],
    });
    tx.prescriptionIntake.create.mockResolvedValue({
      id: 'intake_1',
    });
    tx.inquiryRecord.create.mockResolvedValue({
      id: 'inquiry_1',
    });
    tx.communicationRequest.create.mockResolvedValue({
      id: 'request_1',
    });
    tx.communicationEvent.create.mockResolvedValue({
      id: 'event_1',
    });
    tx.inquiryRecord.count.mockResolvedValue(1);

    const result = await createPrescriptionIntakeInTx(
      tx,
      {
        cycle_id: 'cycle_1',
        source_type: 'qr_scan',
        prescribed_date: '2026-04-01',
        lines: [validLine()],
        inquiry: {
          reason: '用量確認',
          inquiry_to_physician: '処方医A',
          inquiry_content: '用量を確認してください',
        },
      },
      'org_1',
      'user_1',
      { skipStructuringCheck: true, skipExpiryCheck: true },
    );

    expect(result.kind).toBe('intake');
    expect(tx.communicationRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        context_snapshot: {
          cycle_id: 'cycle_1',
          issue_id: null,
          line_id: null,
          reason: '用量確認',
        },
      }),
    });
    expect(createDispenseDraftMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        shouldPauseForInquiry: true,
      }),
    );
  });
});
