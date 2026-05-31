import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import type { MemberRole } from '@prisma/client';
import { encode } from 'next-auth/jwt';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    patient: { findFirst: vi.fn() },
    medicationProfile: { findMany: vi.fn() },
    careCase: { findMany: vi.fn() },
    visitSchedule: { findMany: vi.fn() },
    careReport: { findMany: vi.fn() },
    patientSelfReport: { findMany: vi.fn() },
    externalAccessGrant: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: prismaMock,
}));

import {
  buildExternalAccessGrantVisibilityWhere,
  buildExternalAccessPayload,
  externalAccessGrantVisibleForCaseIds,
  hashExternalAccessOtp,
  hashExternalAccessToken,
  issueExternalAccessToken,
  MissingExternalAccessSecretError,
  normalizeExternalAccessScope,
  normalizeStoredExternalAccessScope,
  toPublicExternalAccessScope,
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

  it('aligns medication-list sharing with visit permission by role', () => {
    const traineeResult = validateExternalAccessScopeForRole(
      { medication_list: true },
      'pharmacist_trainee' as MemberRole,
    );
    const clerkResult = validateExternalAccessScopeForRole(
      { medication_list: true },
      'clerk' as MemberRole,
    );

    expect(traineeResult).toMatchObject({
      ok: true,
      scope: { medication_list: true },
    });
    expect(clerkResult).toMatchObject({
      ok: false,
      kind: 'permission',
      details: { denied_scope_keys: ['medication_list'] },
    });
  });

  it('requires send-report permission for report-bearing scopes', () => {
    const clerkResult = validateExternalAccessScopeForRole(
      {
        care_reports: true,
      },
      'clerk' as MemberRole,
    );
    const pharmacistResult = validateExternalAccessScopeForRole(
      {
        care_reports: true,
      },
      'pharmacist' as MemberRole,
    );

    expect(clerkResult).toMatchObject({
      ok: false,
      kind: 'permission',
      details: { denied_scope_keys: ['care_reports'] },
    });
    expect(pharmacistResult).toMatchObject({
      ok: true,
      scope: {
        care_reports: true,
      },
    });
  });

  it('rejects self-report history sharing until it has a case-scoped data model', () => {
    const result = validateExternalAccessScopeForRole(
      {
        self_report_history: true,
      },
      'pharmacist' as MemberRole,
    );

    expect(result).toMatchObject({
      ok: false,
      kind: 'validation',
      message: 'この共有範囲は現在サポートされていません',
      details: { unsupported_scope_keys: ['self_report_history'] },
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

  it('accepts stored case boundaries but strips them from public scope output', () => {
    const result = normalizeStoredExternalAccessScope({
      care_reports: true,
      self_report_history: true,
      allowed_case_ids: ['case_1', 'case_1', 'case_2'],
    });

    expect(result).toMatchObject({
      ok: true,
      scope: {
        care_reports: true,
        self_report_history: true,
        allowed_case_ids: ['case_1', 'case_2'],
      },
    });
    expect(toPublicExternalAccessScope(result.ok ? result.scope : null)).toEqual({
      care_reports: true,
    });
    expect(externalAccessGrantVisibleForCaseIds(result.ok ? result.scope : null, ['case_2'])).toBe(
      true,
    );
    expect(externalAccessGrantVisibleForCaseIds(result.ok ? result.scope : null, ['case_3'])).toBe(
      false,
    );
  });

  it('builds DB visibility predicates for assignment-scoped grants', () => {
    expect(buildExternalAccessGrantVisibilityWhere(undefined)).toEqual({});
    expect(buildExternalAccessGrantVisibilityWhere([])).toMatchObject({
      OR: [
        expect.objectContaining({
          AND: expect.arrayContaining([
            {
              OR: [
                { scope: { path: ['allergy_info'], equals: true } },
                { scope: { path: ['medication_list'], equals: true } },
              ],
            },
          ]),
        }),
      ],
    });
    expect(JSON.stringify(buildExternalAccessGrantVisibilityWhere([]))).not.toContain(
      'array_contains',
    );

    const scopedWhere = buildExternalAccessGrantVisibilityWhere(['case_2', 'case_1', 'case_1']);

    expect(scopedWhere).toMatchObject({
      OR: [
        expect.any(Object),
        {
          AND: [
            expect.objectContaining({
              OR: expect.arrayContaining([
                { scope: { path: ['visit_schedule'], equals: true } },
                { scope: { path: ['care_reports'], equals: true } },
                { scope: { path: ['self_report_history'], equals: true } },
              ]),
            }),
            { scope: { path: ['allowed_case_ids'], array_contains: ['case_1'] } },
          ],
        },
        {
          AND: [
            expect.any(Object),
            { scope: { path: ['allowed_case_ids'], array_contains: ['case_2'] } },
          ],
        },
      ],
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
    prismaMock.patientSelfReport.findMany.mockResolvedValue([]);
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
        allowed_case_ids: ['case_1'],
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

  it('fails closed for legacy case-backed grants without a stored case boundary', async () => {
    const payload = await buildExternalAccessPayload({
      id: 'grant_legacy',
      org_id: 'org_1',
      patient_id: 'patient_1',
      otp_hash: 'otp_hash',
      expires_at: new Date('2026-04-01T00:00:00.000Z'),
      revoked_at: null,
      scope: { care_reports: true },
    });

    expect(payload).toBeNull();
    expect(prismaMock.careReport.findMany).not.toHaveBeenCalled();
    expect(prismaMock.careCase.findMany).not.toHaveBeenCalled();
  });

  it('fails closed for stored grants that only contain unsupported public scopes', async () => {
    const payload = await buildExternalAccessPayload({
      id: 'grant_self_report_only',
      org_id: 'org_1',
      patient_id: 'patient_1',
      otp_hash: 'otp_hash',
      expires_at: new Date('2026-04-01T00:00:00.000Z'),
      revoked_at: null,
      scope: { self_report_history: true, allowed_case_ids: ['case_1'] },
    });

    expect(payload).toBeNull();
    expect(prismaMock.patient.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.patientSelfReport.findMany).not.toHaveBeenCalled();
  });

  it('limits case-backed payload reads to the stored grant case boundary', async () => {
    prismaMock.careCase.findMany.mockResolvedValue([{ id: 'case_allowed' }]);
    prismaMock.visitSchedule.findMany.mockResolvedValue([]);
    prismaMock.careReport.findMany.mockResolvedValue([]);

    const payload = await buildExternalAccessPayload({
      id: 'grant_1',
      org_id: 'org_1',
      patient_id: 'patient_1',
      otp_hash: 'otp_hash',
      expires_at: new Date('2026-04-01T00:00:00.000Z'),
      revoked_at: null,
      scope: {
        visit_schedule: true,
        care_reports: true,
        self_report_history: true,
        allowed_case_ids: ['case_allowed'],
      },
    });

    expect(payload).not.toBeNull();
    expect(prismaMock.careCase.findMany).toHaveBeenCalledWith({
      where: {
        patient_id: 'patient_1',
        org_id: 'org_1',
        status: 'active',
        id: { in: ['case_allowed'] },
      },
      select: { id: true },
    });
    expect(prismaMock.visitSchedule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          case_id: { in: ['case_allowed'] },
        }),
      }),
    );
    expect(prismaMock.careReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          case_id: { in: ['case_allowed'] },
        }),
      }),
    );
    expect(prismaMock.patientSelfReport.findMany).not.toHaveBeenCalled();
    expect(payload?.self_report_history).toEqual([]);
    expect(payload?.scope).toEqual({
      visit_schedule: true,
      care_reports: true,
    });
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

  it('rejects signed tokens with malformed external access payloads before DB lookup', async () => {
    const token = await encode({
      secret: 'test-secret',
      salt: 'ph-os-external-access',
      maxAge: 72 * 60 * 60,
      token: {
        sub: 'grant_1',
        grant_id: '',
        org_id: 'org_1',
        patient_id: 'patient_1',
        purpose: 'external_access_grant',
      },
    });

    const result = await validateExternalAccessGrant(token, null);

    expect(result).toMatchObject({
      ok: false,
      kind: 'not_found',
      message: '共有リンクが無効です',
    });
    expect(prismaMock.externalAccessGrant.findUnique).not.toHaveBeenCalled();
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
