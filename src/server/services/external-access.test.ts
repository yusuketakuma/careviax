import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    patient: { findFirst: vi.fn() },
    medicationProfile: { findMany: vi.fn() },
    careCase: { findMany: vi.fn() },
    visitSchedule: { findMany: vi.fn() },
    careReport: { findMany: vi.fn() },
    externalAccessGrant: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: prismaMock,
}));

import {
  buildExternalAccessPayload,
  hashExternalAccessOtp,
  hashExternalAccessToken,
  issueExternalAccessToken,
  MissingExternalAccessSecretError,
  validateExternalAccessGrant,
} from './external-access';

describe('buildExternalAccessPayload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-30T00:00:00.000Z'));
    process.env.NEXTAUTH_SECRET = 'test-secret';
    prismaMock.patient.findFirst.mockResolvedValue({
      id: 'patient_1',
      name: '患者 太郎',
      birth_date: new Date('1950-01-01T00:00:00.000Z'),
      gender: 'male',
      phone: '090-0000-0000',
      allergy_info: 'penicillin',
    });
    prismaMock.medicationProfile.findMany.mockResolvedValue([]);
    prismaMock.careCase.findMany.mockResolvedValue([]);
    prismaMock.careReport.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not expose patient phone when scope does not explicitly allow it', async () => {
    const payload = await buildExternalAccessPayload({
      id: 'grant_1',
      org_id: 'org_1',
      patient_id: 'patient_1',
      otp_hash: 'otp_hash',
      expires_at: new Date('2026-04-01T00:00:00.000Z'),
      revoked_at: null,
      scope: { allergy_info: true },
    });

    expect(payload).not.toBeNull();
    expect(prismaMock.patient.findFirst).toHaveBeenCalledWith({
      where: { id: 'patient_1', org_id: 'org_1' },
      select: {
        id: true,
        name: true,
        birth_date: true,
        gender: true,
        allergy_info: true,
      },
    });
  });

  it('builds a scoped shared summary from medication, visit, and report data', async () => {
    prismaMock.medicationProfile.findMany.mockResolvedValue([
      {
        id: 'med_1',
        drug_name: 'アムロジピン錠5mg',
        dose: '1錠',
        frequency: '1日1回 朝食後',
        start_date: new Date('2026-03-01T00:00:00.000Z'),
        end_date: null,
        is_current: true,
      },
      {
        id: 'med_2',
        drug_name: 'ロキソプロフェン錠',
        dose: '頓服1錠',
        frequency: '痛み時',
        start_date: new Date('2026-03-10T00:00:00.000Z'),
        end_date: null,
        is_current: true,
      },
    ]);
    prismaMock.careCase.findMany.mockResolvedValue([{ id: 'case_1' }]);
    prismaMock.visitSchedule.findMany.mockResolvedValue([
      {
        id: 'visit_1',
        scheduled_date: new Date('2026-04-02T00:00:00.000Z'),
        time_window_start: null,
        time_window_end: null,
        schedule_status: 'scheduled',
      },
    ]);
    prismaMock.careReport.findMany.mockResolvedValue([
      {
        id: 'report_1',
        report_type: '訪問薬剤管理指導報告書',
        status: 'sent',
        created_at: new Date('2026-03-20T00:00:00.000Z'),
      },
    ]);

    const payload = await buildExternalAccessPayload({
      id: 'grant_1',
      org_id: 'org_1',
      patient_id: 'patient_1',
      otp_hash: 'otp_hash',
      expires_at: new Date('2026-04-01T00:00:00.000Z'),
      revoked_at: null,
      scope: {
        allergy_info: true,
        medication_list: true,
        visit_schedule: true,
        care_reports: true,
      },
    });

    expect(payload?.shared_summary).toMatchObject({
      headline: expect.stringContaining('服薬中 2剤'),
      key_medications: ['アムロジピン錠5mg', 'ロキソプロフェン錠'],
      next_visit_date: '2026-04-02T00:00:00.000Z',
    });
    expect(payload?.shared_summary.bullets).toEqual(
      expect.arrayContaining([
        expect.stringContaining('主な処方薬: アムロジピン錠5mg / ロキソプロフェン錠'),
        expect.stringContaining('直近の訪問予定'),
        expect.stringContaining('最新の共有報告'),
        'アレルギー情報を共有しています。',
      ])
    );
  });
});

describe('validateExternalAccessGrant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-30T00:00:00.000Z'));
    process.env.NEXTAUTH_SECRET = 'test-secret';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('validates a signed JWT token and matching OTP against the stored grant', async () => {
    const token = await issueExternalAccessToken({
      grantId: 'grant_1',
      orgId: 'org_1',
      patientId: 'patient_1',
      expiresHours: 72,
    });

    prismaMock.externalAccessGrant.findUnique.mockResolvedValue({
      id: 'grant_1',
      org_id: 'org_1',
      patient_id: 'patient_1',
      otp_hash: hashExternalAccessOtp('123456'),
      expires_at: new Date('2026-04-01T00:00:00.000Z'),
      revoked_at: null,
      scope: { medication_list: true },
    });

    const result = await validateExternalAccessGrant(token, '123456');

    expect(prismaMock.externalAccessGrant.findUnique).toHaveBeenCalledWith({
      where: { token_hash: hashExternalAccessToken(token) },
      select: {
        id: true,
        org_id: true,
        patient_id: true,
        otp_hash: true,
        expires_at: true,
        revoked_at: true,
        scope: true,
      },
    });
    expect(result).toMatchObject({
      ok: true,
      grant: expect.objectContaining({
        id: 'grant_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
      }),
    });
  });

  it('rejects tokens whose signed payload does not match the stored grant', async () => {
    const token = await issueExternalAccessToken({
      grantId: 'grant_1',
      orgId: 'org_1',
      patientId: 'patient_1',
      expiresHours: 72,
    });

    prismaMock.externalAccessGrant.findUnique.mockResolvedValue({
      id: 'grant_2',
      org_id: 'org_1',
      patient_id: 'patient_1',
      otp_hash: null,
      expires_at: new Date('2026-04-01T00:00:00.000Z'),
      revoked_at: null,
      scope: { medication_list: true },
    });

    const result = await validateExternalAccessGrant(token, null);

    expect(result).toMatchObject({
      ok: false,
      kind: 'not_found',
    });
  });

  it('fails closed when no external access signing secret is configured', async () => {
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.EXTERNAL_ACCESS_TOKEN_SECRET;

    await expect(
      issueExternalAccessToken({
        grantId: 'grant_1',
        orgId: 'org_1',
        patientId: 'patient_1',
        expiresHours: 72,
      })
    ).rejects.toBeInstanceOf(MissingExternalAccessSecretError);

    const result = await validateExternalAccessGrant('forged-token', null);
    expect(result).toMatchObject({
      ok: false,
      kind: 'not_found',
    });
  });
});
