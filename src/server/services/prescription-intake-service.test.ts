import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, format } from 'date-fns';

const {
  withOrgContextMock,
  notifyWebhookEventForOrgMock,
  upsertOperationalTaskMock,
  createDispenseDraftMock,
  prismaMock,
} = vi.hoisted(() => ({
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
    drugMaster: {
      findMany: vi.fn(),
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

import {
  createPrescriptionIntake,
  createPrescriptionIntakeInTx,
  runPrescriptionIntakePostCreateHooks,
} from './prescription-intake-service';
import { formatPrescriptionCardNumber } from '@/lib/prescription/rx-number';

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
      update: vi.fn(),
    },
    prescriptionLine: {
      findMany: vi.fn(),
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
    drugMaster: {
      findMany: vi.fn(),
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
    prismaMock.drugMaster.findMany.mockResolvedValue([]);
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

  it('persists previous prescription source provenance after validating the source revision', async () => {
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
    tx.prescriptionLine.findMany.mockResolvedValue([
      {
        id: 'line_prev',
        intake_id: 'intake_prev',
        updated_at: new Date('2026-04-01T09:30:00.000Z'),
        intake: {
          id: 'intake_prev',
          updated_at: new Date('2026-04-01T10:00:00.000Z'),
          cycle: {
            patient_id: 'patient_1',
            case_id: 'case_1',
          },
        },
      },
    ]);
    tx.prescriptionIntake.create.mockResolvedValue({ id: 'intake_1' });
    tx.inquiryRecord.count.mockResolvedValue(0);

    const result = await createPrescriptionIntakeInTx(
      tx,
      {
        cycle_id: 'cycle_1',
        source_type: 'paper',
        prescribed_date: '2026-04-02',
        lines: [
          {
            ...validLine(),
            source_intake_id: 'intake_prev',
            source_line_id: 'line_prev',
            source_intake_updated_at_snapshot: '2026-04-01T10:00:00.000Z',
            source_line_updated_at_snapshot: '2026-04-01T09:30:00.000Z',
          },
        ],
      },
      'org_1',
      'user_1',
      { skipStructuringCheck: true, skipExpiryCheck: true },
    );

    expect(result.kind).toBe('intake');
    expect(tx.prescriptionLine.findMany).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        id: { in: ['line_prev'] },
      },
      select: expect.objectContaining({
        id: true,
        updated_at: true,
        intake: expect.anything(),
      }),
    });
    expect(tx.prescriptionIntake.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        lines: {
          create: [
            expect.objectContaining({
              source_intake_id: 'intake_prev',
              source_line_id: 'line_prev',
              source_intake_updated_at_snapshot: new Date('2026-04-01T10:00:00.000Z'),
              source_line_updated_at_snapshot: new Date('2026-04-01T09:30:00.000Z'),
            }),
          ],
        },
      }),
    });
  });

  it('rejects stale previous prescription source revisions before creating an intake', async () => {
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
    tx.prescriptionLine.findMany.mockResolvedValue([
      {
        id: 'line_prev',
        intake_id: 'intake_prev',
        updated_at: new Date('2026-04-01T09:31:00.000Z'),
        intake: {
          id: 'intake_prev',
          updated_at: new Date('2026-04-01T10:00:00.000Z'),
          cycle: {
            patient_id: 'patient_1',
            case_id: 'case_1',
          },
        },
      },
    ]);

    const result = await createPrescriptionIntakeInTx(
      tx,
      {
        cycle_id: 'cycle_1',
        source_type: 'paper',
        prescribed_date: '2026-04-02',
        lines: [
          {
            ...validLine(),
            source_intake_id: 'intake_prev',
            source_line_id: 'line_prev',
            source_intake_updated_at_snapshot: '2026-04-01T10:00:00.000Z',
            source_line_updated_at_snapshot: '2026-04-01T09:30:00.000Z',
          },
        ],
      },
      'org_1',
      'user_1',
      { skipStructuringCheck: true, skipExpiryCheck: true },
    );

    expect(result).toEqual({ kind: 'error', error: 'source_revision_conflict' });
    expect(tx.prescriptionIntake.create).not.toHaveBeenCalled();
    expect(createDispenseDraftMock).not.toHaveBeenCalled();
  });

  it('rejects expired prescriptions in the transaction flow before DB side effects', async () => {
    const tx = createMockTx();

    const result = await createPrescriptionIntakeInTx(
      tx,
      {
        cycle_id: 'cycle_1',
        source_type: 'qr_scan',
        prescribed_date: '2000-01-01',
        lines: [validLine()],
      },
      'org_1',
      'user_1',
      { skipStructuringCheck: true },
    );

    expect(result).toEqual({ kind: 'error', error: 'expiry_exceeded' });
    expect(tx.medicationCycle.findFirst).not.toHaveBeenCalled();
    expect(tx.careCase.findFirst).not.toHaveBeenCalled();
    expect(tx.prescriptionIntake.create).not.toHaveBeenCalled();
    expect(createDispenseDraftMock).not.toHaveBeenCalled();
  });

  it('rejects future prescriptions in the transaction flow before DB side effects', async () => {
    const tx = createMockTx();

    const result = await createPrescriptionIntakeInTx(
      tx,
      {
        cycle_id: 'cycle_1',
        source_type: 'qr_scan',
        prescribed_date: format(addDays(new Date(), 1), 'yyyy-MM-dd'),
        lines: [validLine()],
      },
      'org_1',
      'user_1',
      { skipStructuringCheck: true },
    );

    expect(result).toEqual({ kind: 'error', error: 'future_prescribed_date' });
    expect(tx.medicationCycle.findFirst).not.toHaveBeenCalled();
    expect(tx.careCase.findFirst).not.toHaveBeenCalled();
    expect(tx.prescriptionIntake.create).not.toHaveBeenCalled();
    expect(createDispenseDraftMock).not.toHaveBeenCalled();
  });

  it('blocks injectable prescription lines that are not confirmed as outpatient eligible', async () => {
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
    tx.workflowException.findFirst.mockResolvedValue(null);
    tx.drugMaster.findMany.mockResolvedValue([
      {
        yj_code: 'INJ001',
        receipt_code: null,
        hot_code: null,
        outpatient_injection_eligible: false,
      },
    ]);

    const result = await createPrescriptionIntakeInTx(
      tx,
      {
        cycle_id: 'cycle_1',
        source_type: 'qr_scan',
        prescribed_date: '2026-04-01',
        lines: [
          {
            ...validLine(),
            drug_name: '注射薬A',
            drug_code: 'INJ001',
            dosage_form: '注射液',
            route: 'injection',
          },
        ],
      },
      'org_1',
      'user_1',
      { skipStructuringCheck: true, skipExpiryCheck: true },
    );

    expect(result).toEqual({
      kind: 'error',
      error: 'outpatient_injection_not_eligible',
      blockedLines: [
        {
          line_number: 1,
          drug_name: '注射薬A',
          reason: '薬剤マスターで外来/在宅自己注射対象として確認されていません',
        },
      ],
    });
    expect(tx.drugMaster.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { yj_code: { in: ['INJ001'] } },
          { receipt_code: { in: ['INJ001'] } },
          { hot_code: { in: ['INJ001'] } },
        ],
      },
      select: {
        yj_code: true,
        receipt_code: true,
        hot_code: true,
        outpatient_injection_eligible: true,
      },
    });
    expect(tx.workflowException.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        cycle_id: 'cycle_1',
        patient_id: 'patient_1',
        exception_type: 'outpatient_injection_eligibility_block',
        severity: 'warning',
        status: 'open',
      }),
    });
    expect(tx.prescriptionIntake.create).not.toHaveBeenCalled();
    expect(createDispenseDraftMock).not.toHaveBeenCalled();
  });

  it('does not create duplicate open workflow exceptions for structuring-blocked lines', async () => {
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
    tx.workflowException.findFirst.mockResolvedValue({ id: 'exception_existing' });

    const result = await createPrescriptionIntakeInTx(
      tx,
      {
        cycle_id: 'cycle_1',
        source_type: 'e_prescription',
        external_prescription_id: 'rx_abc123',
        prescribed_date: '2026-04-01',
        lines: [
          {
            ...validLine(),
            drug_name: '未確認薬剤A',
            drug_code: undefined,
          },
        ],
      },
      'org_1',
      'user_1',
      { skipExpiryCheck: true },
    );

    expect(result).toEqual({
      kind: 'error',
      error: 'structuring_blocked_lines',
      blockedLines: [{ line_number: 1, drug_name: '未確認薬剤A' }],
    });
    expect(tx.workflowException.findFirst).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        cycle_id: 'cycle_1',
        exception_type: 'prescription_structuring_block',
        status: 'open',
      },
      select: { id: true },
    });
    expect(tx.workflowException.create).not.toHaveBeenCalled();
    expect(tx.prescriptionIntake.create).not.toHaveBeenCalled();
    expect(createDispenseDraftMock).not.toHaveBeenCalled();
  });

  it('does not create duplicate open workflow exceptions for outpatient injection blocks', async () => {
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
    tx.workflowException.findFirst.mockResolvedValue({ id: 'exception_existing' });
    tx.drugMaster.findMany.mockResolvedValue([
      {
        yj_code: 'INJ001',
        receipt_code: null,
        hot_code: null,
        outpatient_injection_eligible: false,
      },
    ]);

    const result = await createPrescriptionIntakeInTx(
      tx,
      {
        cycle_id: 'cycle_1',
        source_type: 'e_prescription',
        external_prescription_id: 'rx_abc123',
        prescribed_date: '2026-04-01',
        lines: [
          {
            ...validLine(),
            drug_name: '注射薬A',
            drug_code: 'INJ001',
            dosage_form: '注射液',
            route: 'injection',
          },
        ],
      },
      'org_1',
      'user_1',
      { skipStructuringCheck: true, skipExpiryCheck: true },
    );

    expect(result).toEqual({
      kind: 'error',
      error: 'outpatient_injection_not_eligible',
      blockedLines: [
        {
          line_number: 1,
          drug_name: '注射薬A',
          reason: '薬剤マスターで外来/在宅自己注射対象として確認されていません',
        },
      ],
    });
    expect(tx.workflowException.findFirst).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        cycle_id: 'cycle_1',
        exception_type: 'outpatient_injection_eligibility_block',
        status: 'open',
      },
      select: { id: true },
    });
    expect(tx.workflowException.create).not.toHaveBeenCalled();
    expect(tx.prescriptionIntake.create).not.toHaveBeenCalled();
    expect(createDispenseDraftMock).not.toHaveBeenCalled();
  });

  it('allows injectable prescription lines confirmed as outpatient eligible', async () => {
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
    tx.drugMaster.findMany.mockResolvedValue([
      {
        yj_code: 'INJ001',
        receipt_code: null,
        hot_code: null,
        outpatient_injection_eligible: true,
      },
    ]);
    tx.prescriptionIntake.create.mockResolvedValue({
      id: 'intake_1',
    });
    tx.inquiryRecord.count.mockResolvedValue(0);

    const result = await createPrescriptionIntakeInTx(
      tx,
      {
        cycle_id: 'cycle_1',
        source_type: 'qr_scan',
        prescribed_date: '2026-04-01',
        lines: [
          {
            ...validLine(),
            drug_name: '注射薬A',
            drug_code: 'INJ001',
            dosage_form: '注射液',
            route: 'injection',
          },
        ],
      },
      'org_1',
      'user_1',
      { skipStructuringCheck: true, skipExpiryCheck: true },
    );

    expect(result.kind).toBe('intake');
    if (result.kind !== 'intake') throw new Error('expected intake result');
    const expectedRxNumber = formatPrescriptionCardNumber('intake_1', '2026-04-01');
    expect(result.intake.rx_number).toBe(expectedRxNumber);
    expect(tx.workflowException.create).not.toHaveBeenCalled();
    expect(tx.prescriptionIntake.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        lines: {
          create: [
            expect.objectContaining({
              org_id: 'org_1',
              drug_name: '注射薬A',
              drug_code: 'INJ001',
              route: 'injection',
            }),
          ],
        },
      }),
    });
    expect(tx.prescriptionIntake.update).toHaveBeenCalledWith({
      where: { id: 'intake_1' },
      data: { rx_number: expectedRxNumber },
    });
    expect(createDispenseDraftMock).toHaveBeenCalled();
  });

  it('blocks injectable dosage forms without a drug code', async () => {
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
    tx.workflowException.findFirst.mockResolvedValue(null);

    const result = await createPrescriptionIntakeInTx(
      tx,
      {
        cycle_id: 'cycle_1',
        source_type: 'qr_scan',
        prescribed_date: '2026-04-01',
        lines: [
          {
            ...validLine(),
            drug_name: '薬剤A',
            drug_code: undefined,
            dosage_form: '注射液',
            route: undefined,
          },
        ],
      },
      'org_1',
      'user_1',
      { skipStructuringCheck: true, skipExpiryCheck: true },
    );

    expect(result).toEqual({
      kind: 'error',
      error: 'outpatient_injection_not_eligible',
      blockedLines: [
        {
          line_number: 1,
          drug_name: '薬剤A',
          reason: '薬剤コード未設定の注射剤は外来/在宅自己注射対象か確認できません',
        },
      ],
    });
    expect(tx.drugMaster.findMany).not.toHaveBeenCalled();
    expect(tx.prescriptionIntake.create).not.toHaveBeenCalled();
  });

  it('blocks self-injection-like pen names even when route and dosage form are missing', async () => {
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
    tx.workflowException.findFirst.mockResolvedValue(null);

    const result = await createPrescriptionIntakeInTx(
      tx,
      {
        cycle_id: 'cycle_1',
        source_type: 'qr_scan',
        prescribed_date: '2026-04-01',
        lines: [
          {
            ...validLine(),
            drug_name: 'インスリン グラルギンBS注ミリオペン',
            drug_code: undefined,
            dosage_form: undefined,
            route: undefined,
          },
        ],
      },
      'org_1',
      'user_1',
      { skipStructuringCheck: true, skipExpiryCheck: true },
    );

    expect(result).toEqual({
      kind: 'error',
      error: 'outpatient_injection_not_eligible',
      blockedLines: [
        {
          line_number: 1,
          drug_name: 'インスリン グラルギンBS注ミリオペン',
          reason: '薬剤コード未設定の注射剤は外来/在宅自己注射対象か確認できません',
        },
      ],
    });
    expect(tx.drugMaster.findMany).not.toHaveBeenCalled();
    expect(tx.prescriptionIntake.create).not.toHaveBeenCalled();
  });

  it('allows outpatient eligible injectable lines resolved by receipt code', async () => {
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
    tx.drugMaster.findMany.mockResolvedValue([
      {
        yj_code: 'YJ999',
        receipt_code: 'RC001',
        hot_code: null,
        outpatient_injection_eligible: true,
      },
    ]);
    tx.prescriptionIntake.create.mockResolvedValue({
      id: 'intake_1',
    });
    tx.inquiryRecord.count.mockResolvedValue(0);

    const result = await createPrescriptionIntakeInTx(
      tx,
      {
        cycle_id: 'cycle_1',
        source_type: 'qr_scan',
        prescribed_date: '2026-04-01',
        lines: [
          {
            ...validLine(),
            drug_name: '注射薬A',
            drug_code: 'RC001',
            dosage_form: '注射液',
            route: undefined,
          },
        ],
      },
      'org_1',
      'user_1',
      { skipStructuringCheck: true, skipExpiryCheck: true },
    );

    expect(result.kind).toBe('intake');
    expect(tx.workflowException.create).not.toHaveBeenCalled();
    expect(tx.prescriptionIntake.create).toHaveBeenCalled();
  });

  it('resolves prescription drug codes to DrugMaster ids when syncing medication profiles', async () => {
    prismaMock.prescriptionIntake.findFirst.mockResolvedValue(null);
    prismaMock.medicationProfile.findMany.mockResolvedValue([
      {
        id: 'profile_1',
        drug_master_id: '2149001',
        drug_name: 'アムロジピン錠5mg',
        dose: '1錠',
        frequency: '1日1回朝食後',
      },
    ]);
    prismaMock.drugMaster.findMany.mockResolvedValue([
      {
        id: 'drug_master_amlodipine',
        yj_code: '2149001',
        receipt_code: null,
        hot_code: null,
      },
    ]);

    const result = await runPrescriptionIntakePostCreateHooks({
      cycleId: 'cycle_1',
      intakeId: 'intake_1',
      patientId: 'patient_1',
      orgId: 'org_1',
      lines: [
        {
          drug_name: 'アムロジピン錠5mg',
          drug_code: '2149001',
          dose: '1錠',
          frequency: '1日1回朝食後',
        },
      ],
      prescriberName: '処方医A',
      sourceType: 'qr_scan',
    });

    expect(prismaMock.drugMaster.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { yj_code: { in: ['2149001'] } },
          { receipt_code: { in: ['2149001'] } },
          { hot_code: { in: ['2149001'] } },
        ],
      },
      select: {
        id: true,
        yj_code: true,
        receipt_code: true,
        hot_code: true,
      },
    });
    expect(prismaMock.medicationProfile.update).toHaveBeenCalledWith({
      where: { id: 'profile_1' },
      data: expect.objectContaining({
        drug_master_id: 'drug_master_amlodipine',
      }),
    });
    expect(prismaMock.medicationProfile.create).not.toHaveBeenCalled();
    expect(prismaMock.medicationProfile.updateMany).not.toHaveBeenCalled();
    expect(result.profileSyncResult).toEqual({ created: 0, updated: 1, discontinued: 0 });
  });

  it('detects medication changes against the previous same-case intake across cycle boundaries', async () => {
    prismaMock.prescriptionIntake.findFirst
      .mockResolvedValueOnce({
        id: 'intake_current',
        prescribed_date: new Date('2026-06-10T00:00:00.000Z'),
        created_at: new Date('2026-06-10T09:00:00.000Z'),
        cycle: {
          case_id: 'case_1',
        },
        lines: [
          {
            drug_name: 'アムロジピン錠5mg',
            drug_code: '2149001',
            dose: '1錠',
            frequency: '1日1回朝食後',
            days: 14,
            start_date: new Date('2026-06-10T00:00:00.000Z'),
            end_date: new Date('2026-06-23T00:00:00.000Z'),
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 'intake_previous_cycle',
        prescribed_date: new Date('2026-05-27T00:00:00.000Z'),
        created_at: new Date('2026-05-27T09:00:00.000Z'),
        lines: [
          {
            drug_name: 'アムロジピン錠5mg',
            drug_code: '2149001',
            dose: '1錠',
            frequency: '1日1回朝食後',
            days: 7,
            start_date: new Date('2026-05-27T00:00:00.000Z'),
            end_date: new Date('2026-06-02T00:00:00.000Z'),
          },
        ],
      });
    prismaMock.medicationProfile.findMany.mockResolvedValue([]);
    prismaMock.drugMaster.findMany.mockResolvedValue([]);
    prismaMock.medicationProfile.create.mockResolvedValue({});

    const result = await runPrescriptionIntakePostCreateHooks({
      cycleId: 'cycle_current',
      intakeId: 'intake_current',
      patientId: 'patient_1',
      orgId: 'org_1',
      lines: [
        {
          drug_name: 'アムロジピン錠5mg',
          drug_code: '2149001',
          dose: '1錠',
          frequency: '1日1回朝食後',
        },
      ],
      prescriberName: '処方医A',
      sourceType: 'qr_scan',
    });

    expect(prismaMock.prescriptionIntake.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          id: 'intake_current',
          org_id: 'org_1',
          cycle: {
            patient_id: 'patient_1',
          },
        },
      }),
    );
    expect(prismaMock.prescriptionIntake.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          id: { not: 'intake_current' },
          cycle: {
            patient_id: 'patient_1',
            case_id: 'case_1',
          },
          OR: [
            { prescribed_date: { lt: new Date('2026-06-10T00:00:00.000Z') } },
            {
              prescribed_date: new Date('2026-06-10T00:00:00.000Z'),
              created_at: { lt: new Date('2026-06-10T09:00:00.000Z') },
            },
          ],
        }),
      }),
    );
    expect(result.medicationChanges).toEqual([
      {
        drug_name: 'アムロジピン錠5mg',
        change_type: 'days_changed',
        previous: '1錠 / 1日1回朝食後',
        current: '1錠 / 1日1回朝食後',
        previous_frequency: '1日1回朝食後',
        current_frequency: '1日1回朝食後',
        previous_days: 7,
        current_days: 14,
      },
    ]);
  });

  it('does not discontinue OTC QR medication profiles during prescription sync', async () => {
    prismaMock.prescriptionIntake.findFirst.mockResolvedValue(null);
    prismaMock.medicationProfile.findMany.mockResolvedValue([
      {
        id: 'profile_otc_1',
        drug_master_id: null,
        drug_name: 'バファリンA',
        dose: null,
        frequency: null,
        source: 'otc_qr',
      },
    ]);
    prismaMock.drugMaster.findMany.mockResolvedValue([]);
    prismaMock.medicationProfile.create.mockResolvedValue({});

    const result = await runPrescriptionIntakePostCreateHooks({
      cycleId: 'cycle_1',
      intakeId: 'intake_1',
      patientId: 'patient_1',
      orgId: 'org_1',
      lines: [
        {
          drug_name: 'アムロジピン錠5mg',
          drug_code: '2149001',
          dose: '1錠',
          frequency: '1日1回朝食後',
        },
      ],
      prescriberName: '処方医A',
      sourceType: 'qr_scan',
    });

    expect(prismaMock.medicationProfile.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['profile_otc_1'] } }),
      }),
    );
    if (!result.profileSyncResult) throw new Error('profile sync result is required');
    expect(result.profileSyncResult.discontinued).toBe(0);
  });
});
