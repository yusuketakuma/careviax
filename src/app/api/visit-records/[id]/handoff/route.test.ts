import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  canAccessVisitScheduleAssignmentMock,
  canConfirmVisitHandoffMock,
  canOverrideVisitHandoffConfirmationMock,
  canRequestSupervisedVisitHandoffConfirmationMock,
  selectVisitHandoffSupervisionAssigneeMock,
  buildVisitHandoffConfirmationWhereMock,
  visitRecordFindFirstMock,
  membershipFindFirstMock,
  visitHandoffExtractionFindFirstMock,
  confirmHandoffMock,
  readConfirmableHandoffDataMock,
  VisitHandoffAlreadyConfirmedErrorMock,
  VisitHandoffInvalidDataErrorMock,
  VisitHandoffMissingDataErrorMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  canAccessVisitScheduleAssignmentMock: vi.fn(),
  canConfirmVisitHandoffMock: vi.fn(),
  canOverrideVisitHandoffConfirmationMock: vi.fn(),
  canRequestSupervisedVisitHandoffConfirmationMock: vi.fn(),
  selectVisitHandoffSupervisionAssigneeMock: vi.fn(),
  buildVisitHandoffConfirmationWhereMock: vi.fn(),
  visitRecordFindFirstMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  visitHandoffExtractionFindFirstMock: vi.fn(),
  confirmHandoffMock: vi.fn(),
  readConfirmableHandoffDataMock: vi.fn(),
  VisitHandoffAlreadyConfirmedErrorMock: class VisitHandoffAlreadyConfirmedError extends Error {},
  VisitHandoffInvalidDataErrorMock: class VisitHandoffInvalidDataError extends Error {},
  VisitHandoffMissingDataErrorMock: class VisitHandoffMissingDataError extends Error {},
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/auth/visit-schedule-access', () => ({
  canAccessVisitScheduleAssignment: canAccessVisitScheduleAssignmentMock,
  canConfirmVisitHandoff: canConfirmVisitHandoffMock,
  canOverrideVisitHandoffConfirmation: canOverrideVisitHandoffConfirmationMock,
  canRequestSupervisedVisitHandoffConfirmation: canRequestSupervisedVisitHandoffConfirmationMock,
  selectVisitHandoffSupervisionAssignee: selectVisitHandoffSupervisionAssigneeMock,
  buildVisitHandoffConfirmationWhere: buildVisitHandoffConfirmationWhereMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    visitRecord: { findFirst: visitRecordFindFirstMock },
    membership: { findFirst: membershipFindFirstMock },
    visitHandoffExtraction: { findFirst: visitHandoffExtractionFindFirstMock },
  },
}));

vi.mock('@/server/services/visit-handoff', () => ({
  confirmHandoff: confirmHandoffMock,
  readConfirmableHandoffData: readConfirmableHandoffDataMock,
  VisitHandoffAlreadyConfirmedError: VisitHandoffAlreadyConfirmedErrorMock,
  VisitHandoffInvalidDataError: VisitHandoffInvalidDataErrorMock,
  VisitHandoffMissingDataError: VisitHandoffMissingDataErrorMock,
  VisitHandoffStaleRecordError: class VisitHandoffStaleRecordError extends Error {},
  VISIT_HANDOFF_EXTRACTION_FAILED_MESSAGE:
    '申し送り抽出に失敗しました。時間をおいて再実行してください',
}));

import { GET, PUT } from './route';
import {
  VisitHandoffAlreadyConfirmedError,
  VisitHandoffInvalidDataError,
  VisitHandoffMissingDataError,
  VisitHandoffStaleRecordError,
} from '@/server/services/visit-handoff';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

