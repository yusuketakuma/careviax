import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import type { Prisma as PrismaTypes } from '@prisma/client';
import { createPartnerVisitPhysicianReportDraft } from './partner-visit-report-drafts';

const ctx = {
  orgId: 'org_1',
  userId: 'user_1',
  ipAddress: '203.0.113.10',
  userAgent: 'vitest',
};

const now = new Date('2026-06-19T00:00:00.000Z');

function confirmedPartnerVisitRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'partner_visit_record_1',
    org_id: 'org_1',
    visit_request_id: 'visit_request_1',
    share_case_id: 'share_case_1',
    owner_partner_pharmacy_id: 'partner_pharmacy_1',
    revision_no: 1,
    status: 'confirmed',
    pharmacist_name: '協力 太郎',
    visit_at: new Date('2026-06-18T01:30:00.000Z'),
    record_content: {
      medication_adherence: '患者名 山田花子: 飲み忘れあり',
      remaining_medications: 'A薬 10錠',
      suspected_adverse_effects: '眠気',
      storage_status: '冷蔵庫保管',
      proposals: '医師へ減量提案',
      adherence_score: 2,
    },
    attachments: [{ file_id: 'file_1' }],
    confirmed_at: new Date('2026-06-18T03:00:00.000Z'),
    updated_at: new Date('2026-06-18T03:10:00.000Z'),
    base_confirmation_snapshot: {
      doctor_report_required: true,
      next_action: 'doctor_report_draft',
    },
    owner_partner_pharmacy: {
      id: 'partner_pharmacy_1',
      name: '協力薬局',
      status: 'active',
    },
    share_case: {
      id: 'share_case_1',
      status: 'active',
      base_patient_id: 'patient_1',
      base_case_id: 'case_1',
      base_patient: {
        id: 'patient_1',
        name: '山田花子',
        birth_date: new Date('1940-01-01T00:00:00.000Z'),
        gender: 'female',
      },
      base_case: {
        id: 'case_1',
        required_visit_support: null,
      },
    },
    visit_request: {
      id: 'visit_request_1',
      status: 'confirmed',
      urgency: 'normal',
      request_reason: '残薬確認',
      physician_instruction: '眠気を確認',
      partnership: {
        id: 'partnership_1',
        status: 'active',
        base_site: { id: 'site_1', name: '基幹薬局' },
        partner_pharmacy: { id: 'partner_pharmacy_1', status: 'active' },
      },
    },
    ...overrides,
  };
}

function reportRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'report_1',
    org_id: 'org_1',
    patient_id: 'patient_1',
    case_id: 'case_1',
    partner_visit_record_id: 'partner_visit_record_1',
    report_type: 'physician_report',
    status: 'draft',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function createReportFromArgs(args: {
  data: {
    patient_id: string;
    case_id: string | null;
    partner_visit_record_id: string;
    report_type: 'physician_report';
    status: 'draft';
    content: unknown;
  };
}) {
  return reportRow({
    patient_id: args.data.patient_id,
    case_id: args.data.case_id,
    partner_visit_record_id: args.data.partner_visit_record_id,
    report_type: args.data.report_type,
    status: args.data.status,
  });
}

