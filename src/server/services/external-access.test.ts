import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import type { MemberRole } from '@prisma/client';
import { encode } from 'next-auth/jwt';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $transaction: vi.fn(),
    patient: { findFirst: vi.fn() },
    medicationProfile: { findMany: vi.fn() },
    careCase: { findMany: vi.fn() },
    visitSchedule: { findMany: vi.fn() },
    careReport: { findMany: vi.fn() },
    patientSelfReport: { findMany: vi.fn() },
    inboundCommunicationEvent: { findMany: vi.fn() },
    inboundCommunicationSignal: { findMany: vi.fn() },
    externalAccessGrant: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: prismaMock,
}));

import {
  buildExternalAccessGrantVisibilityWhere,
  buildExternalAccessPayload,
  buildVisibleExternalAccessGrantWhere,
  externalAccessGrantVisibleForCaseIds,
  attachExternalAccessReportDocumentBoundary,
  hashExternalAccessOtp,
  hashExternalAccessToken,
  issueExternalAccessToken,
  MissingExternalAccessSecretError,
  normalizeExternalAccessScope,
  normalizeStoredExternalAccessScope,
  recordExternalAccessViewed,
  toPublicExternalAccessScope,
  validateExternalAccessScopeForRole,
  validateExternalAccessGrant,
} from './external-access';
import {
  EXTERNAL_ACCESS_UNSUPPORTED_SCOPE_KEYS,
  externalAccessShareScopeRegistry,
} from './external-access-scope-registry';