function createRequest(url: string, body?: unknown) {
  if (body === undefined) {
    return new NextRequest(url);
  }
  return new NextRequest(url, {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function createMalformedJsonRequest(url: string) {
  return new NextRequest(url, {
    method: 'PUT',
    body: '{"confirmed":',
    headers: { 'content-type': 'application/json' },
  });
}

const authCtx = {
  ctx: {
    orgId: 'org_1',
    userId: 'user_1',
    role: 'pharmacist',
    ipAddress: '127.0.0.1',
    userAgent: 'test',
  },
};

const accessibleSchedule = {
  pharmacist_id: 'user_1',
  case_: {
    primary_pharmacist_id: 'user_1',
    backup_pharmacist_id: null,
  },
};

const VISIT_RECORD_VERSION = 2;
const VISIT_RECORD_UPDATED_AT = new Date('2026-04-01T00:00:00.000Z');
const VISIT_RECORD_UPDATED_AT_ISO = VISIT_RECORD_UPDATED_AT.toISOString();
const confirmableHandoff = {
  next_check_items: ['血圧確認'],
  ongoing_monitoring: ['残薬管理'],
  decision_rationale: '継続確認が必要',
  ai_extracted: true,
  ai_confidence: 0.86,
  confirmed_by: null,
  confirmed_at: null,
  extracted_at: '2026-04-01T00:00:00.000Z',
};

function buildVisitRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'vr_1',
    version: VISIT_RECORD_VERSION,
    updated_at: VISIT_RECORD_UPDATED_AT,
    schedule: accessibleSchedule,
    structured_soap: {
      handoff: confirmableHandoff,
    },
    ...overrides,
  };
}

describe('/api/visit-records/[id]/handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue(authCtx);
    canAccessVisitScheduleAssignmentMock.mockReturnValue(true);
    canConfirmVisitHandoffMock.mockReturnValue(true);
    canOverrideVisitHandoffConfirmationMock.mockReturnValue(false);
    canRequestSupervisedVisitHandoffConfirmationMock.mockReturnValue(false);
    selectVisitHandoffSupervisionAssigneeMock.mockReturnValue(null);
    buildVisitHandoffConfirmationWhereMock.mockReturnValue({
      schedule: { pharmacist_id: 'user_1' },
    });
    membershipFindFirstMock.mockResolvedValue(null);
    visitHandoffExtractionFindFirstMock.mockResolvedValue(null);
    readConfirmableHandoffDataMock.mockImplementation((value: unknown) => {
      if (value === undefined || value === null) return { status: 'missing' };
      const handoff = value as { decision_rationale?: unknown; next_check_items?: unknown };
      if (
        Array.isArray(handoff.next_check_items) &&
        handoff.next_check_items.includes('血圧確認') &&
        typeof handoff.decision_rationale === 'string'
      ) {
        return { status: 'valid', handoff: value };
      }
      return { status: 'invalid' };
    });
  });

  describe('GET', () => {
    it('adds no-store headers to auth failures', async () => {
      requireAuthContextMock.mockResolvedValue({
        response: new Response(JSON.stringify({ code: 'AUTH_FORBIDDEN' }), { status: 403 }),
      });

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff');
      const res = await GET(req, { params: Promise.resolve({ id: 'vr_1' }) });

      expect(res!.status).toBe(403);
      expectSensitiveNoStore(res!);
      expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
    });

    it('returns 200 with handoff data', async () => {
      visitRecordFindFirstMock.mockResolvedValue(buildVisitRecord());
      visitHandoffExtractionFindFirstMock.mockResolvedValue({
        status: 'succeeded',
        retry_count: 0,
        last_attempted_at: new Date('2026-04-01T00:00:00.000Z'),
        last_succeeded_at: new Date('2026-04-01T00:01:00.000Z'),
        last_failed_at: null,
        error_message: null,
        retryable: false,
        source_visit_record_version: 2,
        source_visit_record_updated_at: new Date('2026-04-01T00:00:00.000Z'),
      });

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff');
      const res = await GET(req, { params: Promise.resolve({ id: 'vr_1' }) });
      expect(res!.status).toBe(200);
      expectSensitiveNoStore(res!);
      expect(canAccessVisitScheduleAssignmentMock).toHaveBeenCalledWith(
        authCtx.ctx,
        accessibleSchedule,
      );
      const json = await res!.json();
      expect(json.data.next_check_items).toEqual(['血圧確認']);
      expect(json.extraction).toMatchObject({
        status: 'succeeded',
        retryable: false,
        source_visit_record_version: 2,
      });
      expect(json).toMatchObject({
        visit_record_version: VISIT_RECORD_VERSION,
        visit_record_updated_at: VISIT_RECORD_UPDATED_AT_ISO,
        confirmation_policy: {
          can_confirm: true,
          requires_override_reason: false,
          authorized_basis: 'assigned_schedule',
          override_reason_max_length: 500,
        },
      });
    });

    it('returns additive override policy metadata for owner/admin non-assignees', async () => {
      requireAuthContextMock.mockResolvedValue({
        ctx: { ...authCtx.ctx, userId: 'owner_1', role: 'owner' },
      });
      canConfirmVisitHandoffMock.mockReturnValue(false);
      canOverrideVisitHandoffConfirmationMock.mockReturnValue(true);
      visitRecordFindFirstMock.mockResolvedValue(buildVisitRecord());

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff');
      const res = await GET(req, { params: Promise.resolve({ id: 'vr_1' }) });

      expect(res!.status).toBe(200);
      expectSensitiveNoStore(res!);
      await expect(res!.json()).resolves.toMatchObject({
        data: { next_check_items: ['血圧確認'] },
        visit_record_version: VISIT_RECORD_VERSION,
        confirmation_policy: {
          can_confirm: false,
          requires_override_reason: true,
          authorized_basis: 'admin_emergency_override',
          override_reason_max_length: 500,
          override_reason_code_required: false,
          override_reason_codes: expect.arrayContaining([
            expect.objectContaining({
              code: 'assignee_unavailable',
              label: expect.any(String),
            }),
          ]),
        },
      });
    });

    it('keeps trainee final confirmation closed while exposing supervision request metadata', async () => {
      const traineeCtx = { ...authCtx.ctx, userId: 'trainee_1', role: 'pharmacist_trainee' };
      requireAuthContextMock.mockResolvedValue({ ctx: traineeCtx });
      canConfirmVisitHandoffMock.mockReturnValue(false);
      canRequestSupervisedVisitHandoffConfirmationMock.mockReturnValue(true);
      selectVisitHandoffSupervisionAssigneeMock.mockReturnValue('supervisor_1');
      membershipFindFirstMock.mockResolvedValue({ user_id: 'supervisor_1' });
      visitRecordFindFirstMock.mockResolvedValue(
        buildVisitRecord({
          schedule: {
            pharmacist_id: 'trainee_1',
            case_: { primary_pharmacist_id: 'supervisor_1', backup_pharmacist_id: null },
          },
        }),
      );

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff');
      const res = await GET(req, { params: Promise.resolve({ id: 'vr_1' }) });

      expect(res!.status).toBe(200);
      expectSensitiveNoStore(res!);
      expect(canRequestSupervisedVisitHandoffConfirmationMock).toHaveBeenCalledWith(
        traineeCtx,
        expect.objectContaining({ pharmacist_id: 'trainee_1' }),
      );
      await expect(res!.json()).resolves.toMatchObject({
        confirmation_policy: {
          can_confirm: false,
          requires_override_reason: false,
          authorized_basis: null,
          can_request_supervision: true,
          supervision_required: true,
          supervision_available: true,
          supervision_request_note_max_length: 500,
        },
      });
    });

    it('rejects blank visit record ids before loading handoff data', async () => {
      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff');
      const res = await GET(req, { params: Promise.resolve({ id: '   ' }) });

      expect(res!.status).toBe(400);
      expectSensitiveNoStore(res!);
      await expect(res!.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '訪問記録IDが不正です',
      });
      expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
      expect(canAccessVisitScheduleAssignmentMock).not.toHaveBeenCalled();
    });

    it('returns 404 when record not found', async () => {
      visitRecordFindFirstMock.mockResolvedValue(null);

      const req = createRequest('http://localhost/api/visit-records/missing/handoff');
      const res = await GET(req, { params: Promise.resolve({ id: 'missing' }) });
      expect(res!.status).toBe(404);
      expectSensitiveNoStore(res!);
      expect(canAccessVisitScheduleAssignmentMock).not.toHaveBeenCalled();
    });

    it('returns a sanitized no-store 500 when handoff lookup fails unexpectedly', async () => {
      visitRecordFindFirstMock.mockRejectedValueOnce(new Error('raw handoff secret'));

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff');
      const res = await GET(req, { params: Promise.resolve({ id: 'vr_1' }) });

      expect(res!.status).toBe(500);
      expectSensitiveNoStore(res!);
      const bodyText = await res!.text();
      expect(bodyText).toContain('INTERNAL_ERROR');
      expect(bodyText).not.toContain('raw handoff secret');
    });

    it('returns 403 before reading extraction state when assignment access is denied', async () => {
      canAccessVisitScheduleAssignmentMock.mockReturnValue(false);
      visitRecordFindFirstMock.mockResolvedValue(buildVisitRecord());

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff');
      const res = await GET(req, { params: Promise.resolve({ id: 'vr_1' }) });

      expect(res!.status).toBe(403);
      expectSensitiveNoStore(res!);
      expect(canAccessVisitScheduleAssignmentMock).toHaveBeenCalledWith(
        authCtx.ctx,
        accessibleSchedule,
      );
      expect(visitHandoffExtractionFindFirstMock).not.toHaveBeenCalled();
    });

    it('returns 404 when no handoff data', async () => {
      visitRecordFindFirstMock.mockResolvedValue(buildVisitRecord({ structured_soap: null }));

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff');
      const res = await GET(req, { params: Promise.resolve({ id: 'vr_1' }) });
      expect(res!.status).toBe(404);
      expectSensitiveNoStore(res!);
    });

    it('does not return malformed persisted handoff data as a normal response', async () => {
      visitRecordFindFirstMock.mockResolvedValue(
        buildVisitRecord({
          structured_soap: {
            handoff: {
              next_check_items: ['patient=田中太郎 token=secret'],
            },
          },
        }),
      );

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff');
      const res = await GET(req, { params: Promise.resolve({ id: 'vr_1' }) });

      expect(res!.status).toBe(409);
      expectSensitiveNoStore(res!);
      const payload = await res!.json();
      expect(payload).toEqual({
        code: 'WORKFLOW_CONFLICT',
        message: '引継ぎデータの形式が不正です。AI抽出を再実行してから確定してください',
      });
      const payloadText = JSON.stringify(payload);
      expect(payloadText).not.toContain('田中太郎');
      expect(payloadText).not.toContain('token=secret');
    });

    it('does not return clinically empty persisted handoff data as a normal response', async () => {
      visitRecordFindFirstMock.mockResolvedValue(
        buildVisitRecord({
          structured_soap: {
            handoff: {
              next_check_items: ['   '],
              ongoing_monitoring: [],
              decision_rationale: ' ',
              ai_extracted: true,
              ai_confidence: 0.3,
              confirmed_by: null,
              confirmed_at: null,
              extracted_at: '2026-04-01T00:00:00.000Z',
            },
          },
        }),
      );

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff');
      const res = await GET(req, { params: Promise.resolve({ id: 'vr_1' }) });

      expect(res!.status).toBe(409);
      expectSensitiveNoStore(res!);
      await expect(res!.json()).resolves.toMatchObject({
        code: 'WORKFLOW_CONFLICT',
        message: '引継ぎデータの形式が不正です。AI抽出を再実行してから確定してください',
      });
    });

    it('returns redacted extraction status even when handoff data is not yet available', async () => {
      visitRecordFindFirstMock.mockResolvedValue(buildVisitRecord({ structured_soap: null }));
      visitHandoffExtractionFindFirstMock.mockResolvedValue({
        status: 'failed',
        retry_count: 2,
        last_attempted_at: new Date('2026-04-01T00:00:00.000Z'),
        last_succeeded_at: null,
        last_failed_at: new Date('2026-04-01T00:00:30.000Z'),
        error_message: 'patient=田中太郎 SOAP=服薬状況 token=secret',
        retryable: true,
        source_visit_record_version: 2,
        source_visit_record_updated_at: new Date('2026-04-01T00:00:00.000Z'),
      });

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff');
      const res = await GET(req, { params: Promise.resolve({ id: 'vr_1' }) });
      expect(res!.status).toBe(200);
      expectSensitiveNoStore(res!);
      const payload = await res!.json();
      expect(payload).toMatchObject({
        data: null,
        extraction: {
          status: 'failed',
          retry_count: 2,
          error_message: '申し送り抽出に失敗しました。時間をおいて再実行してください',
          retryable: true,
        },
        confirmation_policy: {
          requires_override_reason: false,
        },
      });
      const payloadText = JSON.stringify(payload);
      expect(payloadText).not.toContain('田中太郎');
      expect(payloadText).not.toContain('SOAP=服薬状況');
      expect(payloadText).not.toContain('token=secret');
    });
  });

  describe('PUT', () => {
    it('adds no-store headers to auth failures', async () => {
      requireAuthContextMock.mockResolvedValue({
        response: new Response(JSON.stringify({ code: 'AUTH_FORBIDDEN' }), { status: 403 }),
      });

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff', {
        confirmed: true,
        expected_visit_record_version: VISIT_RECORD_VERSION,
        override_reason_code: 'assignee_unavailable',
        override_reason: '担当者本人が確認しているため代行理由は無視される',
      });
      const res = await PUT(req, { params: Promise.resolve({ id: 'vr_1' }) });

      expect(res!.status).toBe(403);
      expectSensitiveNoStore(res!);
      expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
      expect(confirmHandoffMock).not.toHaveBeenCalled();
    });

    it('returns 200 on valid handoff confirmation', async () => {
      visitRecordFindFirstMock.mockResolvedValue(
        buildVisitRecord({ structured_soap: { handoff: confirmableHandoff } }),
      );
      const handoffResult = { confirmed: true, confirmed_by: 'user_1' };
      confirmHandoffMock.mockResolvedValue(handoffResult);

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff', {
        confirmed: true,
        expected_visit_record_version: VISIT_RECORD_VERSION,
      });
      const res = await PUT(req, { params: Promise.resolve({ id: 'vr_1' }) });
      expect(res!.status).toBe(200);
      expectSensitiveNoStore(res!);
      expect(canConfirmVisitHandoffMock).toHaveBeenCalledWith(authCtx.ctx, accessibleSchedule);
      expect(confirmHandoffMock).toHaveBeenCalledWith(expect.anything(), {
        orgId: 'org_1',
        visitRecordId: 'vr_1',
        confirmedBy: 'user_1',
        expectedVersion: VISIT_RECORD_VERSION,
        edits: undefined,
        requestContext: authCtx.ctx,
        confirmationWhere: { schedule: { pharmacist_id: 'user_1' } },
        confirmationBasis: 'assigned_schedule',
      });
      expect(confirmHandoffMock.mock.calls[0]?.[1]).not.toHaveProperty('overrideReason');
      expect(confirmHandoffMock.mock.calls[0]?.[1]).not.toHaveProperty('overrideReasonCode');
    });

    it('allows legacy owner/admin emergency override with an explicit reason only', async () => {
      requireAuthContextMock.mockResolvedValue({
        ctx: { ...authCtx.ctx, userId: 'owner_1', role: 'owner' },
      });
      canConfirmVisitHandoffMock.mockReturnValue(false);
      canOverrideVisitHandoffConfirmationMock.mockReturnValue(true);
      visitRecordFindFirstMock.mockResolvedValue(
        buildVisitRecord({ structured_soap: { handoff: confirmableHandoff } }),
      );
      const handoffResult = { confirmed: true, confirmed_by: 'owner_1' };
      confirmHandoffMock.mockResolvedValue(handoffResult);

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff', {
        confirmed: true,
        expected_visit_record_version: VISIT_RECORD_VERSION,
        override_reason: ' 担当者不在のため本日訪問前に確認が必要 ',
      });
      const res = await PUT(req, { params: Promise.resolve({ id: 'vr_1' }) });

      expect(res!.status).toBe(200);
      expectSensitiveNoStore(res!);
      expect(buildVisitHandoffConfirmationWhereMock).not.toHaveBeenCalled();
      expect(confirmHandoffMock).toHaveBeenCalledWith(expect.anything(), {
        orgId: 'org_1',
        visitRecordId: 'vr_1',
        confirmedBy: 'owner_1',
        expectedVersion: VISIT_RECORD_VERSION,
        edits: undefined,
        requestContext: expect.objectContaining({ userId: 'owner_1', role: 'owner' }),
        confirmationWhere: undefined,
        confirmationBasis: 'admin_emergency_override',
        overrideReason: '担当者不在のため本日訪問前に確認が必要',
      });
      expect(confirmHandoffMock.mock.calls[0]?.[1]).not.toHaveProperty('overrideReasonCode');
    });

    it('allows owner/admin emergency override with a standardized reason code', async () => {
      requireAuthContextMock.mockResolvedValue({
        ctx: { ...authCtx.ctx, userId: 'owner_1', role: 'owner' },
      });
      canConfirmVisitHandoffMock.mockReturnValue(false);
      canOverrideVisitHandoffConfirmationMock.mockReturnValue(true);
      visitRecordFindFirstMock.mockResolvedValue(
        buildVisitRecord({ structured_soap: { handoff: confirmableHandoff } }),
      );
      confirmHandoffMock.mockResolvedValue({ confirmed: true, confirmed_by: 'owner_1' });

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff', {
        confirmed: true,
        expected_visit_record_version: VISIT_RECORD_VERSION,
        override_reason_code: 'assignee_unavailable',
        override_reason: ' 担当者不在のため本日訪問前に確認が必要 ',
      });
      const res = await PUT(req, { params: Promise.resolve({ id: 'vr_1' }) });

      expect(res!.status).toBe(200);
      expectSensitiveNoStore(res!);
      expect(buildVisitHandoffConfirmationWhereMock).not.toHaveBeenCalled();
      expect(confirmHandoffMock).toHaveBeenCalledWith(expect.anything(), {
        orgId: 'org_1',
        visitRecordId: 'vr_1',
        confirmedBy: 'owner_1',
        expectedVersion: VISIT_RECORD_VERSION,
        edits: undefined,
        requestContext: expect.objectContaining({ userId: 'owner_1', role: 'owner' }),
        confirmationWhere: undefined,
        confirmationBasis: 'admin_emergency_override',
        overrideReason: '担当者不在のため本日訪問前に確認が必要',
        overrideReasonCode: 'assignee_unavailable',
      });
    });

    it('keeps owner/admin non-assignee confirmation denied without an override reason', async () => {
      requireAuthContextMock.mockResolvedValue({
        ctx: { ...authCtx.ctx, userId: 'owner_1', role: 'owner' },
      });
      canConfirmVisitHandoffMock.mockReturnValue(false);
      canOverrideVisitHandoffConfirmationMock.mockReturnValue(true);
      visitRecordFindFirstMock.mockResolvedValue(
        buildVisitRecord({ structured_soap: { handoff: confirmableHandoff } }),
      );

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff', {
        confirmed: true,
        expected_visit_record_version: VISIT_RECORD_VERSION,
      });
      const res = await PUT(req, { params: Promise.resolve({ id: 'vr_1' }) });

      expect(res!.status).toBe(403);
      expectSensitiveNoStore(res!);
      expect(confirmHandoffMock).not.toHaveBeenCalled();
    });

    it('keeps owner/admin override denied when only a reason code is supplied', async () => {
      requireAuthContextMock.mockResolvedValue({
        ctx: { ...authCtx.ctx, userId: 'owner_1', role: 'owner' },
      });
      canConfirmVisitHandoffMock.mockReturnValue(false);
      canOverrideVisitHandoffConfirmationMock.mockReturnValue(true);
      visitRecordFindFirstMock.mockResolvedValue(
        buildVisitRecord({ structured_soap: { handoff: confirmableHandoff } }),
      );

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff', {
        confirmed: true,
        expected_visit_record_version: VISIT_RECORD_VERSION,
        override_reason_code: 'assignee_unavailable',
      });
      const res = await PUT(req, { params: Promise.resolve({ id: 'vr_1' }) });

      expect(res!.status).toBe(403);
      expectSensitiveNoStore(res!);
      expect(confirmHandoffMock).not.toHaveBeenCalled();
    });

    it('rejects blank override reasons before loading the visit record', async () => {
      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff', {
        confirmed: true,
        expected_visit_record_version: VISIT_RECORD_VERSION,
        override_reason: '   ',
      });
      const res = await PUT(req, { params: Promise.resolve({ id: 'vr_1' }) });

      expect(res!.status).toBe(400);
      expectSensitiveNoStore(res!);
      await expect(res!.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: {
          override_reason: expect.any(Array),
        },
      });
      expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
      expect(confirmHandoffMock).not.toHaveBeenCalled();
    });

    it('rejects invalid override reason codes before loading the visit record', async () => {
      const maliciousCode = 'patient_tanaka_token_secret';
      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff', {
        confirmed: true,
        expected_visit_record_version: VISIT_RECORD_VERSION,
        override_reason_code: maliciousCode,
        override_reason: '担当者不在のため本日訪問前に確認が必要',
      });
      const res = await PUT(req, { params: Promise.resolve({ id: 'vr_1' }) });

      expect(res!.status).toBe(400);
      expectSensitiveNoStore(res!);
      const json = await res!.json();
      expect(json).toMatchObject({
        code: 'VALIDATION_ERROR',
        details: {
          override_reason_code: expect.any(Array),
        },
      });
      expect(JSON.stringify(json)).not.toContain(maliciousCode);
      expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
      expect(confirmHandoffMock).not.toHaveBeenCalled();
    });

    it('rejects pharmacist and trainee override attempts even with a reason', async () => {
      for (const role of ['pharmacist', 'pharmacist_trainee'] as const) {
        vi.clearAllMocks();
        requireAuthContextMock.mockResolvedValue({
          ctx: { ...authCtx.ctx, userId: `${role}_1`, role },
        });
        canAccessVisitScheduleAssignmentMock.mockReturnValue(true);
        canConfirmVisitHandoffMock.mockReturnValue(false);
        canOverrideVisitHandoffConfirmationMock.mockReturnValue(false);
        buildVisitHandoffConfirmationWhereMock.mockReturnValue({
          schedule: { pharmacist_id: `${role}_1` },
        });
        visitRecordFindFirstMock.mockResolvedValue(
          buildVisitRecord({ structured_soap: { handoff: confirmableHandoff } }),
        );

        const req = createRequest('http://localhost/api/visit-records/vr_1/handoff', {
          confirmed: true,
          expected_visit_record_version: VISIT_RECORD_VERSION,
          override_reason_code: 'assignee_unavailable',
          override_reason: '担当者不在のため本日訪問前に確認が必要',
        });
        const res = await PUT(req, { params: Promise.resolve({ id: 'vr_1' }) });

        expect(res!.status).toBe(403);
        expectSensitiveNoStore(res!);
        expect(confirmHandoffMock).not.toHaveBeenCalled();
      }
    });

    it('rejects blank visit record ids before confirming handoff data', async () => {
      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff', {
        confirmed: true,
        expected_visit_record_version: VISIT_RECORD_VERSION,
      });

      const res = await PUT(req, { params: Promise.resolve({ id: '   ' }) });

      expect(res!.status).toBe(400);
      expectSensitiveNoStore(res!);
      await expect(res!.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '訪問記録IDが不正です',
      });
      expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
      expect(canAccessVisitScheduleAssignmentMock).not.toHaveBeenCalled();
      expect(confirmHandoffMock).not.toHaveBeenCalled();
    });

    it('returns 400 on invalid body', async () => {
      const req = createMalformedJsonRequest('http://localhost/api/visit-records/vr_1/handoff');
      const res = await PUT(req, { params: Promise.resolve({ id: 'vr_1' }) });
      expect(res!.status).toBe(400);
      expectSensitiveNoStore(res!);
      await expect(res!.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'リクエストボディが不正です',
      });
      expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
      expect(confirmHandoffMock).not.toHaveBeenCalled();
    });

    it('rejects non-object confirmation payloads before loading the visit record', async () => {
      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff', ['confirmed']);

      const res = await PUT(req, { params: Promise.resolve({ id: 'vr_1' }) });

      expect(res!.status).toBe(400);
      expectSensitiveNoStore(res!);
      await expect(res!.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'リクエストボディが不正です',
      });
      expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
      expect(confirmHandoffMock).not.toHaveBeenCalled();
    });

    it('rejects schema-invalid confirmation payloads before loading the visit record', async () => {
      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff', {
        confirmed: false,
        expected_visit_record_version: VISIT_RECORD_VERSION,
      });

      const res = await PUT(req, { params: Promise.resolve({ id: 'vr_1' }) });

      expect(res!.status).toBe(400);
      expectSensitiveNoStore(res!);
      await expect(res!.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '入力値が不正です',
      });
      expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
      expect(confirmHandoffMock).not.toHaveBeenCalled();
    });

    it('returns 403 before confirming handoff data when confirmation access is denied', async () => {
      canConfirmVisitHandoffMock.mockReturnValue(false);
      visitRecordFindFirstMock.mockResolvedValue(
        buildVisitRecord({ structured_soap: { handoff: confirmableHandoff } }),
      );

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff', {
        confirmed: true,
        expected_visit_record_version: VISIT_RECORD_VERSION,
      });
      const res = await PUT(req, { params: Promise.resolve({ id: 'vr_1' }) });

      expect(res!.status).toBe(403);
      expectSensitiveNoStore(res!);
      expect(canConfirmVisitHandoffMock).toHaveBeenCalledWith(authCtx.ctx, accessibleSchedule);
      expect(buildVisitHandoffConfirmationWhereMock).not.toHaveBeenCalled();
      expect(confirmHandoffMock).not.toHaveBeenCalled();
    });

    it('returns 403 before confirming handoff data when confirmation write claim is unavailable', async () => {
      buildVisitHandoffConfirmationWhereMock.mockReturnValue(null);
      visitRecordFindFirstMock.mockResolvedValue(
        buildVisitRecord({ structured_soap: { handoff: confirmableHandoff } }),
      );

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff', {
        confirmed: true,
        expected_visit_record_version: VISIT_RECORD_VERSION,
      });
      const res = await PUT(req, { params: Promise.resolve({ id: 'vr_1' }) });

      expect(res!.status).toBe(403);
      expectSensitiveNoStore(res!);
      expect(confirmHandoffMock).not.toHaveBeenCalled();
    });

    it('returns a sanitized no-store 500 when confirmation preflight lookup fails unexpectedly', async () => {
      visitRecordFindFirstMock.mockRejectedValueOnce(new Error('raw visit handoff secret'));

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff', {
        confirmed: true,
        expected_visit_record_version: VISIT_RECORD_VERSION,
      });
      const res = await PUT(req, { params: Promise.resolve({ id: 'vr_1' }) });

      expect(res!.status).toBe(500);
      expectSensitiveNoStore(res!);
      const bodyText = await res!.text();
      expect(bodyText).toContain('INTERNAL_ERROR');
      expect(bodyText).not.toContain('raw visit handoff secret');
      expect(confirmHandoffMock).not.toHaveBeenCalled();
    });

    it('requires the visit record version before loading the visit record for confirmation', async () => {
      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff', {
        confirmed: true,
      });

      const res = await PUT(req, { params: Promise.resolve({ id: 'vr_1' }) });

      expect(res!.status).toBe(400);
      expectSensitiveNoStore(res!);
      await expect(res!.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '入力値が不正です',
        details: {
          expected_visit_record_version: expect.any(Array),
        },
      });
      expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
      expect(confirmHandoffMock).not.toHaveBeenCalled();
    });

    it('returns conflict for stale visit record versions before confirming handoff data', async () => {
      visitRecordFindFirstMock.mockResolvedValue(
        buildVisitRecord({
          version: VISIT_RECORD_VERSION + 1,
          structured_soap: { handoff: confirmableHandoff },
        }),
      );

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff', {
        confirmed: true,
        expected_visit_record_version: VISIT_RECORD_VERSION,
      });

      const res = await PUT(req, { params: Promise.resolve({ id: 'vr_1' }) });

      expect(res!.status).toBe(409);
      expectSensitiveNoStore(res!);
      await expect(res!.json()).resolves.toMatchObject({
        code: 'WORKFLOW_CONFLICT',
        message: '訪問記録が同時に更新されました。再読み込みしてください',
      });
      expect(confirmHandoffMock).not.toHaveBeenCalled();
    });

    it('maps lost service-level confirmation claims to a sanitized conflict', async () => {
      visitRecordFindFirstMock.mockResolvedValue(
        buildVisitRecord({ structured_soap: { handoff: confirmableHandoff } }),
      );
      confirmHandoffMock.mockRejectedValueOnce(new VisitHandoffStaleRecordError('vr_1'));

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff', {
        confirmed: true,
        expected_visit_record_version: VISIT_RECORD_VERSION,
      });

      const res = await PUT(req, { params: Promise.resolve({ id: 'vr_1' }) });

      expect(res!.status).toBe(409);
      expectSensitiveNoStore(res!);
      await expect(res!.json()).resolves.toMatchObject({
        code: 'WORKFLOW_CONFLICT',
        message: '訪問記録が同時に更新されました。再読み込みしてください',
      });
    });

    it('maps already confirmed handoffs to a sanitized conflict', async () => {
      visitRecordFindFirstMock.mockResolvedValue(
        buildVisitRecord({ structured_soap: { handoff: confirmableHandoff } }),
      );
      confirmHandoffMock.mockRejectedValueOnce(new VisitHandoffAlreadyConfirmedError('vr_1'));

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff', {
        confirmed: true,
        expected_visit_record_version: VISIT_RECORD_VERSION,
      });

      const res = await PUT(req, { params: Promise.resolve({ id: 'vr_1' }) });

      expect(res!.status).toBe(409);
      expectSensitiveNoStore(res!);
      const payload = await res!.json();
      expect(payload).toEqual({
        code: 'WORKFLOW_CONFLICT',
        message: '申し送りはすでに確認済みです',
      });
      expect(JSON.stringify(payload)).not.toContain('vr_1');
    });

    it('maps typed missing handoff data to a sanitized not found response', async () => {
      visitRecordFindFirstMock.mockResolvedValue(buildVisitRecord({ structured_soap: {} }));
      confirmHandoffMock.mockRejectedValueOnce(new VisitHandoffMissingDataError('vr_1'));

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff', {
        confirmed: true,
        expected_visit_record_version: VISIT_RECORD_VERSION,
      });

      const res = await PUT(req, { params: Promise.resolve({ id: 'vr_1' }) });

      expect(res!.status).toBe(404);
      expectSensitiveNoStore(res!);
      await expect(res!.json()).resolves.toMatchObject({
        code: 'WORKFLOW_NOT_FOUND',
        message: '引継ぎデータが見つかりません。AI抽出が完了していない可能性があります',
      });
    });

    it('maps typed malformed handoff data to a sanitized conflict response', async () => {
      visitRecordFindFirstMock.mockResolvedValue(
        buildVisitRecord({ structured_soap: { handoff: {} } }),
      );
      confirmHandoffMock.mockRejectedValueOnce(new VisitHandoffInvalidDataError('vr_1'));

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff', {
        confirmed: true,
        expected_visit_record_version: VISIT_RECORD_VERSION,
      });

      const res = await PUT(req, { params: Promise.resolve({ id: 'vr_1' }) });

      expect(res!.status).toBe(409);
      expectSensitiveNoStore(res!);
      const payload = await res!.json();
      expect(payload).toEqual({
        code: 'WORKFLOW_CONFLICT',
        message: '引継ぎデータの形式が不正です。AI抽出を再実行してから確定してください',
      });
      expect(JSON.stringify(payload)).not.toContain('vr_1');
    });

    it('maps blanking confirmation edits to a sanitized conflict response', async () => {
      visitRecordFindFirstMock.mockResolvedValue(
        buildVisitRecord({ structured_soap: { handoff: confirmableHandoff } }),
      );
      confirmHandoffMock.mockRejectedValueOnce(new VisitHandoffInvalidDataError('vr_1'));

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff', {
        confirmed: true,
        expected_visit_record_version: VISIT_RECORD_VERSION,
        edits: {
          next_check_items: [],
          ongoing_monitoring: [],
          decision_rationale: '   ',
        },
      });

      const res = await PUT(req, { params: Promise.resolve({ id: 'vr_1' }) });

      expect(confirmHandoffMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          edits: {
            next_check_items: [],
            ongoing_monitoring: [],
            decision_rationale: '   ',
          },
        }),
      );
      expect(res!.status).toBe(409);
      expectSensitiveNoStore(res!);
      await expect(res!.json()).resolves.toMatchObject({
        code: 'WORKFLOW_CONFLICT',
        message: '引継ぎデータの形式が不正です。AI抽出を再実行してから確定してください',
      });
    });

    it('does not classify raw error message text as a missing handoff response', async () => {
      visitRecordFindFirstMock.mockResolvedValue(
        buildVisitRecord({ structured_soap: { handoff: confirmableHandoff } }),
      );
      confirmHandoffMock.mockRejectedValueOnce(
        new Error('No handoff found for patient=田中太郎 token=secret'),
      );

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff', {
        confirmed: true,
        expected_visit_record_version: VISIT_RECORD_VERSION,
      });

      const res = await PUT(req, { params: Promise.resolve({ id: 'vr_1' }) });

      expect(res!.status).toBe(500);
      expectSensitiveNoStore(res!);
      const payload = await res!.json();
      expect(payload).toEqual({
        code: 'internal_error',
        message: '引継ぎの確定処理に失敗しました',
      });
      const payloadText = JSON.stringify(payload);
      expect(payloadText).not.toContain('田中太郎');
      expect(payloadText).not.toContain('token=secret');
      expect(payloadText).not.toContain('No handoff found');
    });
  });
});
