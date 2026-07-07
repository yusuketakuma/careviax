import { describe, expect, it, vi } from 'vitest';

import { findLatestPrescriberInstitutionSuggestion } from './prescriber-institutions';

describe('findLatestPrescriberInstitutionSuggestion', () => {
  it('uses a stable top-1 order and narrow projection for latest suggestions', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      prescribed_date: new Date('2026-07-07T00:00:00.000Z'),
      prescriber_name: '田中 医師',
      prescriber_institution_ref: {
        id: 'institution_1',
        name: 'みなとクリニック',
        phone: '03-1111-2222',
        fax: '03-1111-3333',
        address: '東京都港区1-1-1',
      },
    });
    const db = {
      prescriberInstitution: { findFirst: vi.fn() },
      prescriptionIntake: { findFirst },
    } as Parameters<typeof findLatestPrescriberInstitutionSuggestion>[0];

    const result = await findLatestPrescriberInstitutionSuggestion(db, 'org_1', {
      caseId: 'case_1',
      patientId: 'patient_1',
    });

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        prescriber_institution_id: {
          not: null,
        },
        cycle: {
          case_id: 'case_1',
          patient_id: 'patient_1',
        },
      },
      orderBy: [{ prescribed_date: 'desc' }, { created_at: 'desc' }, { id: 'desc' }],
      select: {
        prescribed_date: true,
        prescriber_name: true,
        prescriber_institution_ref: {
          select: {
            id: true,
            name: true,
            phone: true,
            fax: true,
            address: true,
          },
        },
      },
    });
    expect(result).toMatchObject({
      id: 'institution_1',
      name: 'みなとクリニック',
      prescribed_date: new Date('2026-07-07T00:00:00.000Z'),
    });
  });
});
