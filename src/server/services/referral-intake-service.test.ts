import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContext } from '@/lib/auth/context';
import type { CreateReferralInput } from '@/lib/validations/referral';

const {
  patientFindManyMock,
  patientCreateMock,
  patientInsuranceCreateManyMock,
  residenceCreateMock,
  careCaseCreateMock,
  withOrgContextMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  patientFindManyMock: vi.fn(),
  patientCreateMock: vi.fn(),
  patientInsuranceCreateManyMock: vi.fn(),
  residenceCreateMock: vi.fn(),
  careCaseCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findMany: patientFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
}));

import {
  buildReferralAuditChanges,
  buildReferralRequiredVisitSupport,
  createReferralIntake,
  ReferralIntakeTransactionError,
} from './referral-intake-service';

const ctx = {
  orgId: 'org_1',
  userId: 'user_1',
  role: 'pharmacist',
  actorSiteId: 'site_1',
  actorPharmacyId: 'org_1',
} as AuthContext;

const sensitiveInput = {
  name: 'Sensitive Patient',
  name_kana: 'Sensitive Kana',
  birth_date: '1950-01-01',
  gender: 'female',
  phone: '090-0000-0000',
  medical_insurance_number: 'medical-secret-123',
  care_insurance_number: 'care-secret-456',
  address: 'Sensitive Address 1-2-3',
  referral_type: 'physician',
  referral_source: 'Sensitive Clinic',
  referral_date: '2026-06-23',
  referral_notes: 'Sensitive referral note',
  doc_physician_order: true,
  doc_consent: false,
  doc_health_insurance: true,
  doc_care_insurance: false,
} satisfies CreateReferralInput;

function createTx() {
  return {
    patient: {
      create: patientCreateMock,
    },
    patientInsurance: {
      createMany: patientInsuranceCreateManyMock,
    },
    residence: {
      create: residenceCreateMock,
    },
    careCase: {
      create: careCaseCreateMock,
    },
  };
}

let tx: ReturnType<typeof createTx>;