describe('external access scope validation', () => {
  it('registers MOD-SHARE planned core and pharmacy scope metadata', () => {
    expect(externalAccessShareScopeRegistry.get('visit_schedule')).toMatchObject({
      module: 'core',
      requiredPermission: 'canVisit',
      requiresCaseBoundary: true,
      outputRisk: 'medium',
    });
    expect(externalAccessShareScopeRegistry.get('care_reports')).toMatchObject({
      module: 'core',
      requiredPermission: 'canSendCareReport',
      requiresCaseBoundary: true,
      requiresReportBoundary: true,
      outputRisk: 'high',
    });
    expect(externalAccessShareScopeRegistry.get('inbound_communication_summary')).toMatchObject({
      module: 'core',
      requiredPermission: 'canVisit',
      requiresCaseBoundary: true,
      outputRisk: 'high',
    });
    expect(externalAccessShareScopeRegistry.get('inbound_communication_detail')).toMatchObject({
      module: 'core',
      requiredPermission: 'canVisit',
      requiresCaseBoundary: true,
      outputRisk: 'high',
    });
    expect(externalAccessShareScopeRegistry.get('inbound_communication_raw_text')).toMatchObject({
      module: 'core',
      requiredPermission: 'canVisit',
      requiresCaseBoundary: true,
      outputRisk: 'high',
    });
    expect(externalAccessShareScopeRegistry.get('attachments')).toMatchObject({
      module: 'core',
      requiredPermission: 'canSendCareReport',
      outputRisk: 'high',
    });
    expect(externalAccessShareScopeRegistry.get('patient_summary')).toMatchObject({
      module: 'core',
      requiredPermission: 'canVisit',
      outputRisk: 'high',
    });
    expect(externalAccessShareScopeRegistry.get('medication_list')).toMatchObject({
      module: 'pharmacy',
      requiredPermission: 'canVisit',
      outputRisk: 'high',
    });
    expect(externalAccessShareScopeRegistry.get('allergy_info')).toMatchObject({
      module: 'pharmacy',
      requiredPermission: 'canVisit',
      outputRisk: 'high',
    });
    expect(externalAccessShareScopeRegistry.get('prescription_summary')).toMatchObject({
      module: 'pharmacy',
      requiredPermission: 'canVisit',
      outputRisk: 'high',
    });
    expect(externalAccessShareScopeRegistry.get('residual_medications')).toMatchObject({
      module: 'pharmacy',
      requiredPermission: 'canVisit',
      outputRisk: 'high',
    });
  });

  it('keeps planned but unimplemented scopes unsupported at write time', () => {
    expect(EXTERNAL_ACCESS_UNSUPPORTED_SCOPE_KEYS).toEqual(
      expect.arrayContaining([
        'attachments',
        'patient_summary',
        'prescription_summary',
        'residual_medications',
        'inbound_communication_detail',
        'inbound_communication_raw_text',
        'self_report_history',
      ]),
    );

    const result = validateExternalAccessScopeForRole(
      {
        attachments: true,
        patient_summary: true,
        prescription_summary: true,
        residual_medications: true,
        inbound_communication_detail: true,
        inbound_communication_raw_text: true,
      },
      'pharmacist' as MemberRole,
    );

    expect(result).toMatchObject({
      ok: false,
      kind: 'validation',
      message: 'この共有範囲は現在サポートされていません',
      details: {
        unsupported_scope_keys: [
          'inbound_communication_detail',
          'inbound_communication_raw_text',
          'attachments',
          'patient_summary',
          'prescription_summary',
          'residual_medications',
        ],
      },
    });
  });

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

  it('rejects non-object scope roots before key validation', () => {
    expect(normalizeExternalAccessScope(['medication_list'])).toMatchObject({
      ok: false,
      kind: 'validation',
      details: { scope: ['共有範囲はオブジェクトで指定してください'] },
    });
    expect(normalizeStoredExternalAccessScope(['care_reports'])).toMatchObject({
      ok: false,
      kind: 'validation',
      details: { scope: ['共有範囲はオブジェクトで指定してください'] },
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

  it('supports inbound communication summary while keeping detail and raw text fail-closed', () => {
    const summaryResult = validateExternalAccessScopeForRole(
      { inbound_communication_summary: true },
      'pharmacist' as MemberRole,
    );
    const detailResult = validateExternalAccessScopeForRole(
      { inbound_communication_detail: true },
      'pharmacist' as MemberRole,
    );
    const rawResult = validateExternalAccessScopeForRole(
      { inbound_communication_raw_text: true },
      'pharmacist' as MemberRole,
    );

    expect(summaryResult).toMatchObject({
      ok: true,
      scope: { inbound_communication_summary: true },
    });
    expect(detailResult).toMatchObject({
      ok: false,
      kind: 'validation',
      details: { unsupported_scope_keys: ['inbound_communication_detail'] },
    });
    expect(rawResult).toMatchObject({
      ok: false,
      kind: 'validation',
      details: { unsupported_scope_keys: ['inbound_communication_raw_text'] },
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
      attachments: true,
      prescription_summary: true,
      residual_medications: true,
      inbound_communication_summary: true,
      inbound_communication_detail: true,
      inbound_communication_raw_text: true,
      allowed_case_ids: ['case_1', 'case_1', 'case_2'],
      allowed_report_ids: ['report_1', 'report_1', 'report_2'],
    });

    expect(result).toMatchObject({
      ok: true,
      scope: {
        care_reports: true,
        self_report_history: true,
        attachments: true,
        prescription_summary: true,
        residual_medications: true,
        inbound_communication_summary: true,
        inbound_communication_detail: true,
        inbound_communication_raw_text: true,
        allowed_case_ids: ['case_1', 'case_2'],
        allowed_report_ids: ['report_1', 'report_2'],
      },
    });
    expect(toPublicExternalAccessScope(result.ok ? result.scope : null)).toEqual({
      care_reports: true,
      inbound_communication_summary: true,
    });
    expect(externalAccessGrantVisibleForCaseIds(result.ok ? result.scope : null, ['case_2'])).toBe(
      true,
    );
    expect(externalAccessGrantVisibleForCaseIds(result.ok ? result.scope : null, ['case_3'])).toBe(
      false,
    );
  });

  it('rejects malformed stored case boundaries', () => {
    expect(
      normalizeStoredExternalAccessScope({
        care_reports: true,
        allowed_case_ids: ['case_1', '  '],
      }),
    ).toMatchObject({
      ok: false,
      kind: 'validation',
      message: '共有範囲が不正です',
      details: { allowed_case_ids: ['許可ケースIDの形式が不正です'] },
    });
  });

  it('rejects raw file or metadata keys in stored scopes', () => {
    expect(
      normalizeStoredExternalAccessScope({
        medication_list: true,
        storage_key: 's3://private/key',
        original_filename: 'patient-name.pdf',
        raw_metadata: { source: 'upload' },
      }),
    ).toMatchObject({
      ok: false,
      kind: 'validation',
      message: '共有範囲が不正です',
      details: {
        unknown_scope_keys: ['storage_key', 'original_filename', 'raw_metadata'],
      },
    });
  });

  it('rejects malformed stored report document boundaries', () => {
    expect(
      normalizeStoredExternalAccessScope({
        care_reports: true,
        allowed_report_ids: ['report_1', '  '],
      }),
    ).toMatchObject({
      ok: false,
      kind: 'validation',
      message: '共有範囲が不正です',
      details: { allowed_report_ids: ['許可報告書IDの形式が不正です'] },
    });
    expect(
      normalizeStoredExternalAccessScope({
        medication_list: true,
        allowed_report_ids: ['report_1'],
      }),
    ).toMatchObject({
      ok: false,
      kind: 'validation',
      message: '共有範囲が不正です',
      details: { allowed_report_ids: ['報告書共有が有効な場合のみ指定できます'] },
    });
  });

  it('attaches report document boundaries without exposing them as public scope', () => {
    const scoped = attachExternalAccessReportDocumentBoundary(
      { care_reports: true, allowed_case_ids: ['case_1'] },
      ['report_1', 'report_1', 'report_2'],
    );

    expect(scoped).toEqual({
      care_reports: true,
      allowed_case_ids: ['case_1'],
      allowed_report_ids: ['report_1', 'report_2'],
    });
    expect(toPublicExternalAccessScope(scoped)).toEqual({ care_reports: true });
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
                { scope: { path: ['inbound_communication_summary'], equals: true } },
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

  it('builds patient-level visible grant predicates from the shared visibility helper', () => {
    const where = buildVisibleExternalAccessGrantWhere({
      orgId: 'org_1',
      patientId: 'patient_1',
      caseIds: ['case_2', 'case_1', 'case_1'],
    });

    expect(where).toMatchObject({
      org_id: 'org_1',
      patient_id: 'patient_1',
      revoked_at: null,
      OR: [
        expect.any(Object),
        {
          AND: [
            expect.any(Object),
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
      archived_at: null,
      phone: '090-0000-0000',
      allergy_info: 'penicillin',
    });
    prismaMock.medicationProfile.findMany.mockResolvedValue([]);
    prismaMock.careCase.findMany.mockResolvedValue([]);
    prismaMock.careReport.findMany.mockResolvedValue([]);
    prismaMock.patientSelfReport.findMany.mockResolvedValue([]);
    prismaMock.inboundCommunicationEvent.findMany.mockResolvedValue([]);
    prismaMock.inboundCommunicationSignal.findMany.mockResolvedValue([]);
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
        archived_at: true,
        allergy_info: true,
      },
    });
    expect(payload).toEqual(
      expect.objectContaining({
        patient: expect.objectContaining({
          archive: { status: 'active', archived: false, archived_at: null },
        }),
      }),
    );
  });

  it('exposes only minimal archive state in the external patient identity payload', async () => {
    prismaMock.patient.findFirst.mockResolvedValueOnce({
      id: 'patient_archived',
      name: '患者 アーカイブ',
      birth_date: new Date('1950-01-01T00:00:00.000Z'),
      gender: 'female',
      archived_at: new Date('2026-06-30T09:00:00.000Z'),
      archived_by: 'internal_user',
      allergy_info: null,
    });

    const payload = await buildExternalAccessPayload({
      id: 'grant_1',
      org_id: 'org_1',
      patient_id: 'patient_archived',
      otp_hash: 'otp_hash',
      expires_at: new Date('2026-04-01T00:00:00.000Z'),
      revoked_at: null,
      scope: { allergy_info: true },
    });

    expect(payload?.patient).toMatchObject({
      id: 'patient_archived',
      name: '患者 アーカイブ',
      archive: {
        status: 'archived',
        archived: true,
        archived_at: '2026-06-30T09:00:00.000Z',
      },
    });
    expect(JSON.stringify(payload)).not.toContain('internal_user');
    expect(JSON.stringify(payload)).not.toContain('archived_by');
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

  it('fails closed for stored grants that only contain planned unsupported scopes', async () => {
    const payload = await buildExternalAccessPayload({
      id: 'grant_planned_unsupported_only',
      org_id: 'org_1',
      patient_id: 'patient_1',
      otp_hash: 'otp_hash',
      expires_at: new Date('2026-04-01T00:00:00.000Z'),
      revoked_at: null,
      scope: {
        attachments: true,
        patient_summary: true,
        prescription_summary: true,
        residual_medications: true,
        inbound_communication_detail: true,
        inbound_communication_raw_text: true,
        allowed_case_ids: ['case_1'],
        allowed_report_ids: ['report_1'],
      },
    });

    expect(payload).toBeNull();
    expect(prismaMock.patient.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.careReport.findMany).not.toHaveBeenCalled();
  });

  it('fails closed for inbound communication summary grants without a stored case boundary', async () => {
    const payload = await buildExternalAccessPayload({
      id: 'grant_inbound_without_case_boundary',
      org_id: 'org_1',
      patient_id: 'patient_1',
      otp_hash: 'otp_hash',
      expires_at: new Date('2026-04-01T00:00:00.000Z'),
      revoked_at: null,
      scope: { inbound_communication_summary: true },
    });

    expect(payload).toBeNull();
    expect(prismaMock.patient.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.inboundCommunicationEvent.findMany).not.toHaveBeenCalled();
    expect(prismaMock.inboundCommunicationSignal.findMany).not.toHaveBeenCalled();
  });

  it('fails closed for malformed stored grant scope roots before patient lookup', async () => {
    const payload = await buildExternalAccessPayload({
      id: 'grant_malformed_scope',
      org_id: 'org_1',
      patient_id: 'patient_1',
      otp_hash: 'otp_hash',
      expires_at: new Date('2026-04-01T00:00:00.000Z'),
      revoked_at: null,
      scope: ['allergy_info'] as unknown as Parameters<
        typeof buildExternalAccessPayload
      >[0]['scope'],
    });

    expect(payload).toBeNull();
    expect(prismaMock.patient.findFirst).not.toHaveBeenCalled();
  });

  it('limits case-backed payload reads to the stored grant case boundary', async () => {
    prismaMock.patient.findFirst.mockResolvedValueOnce({
      id: 'patient_1',
      display_id: 'p0000000999',
      name: '患者 太郎',
      birth_date: new Date('1950-01-01T00:00:00.000Z'),
      gender: 'male',
      archived_at: null,
      phone: '090-0000-0000',
      allergy_info: 'penicillin',
    });
    prismaMock.careCase.findMany.mockResolvedValue([
      { id: 'case_allowed', display_id: 'cc0000000999' },
    ]);
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
    const payloadText = JSON.stringify(payload);
    expect(payloadText).not.toContain('display_id');
    expect(payloadText).not.toContain('p0000000999');
    expect(payloadText).not.toContain('cc0000000999');
  });

  it('filters shared upcoming visits from the Japan business date sentinel', async () => {
    vi.setSystemTime(new Date('2026-07-04T02:00:00+09:00'));
    prismaMock.careCase.findMany.mockResolvedValue([{ id: 'case_allowed' }]);
    prismaMock.visitSchedule.findMany.mockResolvedValue([]);

    const payload = await buildExternalAccessPayload({
      id: 'grant_1',
      org_id: 'org_1',
      patient_id: 'patient_1',
      otp_hash: 'otp_hash',
      expires_at: new Date('2026-07-05T00:00:00.000Z'),
      revoked_at: null,
      scope: {
        visit_schedule: true,
        allowed_case_ids: ['case_allowed'],
      },
    });

    expect(payload).not.toBeNull();
    expect(prismaMock.visitSchedule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          scheduled_date: {
            gte: new Date('2026-07-04T00:00:00.000Z'),
          },
        }),
      }),
    );
  });

  it('limits care report payload reads to the stored report document boundary', async () => {
    prismaMock.careReport.findMany.mockResolvedValue([
      {
        id: 'report_allowed',
        report_type: '訪問薬剤管理指導報告書',
        status: 'sent',
        created_at: new Date('2026-03-20T00:00:00.000Z'),
      },
    ]);

    const payload = await buildExternalAccessPayload({
      id: 'grant_report_document',
      org_id: 'org_1',
      patient_id: 'patient_1',
      otp_hash: 'otp_hash',
      expires_at: new Date('2026-04-01T00:00:00.000Z'),
      revoked_at: null,
      scope: {
        care_reports: true,
        allowed_case_ids: ['case_allowed'],
        allowed_report_ids: ['report_allowed'],
      },
    });

    expect(payload).not.toBeNull();
    expect(prismaMock.careReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['report_allowed'] },
          patient_id: 'patient_1',
          org_id: 'org_1',
          case_id: { in: ['case_allowed'] },
          status: { in: ['sent', 'confirmed'] },
        }),
      }),
    );
    expect(payload?.care_reports).toEqual([
      expect.objectContaining({
        id: 'report_allowed',
        report_type: '訪問薬剤管理指導報告書',
      }),
    ]);
    expect(payload?.scope).toEqual({ care_reports: true });
    expect(JSON.stringify(payload)).not.toContain('allowed_report_ids');
  });

  it('builds a case-scoped inbound communication summary from formal reviewed records only', async () => {
    prismaMock.inboundCommunicationEvent.findMany.mockResolvedValue([
      {
        received_at: new Date('2026-03-29T09:30:00.000Z'),
        source_channel: 'mcs',
        sender_role: 'nurse',
        event_type: 'care_coordination',
        has_medication_stock_signal: false,
        has_patient_safety_signal: true,
        has_schedule_signal: false,
        has_report_signal: true,
        raw_text: 'LEAK_RAW_TEXT',
        normalized_summary: 'LEAK_NORMALIZED_SUMMARY',
        sender_contact: 'LEAK_SENDER_CONTACT',
        external_url: 'LEAK_EXTERNAL_URL',
        display_id: 'LEAK_DISPLAY_ID',
        signals: [
          {
            signal_domain: 'report',
            signal_type: 'report_inclusion_candidate',
            extracted_text: 'LEAK_EXTRACTED_TEXT',
            extracted_quantity: 123,
            structured_payload: { leak: 'LEAK_STRUCTURED_PAYLOAD' },
          },
          {
            signal_domain: 'urgent',
            signal_type: 'urgent_review_required',
          },
        ],
        attachments: [{ file_asset_id: 'LEAK_FILE_ASSET_ID' }],
      },
    ]);
    prismaMock.inboundCommunicationSignal.findMany.mockResolvedValue([
      {
        signal_domain: 'report',
        signal_type: 'report_inclusion_candidate',
        action_status: 'linked_to_report',
        extracted_text: 'LEAK_EXTRACTED_TEXT',
        extracted_quantity: 123,
      },
      {
        signal_domain: 'urgent',
        signal_type: 'urgent_review_required',
        action_status: 'linked_to_task',
      },
    ]);

    const payload = await buildExternalAccessPayload({
      id: 'grant_inbound_summary',
      org_id: 'org_1',
      patient_id: 'patient_1',
      otp_hash: 'otp_hash',
      expires_at: new Date('2026-04-01T00:00:00.000Z'),
      revoked_at: null,
      scope: {
        inbound_communication_summary: true,
        inbound_communication_raw_text: true,
        allowed_case_ids: ['case_allowed'],
      },
    });

    const eventQuery = prismaMock.inboundCommunicationEvent.findMany.mock.calls[0]?.[0];
    const signalQuery = prismaMock.inboundCommunicationSignal.findMany.mock.calls[0]?.[0];

    expect(eventQuery).toMatchObject({
      where: {
        org_id: 'org_1',
        patient_id: 'patient_1',
        case_id: { in: ['case_allowed'] },
        direction: 'inbound',
        reviewed_at: { not: null },
        processing_status: { in: ['reviewed', 'converted_to_task', 'linked_to_workflow'] },
      },
      take: 200,
    });
    expect(signalQuery).toMatchObject({
      where: {
        org_id: 'org_1',
        patient_id: 'patient_1',
        case_id: { in: ['case_allowed'] },
        reviewed_at: { not: null },
        review_status: { in: ['accepted', 'record_only'] },
        action_status: {
          in: [
            'linked_to_stock_event',
            'linked_to_task',
            'linked_to_schedule',
            'linked_to_report',
            'linked_to_visit_brief',
          ],
        },
        inbound_event: expect.objectContaining({
          org_id: 'org_1',
          patient_id: 'patient_1',
          case_id: { in: ['case_allowed'] },
          direction: 'inbound',
          reviewed_at: { not: null },
          processing_status: { in: ['reviewed', 'converted_to_task', 'linked_to_workflow'] },
        }),
      },
      take: 200,
    });

    const eventSelect = JSON.stringify(eventQuery?.select ?? {});
    const signalSelect = JSON.stringify(signalQuery?.select ?? {});
    for (const forbiddenField of [
      'id',
      'display_id',
      'raw_text',
      'normalized_summary',
      'sender_contact',
      'external_url',
      'extracted_text',
      'extracted_medication_name',
      'extracted_quantity',
      'structured_payload',
      'file_asset_id',
    ]) {
      expect(eventSelect).not.toContain(forbiddenField);
      expect(signalSelect).not.toContain(forbiddenField);
    }

    expect(payload?.scope).toEqual({ inbound_communication_summary: true });
    expect(payload?.inbound_communication_summary).toMatchObject({
      version: 1,
      totals: {
        event_count: 1,
        signal_count: 2,
        safety_event_count: 1,
        report_event_count: 1,
        urgent_signal_count: 1,
        truncated: false,
      },
      event_type_counts: [{ event_type: 'care_coordination', label: '連携事項', count: 1 }],
      source_channel_counts: [{ source_channel: 'mcs', label: 'MCS', count: 1 }],
      signal_domain_counts: expect.arrayContaining([
        { signal_domain: 'report', label: '報告', count: 1 },
        { signal_domain: 'urgent', label: '至急', count: 1 },
      ]),
      recent_events: [
        expect.objectContaining({
          event_type: 'care_coordination',
          event_type_label: '連携事項',
          source_channel: 'mcs',
          source_channel_label: 'MCS',
          sender_role: 'nurse',
          sender_role_label: '看護師',
        }),
      ],
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('LEAK_');
    expect(serialized).not.toContain('allowed_case_ids');
    expect(serialized).not.toContain('inbound_communication_raw_text');
  });
});

describe('recordExternalAccessViewed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-30T10:15:00.000Z'));
    prismaMock.$transaction.mockImplementation(async (work) => work(prismaMock));
    prismaMock.externalAccessGrant.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit_1' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks the grant viewed and records scope/IP/UA audit evidence in one transaction', async () => {
    await recordExternalAccessViewed({
      grant: {
        id: 'grant_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        granted_to_name: '田中ケアマネ',
        granted_to_contact: '09012345678',
        otp_hash: 'otp_hash',
        expires_at: new Date('2026-03-31T00:00:00.000Z'),
        revoked_at: null,
        scope: {
          medication_list: true,
          care_reports: true,
          allowed_case_ids: ['case_1'],
        },
      },
      ipAddress: '203.0.113.10',
      userAgent: 'ExternalBrowser/1.0',
    });

    expect(prismaMock.$transaction).toHaveBeenCalledOnce();
    expect(prismaMock.externalAccessGrant.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'grant_1',
        org_id: 'org_1',
      },
      data: {
        accessed_at: new Date('2026-03-30T10:15:00.000Z'),
      },
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        actor_id: 'external_access:grant_1',
        patient_id: 'patient_1',
        action: 'external_access_payload_viewed',
        target_type: 'external_access_grant',
        target_id: 'grant_1',
        ip_address: '203.0.113.10',
        user_agent: 'ExternalBrowser/1.0',
        changes: expect.objectContaining({
          patient_id: 'patient_1',
          viewed_at: '2026-03-30T10:15:00.000Z',
          granted_to_name: '田中ケアマネ',
          granted_to_contact_masked: '090****5678',
          scope: {
            medication_list: true,
            care_reports: true,
          },
          scope_keys: ['medication_list', 'care_reports'],
        }),
      }),
    });
  });

  it('does not write view audit evidence when the grant row cannot be marked viewed', async () => {
    prismaMock.externalAccessGrant.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      recordExternalAccessViewed({
        grant: {
          id: 'grant_1',
          org_id: 'org_1',
          patient_id: 'patient_1',
          granted_to_name: '田中ケアマネ',
          granted_to_contact: null,
          otp_hash: 'otp_hash',
          expires_at: new Date('2026-03-31T00:00:00.000Z'),
          revoked_at: null,
          scope: { medication_list: true },
        },
      }),
    ).rejects.toThrow('EXTERNAL_ACCESS_VIEW_MARK_FAILED');

    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
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
        granted_to_name: true,
        granted_to_contact: true,
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
