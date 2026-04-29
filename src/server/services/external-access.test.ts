import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import type { MemberRole } from '@prisma/client';

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
  normalizeExternalAccessScope,
  validateExternalAccessScopeForRole,
  validateExternalAccessGrant,
} from './external-access';

describe('external access scope validation', () => {
  it('rejects unknown scope keys', () => {
    const result = normalizeExternalAccessScope({
      medication_list: true,
      clinical_notes: true,
    });

    expect(result).toMatchObject({
      ok: false,
      kind: 'validation',
      message: '共有範囲が不正です',
      details: { unknown_scope_keys: ['clinical_notes'] },
    });
  });

  it('rejects non-boolean known scope values', () => {
    const result = normalizeExternalAccessScope({
      medication_list: 'yes',
    });

    expect(result).toMatchObject({
      ok: false,
      kind: 'validation',
      details: { invalid_scope_keys: ['medication_list'] },
    });
  });

  it('requires visit permission for medication and allergy scopes', () => {
    const clerkResult = validateExternalAccessScopeForRole(
      {
        medication_list: true,
        allergy_info: true,
      },
      'clerk' as MemberRole,
    );
    const pharmacistResult = validateExternalAccessScopeForRole(
      {
        medication_list: true,
        allergy_info: true,
      },
      'pharmacist' as MemberRole,
    );

    expect(clerkResult).toMatchObject({
      ok: false,
      kind: 'permission',
      details: { denied_scope_keys: ['allergy_info', 'medication_list'] },
    });
    expect(pharmacistResult).toMatchObject({
      ok: true,
      scope: {
        medication_list: true,
        allergy_info: true,
      },
    });
  });

  it('requires send-report permission for report-bearing scopes', () => {
    const clerkResult = validateExternalAccessScopeForRole(
      {
        care_reports: true,
        self_report_history: true,
      },
      'clerk' as MemberRole,
    );
    const pharmacistResult = validateExternalAccessScopeForRole(
      {
        care_reports: true,
        self_report_history: true,
      },
      'pharmacist' as MemberRole,
    );

    expect(clerkResult).toMatchObject({
      ok: false,
      kind: 'permission',
      details: { denied_scope_keys: ['care_reports', 'self_report_history'] },
    });
    expect(pharmacistResult).toMatchObject({
      ok: true,
      scope: {
        care_reports: true,
        self_report_history: true,
      },
    });
  });

  it('requires visit permission for visit schedule scope', () => {
    const result = validateExternalAccessScopeForRole(
      {
        medication_list: true,
        visit_schedule: true,
      },
      'clerk' as MemberRole,
    );

    expect(result).toMatchObject({
      ok: false,
      kind: 'permission',
      details: { denied_scope_keys: ['medication_list', 'visit_schedule'] },
    });
  });
});

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
      ]),
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
      otp_hash: bcrypt.hashSync('123456', 4),
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

  it('accepts legacy SHA-256 OTP hashes for pre-migration grants', async () => {
    const token = await issueExternalAccessToken({
      grantId: 'grant_legacy',
      orgId: 'org_1',
      patientId: 'patient_1',
      expiresHours: 72,
    });

    prismaMock.externalAccessGrant.findUnique.mockResolvedValue({
      id: 'grant_legacy',
      org_id: 'org_1',
      patient_id: 'patient_1',
      otp_hash: await hashExternalAccessOtp('654321'),
      expires_at: new Date('2026-04-01T00:00:00.000Z'),
      revoked_at: null,
      scope: { medication_list: true },
    });

    const result = await validateExternalAccessGrant(token, '654321');

    expect(result).toMatchObject({
      ok: true,
      grant: expect.objectContaining({
        id: 'grant_legacy',
      }),
    });
  });

  it('fails closed when a stored grant is missing an OTP hash', async () => {
    const token = await issueExternalAccessToken({
      grantId: 'grant_without_otp',
      orgId: 'org_1',
      patientId: 'patient_1',
      expiresHours: 72,
    });

    prismaMock.externalAccessGrant.findUnique.mockResolvedValue({
      id: 'grant_without_otp',
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
      kind: 'validation',
      message: 'OTPが必要です',
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

  it('rejects expired grants', async () => {
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
      otp_hash: bcrypt.hashSync('123456', 4),
      expires_at: new Date('2026-03-29T23:59:59.000Z'),
      revoked_at: null,
      scope: { medication_list: true },
    });

    const result = await validateExternalAccessGrant(token, '123456');

    expect(result).toMatchObject({
      ok: false,
      kind: 'not_found',
      message: '共有リンクが無効または期限切れです',
    });
  });

  it('rejects revoked grants', async () => {
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
      otp_hash: bcrypt.hashSync('123456', 4),
      expires_at: new Date('2026-04-01T00:00:00.000Z'),
      revoked_at: new Date('2026-03-30T00:00:00.000Z'),
      scope: { medication_list: true },
    });

    const result = await validateExternalAccessGrant(token, '123456');

    expect(result).toMatchObject({
      ok: false,
      kind: 'not_found',
      message: '共有リンクが無効または期限切れです',
    });
  });

  it('rejects malformed legacy OTP hashes without throwing', async () => {
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
      otp_hash: 'abc123',
      expires_at: new Date('2026-04-01T00:00:00.000Z'),
      revoked_at: null,
      scope: { medication_list: true },
    });

    await expect(validateExternalAccessGrant(token, '123456')).resolves.toMatchObject({
      ok: false,
      kind: 'validation',
      message: 'OTPが正しくありません',
    });
  });

  it('rejects grants whose stored scope contains unknown keys', async () => {
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
      otp_hash: null,
      expires_at: new Date('2026-04-01T00:00:00.000Z'),
      revoked_at: null,
      scope: { medication_list: true, clinical_notes: true },
    });

    const result = await validateExternalAccessGrant(token, null);

    expect(result).toMatchObject({
      ok: false,
      kind: 'validation',
      message: '共有範囲が不正です',
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
      }),
    ).rejects.toBeInstanceOf(MissingExternalAccessSecretError);

    const result = await validateExternalAccessGrant('forged-token', null);
    expect(result).toMatchObject({
      ok: false,
      kind: 'not_found',
    });
  });
});