describe('createReferralIntake', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx = createTx();
    patientFindManyMock.mockResolvedValue([]);
    patientCreateMock.mockResolvedValue({ id: 'patient_new' });
    patientInsuranceCreateManyMock.mockResolvedValue({ count: 2 });
    residenceCreateMock.mockResolvedValue({ id: 'residence_new' });
    careCaseCreateMock.mockResolvedValue({ id: 'case_new' });
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) => callback(tx));
  });

  it('creates one patient and exactly one care case in one org transaction', async () => {
    const result = await createReferralIntake(ctx, sensitiveInput);

    expect(result).toEqual({
      status: 'created',
      patient: { id: 'patient_new' },
      case: { id: 'case_new' },
      warnings: [],
      metadata: { duplicate_count: 0 },
    });
    expect(withOrgContextMock).toHaveBeenCalledOnce();
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: ctx,
    });
    expect(patientCreateMock).toHaveBeenCalledOnce();
    expect(careCaseCreateMock).toHaveBeenCalledOnce();
    expect(patientInsuranceCreateManyMock).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ insurance_type: 'medical', patient_id: 'patient_new' }),
        expect.objectContaining({ insurance_type: 'care', patient_id: 'patient_new' }),
      ]),
    });
    expect(residenceCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        patient_id: 'patient_new',
        is_primary: true,
      }),
    });
  });

  it('stores referral intake under a dedicated required_visit_support namespace', async () => {
    await createReferralIntake(ctx, sensitiveInput);

    expect(careCaseCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        required_visit_support: {
          referral_intake: {
            schema_version: 1,
            referral_type: 'physician',
            document_checklist: {
              physician_order: true,
              consent: false,
              health_insurance: true,
              care_insurance: false,
            },
            document_received_count: 2,
            document_total: 4,
          },
        },
      }),
    });
  });

  it('preserves unrelated required_visit_support namespaces when building referral intake', () => {
    const result = buildReferralRequiredVisitSupport(
      {
        home_visit_intake: { schema_version: 1, existing: true },
        set_pilot_enabled: true,
      },
      sensitiveInput,
    );

    expect(result).toMatchObject({
      home_visit_intake: { schema_version: 1, existing: true },
      set_pilot_enabled: true,
      referral_intake: {
        referral_type: 'physician',
        document_received_count: 2,
      },
    });
  });

  it('does not write when an unacknowledged duplicate exists and returns a PHI-free duplicate summary', async () => {
    patientFindManyMock.mockResolvedValueOnce([
      {
        id: 'patient_existing',
        name: 'Sensitive Patient',
        name_kana: 'Sensitive Kana',
        birth_date: new Date('1950-01-01T00:00:00.000Z'),
        gender: 'female',
      },
    ]);

    const result = await createReferralIntake(ctx, sensitiveInput);

    expect(result).toEqual({
      status: 'duplicate',
      duplicate_count: 1,
      duplicates: [{ id: 'patient_existing' }],
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientCreateMock).not.toHaveBeenCalled();
    expect(careCaseCreateMock).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('Sensitive Patient');
    expect(JSON.stringify(result)).not.toContain('Sensitive Kana');
  });

  it('creates once when a duplicate is explicitly acknowledged', async () => {
    patientFindManyMock.mockResolvedValueOnce([
      {
        id: 'patient_existing',
        name: 'Sensitive Patient',
        name_kana: 'Sensitive Kana',
        birth_date: new Date('1950-01-01T00:00:00.000Z'),
        gender: 'female',
      },
    ]);

    const result = await createReferralIntake(ctx, {
      ...sensitiveInput,
      duplicate_acknowledged: true,
    });

    expect(result).toMatchObject({
      status: 'created',
      patient: { id: 'patient_new' },
      case: { id: 'case_new' },
      warnings: [
        {
          code: 'PATIENT_DUPLICATE_ACKNOWLEDGED',
          severity: 'warning',
        },
      ],
      metadata: { duplicate_count: 1 },
    });
    expect(patientCreateMock).toHaveBeenCalledOnce();
    expect(careCaseCreateMock).toHaveBeenCalledOnce();
  });

  it('keeps audit changes structured and PHI-free', async () => {
    await createReferralIntake(ctx, sensitiveInput);

    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      tx,
      ctx,
      expect.objectContaining({
        action: 'referral_intake_create',
        targetType: 'CareCase',
        targetId: 'case_new',
        patientId: 'patient_new',
        changes: expect.objectContaining({
          patient_id: 'patient_new',
          case_id: 'case_new',
          referral_type: 'physician',
          has_referral_notes: true,
          has_address: true,
          has_medical_insurance_number: true,
          has_care_insurance_number: true,
        }),
      }),
    );
    const auditText = JSON.stringify(createAuditLogEntryMock.mock.calls);
    for (const sensitiveValue of [
      sensitiveInput.name,
      sensitiveInput.name_kana,
      sensitiveInput.phone,
      sensitiveInput.address,
      sensitiveInput.medical_insurance_number,
      sensitiveInput.care_insurance_number,
      sensitiveInput.referral_source,
      sensitiveInput.referral_notes,
    ]) {
      expect(auditText).not.toContain(sensitiveValue);
    }
  });

  it('exposes PHI-free audit helper output for direct regression coverage', () => {
    const changes = buildReferralAuditChanges(sensitiveInput, {
      patientId: 'patient_new',
      caseId: 'case_new',
    });

    const changesText = JSON.stringify(changes);
    expect(changes).toMatchObject({
      patient_id: 'patient_new',
      case_id: 'case_new',
      referral_type: 'physician',
      has_referral_source: true,
      has_referral_notes: true,
    });
    expect(changesText).not.toContain(sensitiveInput.name);
    expect(changesText).not.toContain(sensitiveInput.address);
    expect(changesText).not.toContain(sensitiveInput.referral_notes);
  });

  it('surfaces a fixed transaction error when case creation fails inside the transaction', async () => {
    careCaseCreateMock.mockRejectedValueOnce(
      new Error('case failed for Sensitive Patient with medical-secret-123'),
    );

    await expect(createReferralIntake(ctx, sensitiveInput)).rejects.toBeInstanceOf(
      ReferralIntakeTransactionError,
    );
    expect(withOrgContextMock).toHaveBeenCalledOnce();
    expect(patientCreateMock).toHaveBeenCalledOnce();
    expect(careCaseCreateMock).toHaveBeenCalledOnce();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});