describe('createPartnerVisitPhysicianReportDraft', () => {
  const careReportFindFirstMock = vi.fn();
  const careReportCreateMock = vi.fn();
  const partnerVisitRecordFindFirstMock = vi.fn();
  const prescriptionIntakeFindFirstMock = vi.fn();
  const pharmacyVisitRequestUpdateManyMock = vi.fn();
  const auditLogCreateMock = vi.fn();

  function tx() {
    return {
      careReport: {
        findFirst: careReportFindFirstMock,
        create: careReportCreateMock,
      },
      partnerVisitRecord: {
        findFirst: partnerVisitRecordFindFirstMock,
      },
      prescriptionIntake: {
        findFirst: prescriptionIntakeFindFirstMock,
      },
      pharmacyVisitRequest: {
        updateMany: pharmacyVisitRequestUpdateManyMock,
      },
      auditLog: {
        create: auditLogCreateMock,
      },
    } as unknown as PrismaTypes.TransactionClient;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.clearAllMocks();
    careReportFindFirstMock.mockResolvedValue(null);
    careReportCreateMock.mockImplementation(async (args) => createReportFromArgs(args));
    partnerVisitRecordFindFirstMock.mockResolvedValue(confirmedPartnerVisitRecord());
    prescriptionIntakeFindFirstMock.mockResolvedValue({
      prescribed_date: new Date('2026-06-01T00:00:00.000Z'),
      prescriber_name: '佐藤医師',
      prescriber_institution_ref: {
        id: 'prescriber_1',
        name: '佐藤医院',
        phone: '03-0000-0000',
        fax: '03-0000-0001',
        address: '東京都',
      },
    });
    pharmacyVisitRequestUpdateManyMock.mockResolvedValue({ count: 1 });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
  });

  it('creates a physician report draft from a confirmed partner visit record without leaking content in response or audit', async () => {
    const result = await createPartnerVisitPhysicianReportDraft(tx(), ctx, {
      partnerVisitRecordId: 'partner_visit_record_1',
    });

    expect(result).toMatchObject({
      reused: false,
      report: {
        id: 'report_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        partner_visit_record_id: 'partner_visit_record_1',
        report_type: 'physician_report',
        status: 'draft',
        has_content: true,
      },
    });
    expect(careReportCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          org_id: 'org_1',
          patient_id: 'patient_1',
          case_id: 'case_1',
          partner_visit_record_id: 'partner_visit_record_1',
          report_type: 'physician_report',
          status: 'draft',
          created_by: 'user_1',
          content: expect.objectContaining({
            patient: expect.objectContaining({ name: '山田花子' }),
            medication_management: expect.objectContaining({
              compliance_summary: '患者名 山田花子: 飲み忘れあり',
              adherence_score: 2,
            }),
            prescriber: { name: '佐藤医師', institution: '佐藤医院' },
            source_provenance: expect.objectContaining({
              partner_visit_record_id: 'partner_visit_record_1',
              source: 'partner_visit_record',
            }),
          }),
        }),
      }),
    );
    expect(pharmacyVisitRequestUpdateManyMock).toHaveBeenCalledWith({
      where: { id: 'visit_request_1', org_id: 'org_1', status: 'confirmed' },
      data: { status: 'physician_report_created' },
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'partner_visit_physician_report_draft_created',
          target_type: 'CareReport',
          target_id: 'report_1',
          changes: expect.objectContaining({
            partner_visit_record_id: 'partner_visit_record_1',
            record_content_keys: [
              'adherence_score',
              'medication_adherence',
              'proposals',
              'remaining_medications',
              'storage_status',
              'suspected_adverse_effects',
            ],
            attachment_count: 1,
          }),
        }),
      }),
    );
    const responseText = JSON.stringify(result);
    const auditText = JSON.stringify(auditLogCreateMock.mock.calls);
    expect(responseText).not.toContain('山田花子');
    expect(responseText).not.toContain('飲み忘れ');
    expect(auditText).not.toContain('山田花子');
    expect(auditText).not.toContain('飲み忘れ');
    expect(auditText).not.toContain('A薬');
  });

  it('stores partner visit report DateTime instants as Japan business date keys across runtime timezones', async () => {
    const sourceUpdatedAt = new Date('2026-06-11T15:45:00.000Z');
    vi.setSystemTime(new Date('2026-06-11T15:30:00.000Z'));
    partnerVisitRecordFindFirstMock.mockResolvedValueOnce(
      confirmedPartnerVisitRecord({
        visit_at: new Date('2026-06-11T15:30:00.000Z'),
        updated_at: sourceUpdatedAt,
      }),
    );

    await createPartnerVisitPhysicianReportDraft(tx(), ctx, {
      partnerVisitRecordId: 'partner_visit_record_1',
    });

    expect(careReportCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.objectContaining({
            report_date: '2026-06-12',
            visit_date: '2026-06-12',
            source_provenance: expect.objectContaining({
              generated_at: '2026-06-11T15:30:00.000Z',
              partner_visit_record_updated_at: sourceUpdatedAt.toISOString(),
            }),
          }),
        }),
      }),
    );
  });

  it('returns an existing physician report draft idempotently without source or audit side effects', async () => {
    careReportFindFirstMock.mockResolvedValue(reportRow({ id: 'report_existing' }));

    const result = await createPartnerVisitPhysicianReportDraft(tx(), ctx, {
      partnerVisitRecordId: 'partner_visit_record_1',
    });

    expect(result).toMatchObject({
      reused: true,
      report: { id: 'report_existing', partner_visit_record_id: 'partner_visit_record_1' },
    });
    expect(partnerVisitRecordFindFirstMock).toHaveBeenCalled();
    expect(careReportCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects non-confirmed partner visit records before report or audit side effects', async () => {
    partnerVisitRecordFindFirstMock.mockResolvedValue(
      confirmedPartnerVisitRecord({ status: 'submitted', confirmed_at: null }),
    );

    await expect(
      createPartnerVisitPhysicianReportDraft(tx(), ctx, {
        partnerVisitRecordId: 'partner_visit_record_1',
      }),
    ).rejects.toMatchObject({
      code: 'PARTNER_VISIT_RECORD_NOT_CONFIRMED',
    });
    expect(careReportCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('reuses the existing draft when a concurrent create hits the DB unique guard', async () => {
    careReportFindFirstMock.mockResolvedValueOnce(null).mockResolvedValueOnce(reportRow());
    careReportCreateMock.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['org_id', 'partner_visit_record_id', 'report_type'] },
      }),
    );

    const result = await createPartnerVisitPhysicianReportDraft(tx(), ctx, {
      partnerVisitRecordId: 'partner_visit_record_1',
    });

    expect(result).toMatchObject({
      reused: true,
      report: { id: 'report_1', partner_visit_record_id: 'partner_visit_record_1' },
    });
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });
});
