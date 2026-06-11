import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getPatientVisitRecordRecord,
  getVisitRecordEntry,
} from '@/server/services/pdf-visit-record';
import { PdfNotFoundError } from './pdf-errors';

const {
  auditLogFindManyMock,
  patientFindFirstMock,
  patientFindManyMock,
  residualMedicationFindManyMock,
  userFindManyMock,
  visitRecordFindManyMock,
} = vi.hoisted(() => ({
  auditLogFindManyMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  residualMedicationFindManyMock: vi.fn(),
  userFindManyMock: vi.fn(),
  visitRecordFindManyMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    auditLog: {
      findMany: auditLogFindManyMock,
    },
    patient: {
      findFirst: patientFindFirstMock,
      findMany: patientFindManyMock,
    },
    residualMedication: {
      findMany: residualMedicationFindManyMock,
    },
    user: {
      findMany: userFindManyMock,
    },
    visitRecord: {
      findMany: visitRecordFindManyMock,
    },
  },
}));

const patient = {
  id: 'patient_1',
  name: '山田 太郎',
  birth_date: new Date(1940, 0, 1),
  gender: 'male',
};

const visitRecord = {
  id: 'visit_1',
  patient_id: 'patient_1',
  pharmacist_id: 'pharmacist_1',
  visit_date: new Date(2026, 3, 10),
  outcome_status: 'completed',
  soap_subjective: '眠気あり',
  soap_objective: null,
  soap_assessment: '経過観察',
  soap_plan: '次回確認',
  receipt_person_name: '家族',
  receipt_person_relation: '長女',
  receipt_at: new Date(2026, 3, 10, 10, 30),
  next_visit_suggestion_date: null,
  cancellation_reason: null,
  postpone_reason: null,
  revisit_reason: null,
  version: 3,
  created_at: new Date(2026, 3, 10, 9),
  updated_at: new Date(2026, 3, 10, 11),
  schedule: {
    case_id: 'case_1',
    visit_type: 'regular',
    scheduled_date: new Date(2026, 3, 10),
    case_: {
      patient_id: 'patient_1',
    },
  },
};

describe('pdf visit record fetchers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patientFindFirstMock.mockResolvedValue(patient);
    patientFindManyMock.mockResolvedValue([patient]);
    residualMedicationFindManyMock.mockResolvedValue([]);
    auditLogFindManyMock.mockResolvedValue([]);
    userFindManyMock.mockResolvedValue([{ id: 'pharmacist_1', name: '佐藤 薬剤師' }]);
    visitRecordFindManyMock.mockResolvedValue([visitRecord]);
  });

  it('does not query visit records until patient access succeeds for patient-list PDFs', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    await expect(getPatientVisitRecordRecord('org_1', 'patient_1')).rejects.toBeInstanceOf(
      PdfNotFoundError,
    );

    expect(patientFindFirstMock).toHaveBeenCalledOnce();
    expect(visitRecordFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects visit records whose schedule case points at another patient', async () => {
    visitRecordFindManyMock.mockResolvedValue([
      {
        ...visitRecord,
        schedule: {
          ...visitRecord.schedule,
          case_: {
            patient_id: 'other_patient',
          },
        },
      },
    ]);

    await expect(getVisitRecordEntry('org_1', 'visit_1')).rejects.toBeInstanceOf(PdfNotFoundError);

    expect(patientFindManyMock).not.toHaveBeenCalled();
    expect(residualMedicationFindManyMock).not.toHaveBeenCalled();
  });

  it('hydrates patient, residual, pharmacist, and latest audit actor details', async () => {
    residualMedicationFindManyMock.mockResolvedValue([
      {
        id: 'residual_1',
        visit_record_id: 'visit_1',
        drug_name: '残薬A',
        drug_code: 'YJ123',
        prescribed_quantity: 14,
        remaining_quantity: 3,
        excess_days: 2,
        is_prohibited_reduction: false,
        is_reduction_target: true,
      },
    ]);
    auditLogFindManyMock.mockResolvedValue([
      {
        target_id: 'visit_1',
        actor_id: 'modifier_1',
        created_at: new Date(2026, 3, 10, 12),
      },
    ]);
    userFindManyMock.mockResolvedValue([
      { id: 'pharmacist_1', name: '佐藤 薬剤師' },
      { id: 'modifier_1', name: '田中 管理者' },
    ]);

    await expect(getVisitRecordEntry('org_1', 'visit_1')).resolves.toMatchObject({
      id: 'visit_1',
      patient,
      pharmacist_name: '佐藤 薬剤師',
      last_modified_by_id: 'modifier_1',
      last_modified_by_name: '田中 管理者',
      residuals: [
        {
          id: 'residual_1',
          drug_name: '残薬A',
          drug_code: 'YJ123',
          remaining_quantity: 3,
          is_reduction_target: true,
        },
      ],
    });

    expect(visitRecordFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { org_id: 'org_1', id: 'visit_1' },
      }),
    );
    expect(userFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        id: { in: ['pharmacist_1', 'modifier_1'] },
      },
      select: {
        id: true,
        name: true,
      },
    });
  });
});
