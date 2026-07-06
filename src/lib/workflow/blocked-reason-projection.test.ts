import { describe, expect, it } from 'vitest';
import {
  buildBlockedReasons,
  getWorkflowExceptionStatusText,
  resolveBlockedReasonPresentation,
} from './blocked-reason-projection';

describe('buildBlockedReasons', () => {
  const now = new Date('2026-06-12T09:00:00.000Z');

  it.each(['family_consent_pending', 'awaiting_reply'])(
    'focuses %s blockers on patient reply-waiting requests',
    (exceptionType) => {
      const [reason] = buildBlockedReasons(
        [
          {
            id: 'exception_1',
            exception_type: exceptionType,
            patient_id: 'patient_1',
            description: '返信待ちです',
            severity: 'warning',
            created_at: new Date('2026-06-12T08:30:00.000Z'),
          },
        ],
        now,
      );

      expect(reason).toMatchObject({
        action_href: '/communications/requests?status=sent&patient_id=patient_1',
        age_minutes: 30,
      });
    },
  );

  it('keeps patient ids encoded through the communication request URL builder', () => {
    const patientId = '../patient with space?x=1#frag';

    const [reason] = buildBlockedReasons(
      [
        {
          id: 'exception_1',
          exception_type: 'awaiting_reply',
          patient_id: patientId,
          description: '返信待ちです',
          severity: 'critical',
          created_at: now,
        },
      ],
      now,
    );

    expect(reason.action_href).toBe(
      `/communications/requests?${new URLSearchParams({ status: 'sent', patient_id: patientId }).toString()}`,
    );
  });

  it('focuses patient blockers on the exact patient when a patient id is available', () => {
    const patientId = 'patient/1?x=y#frag';
    const [reason] = buildBlockedReasons(
      [
        {
          id: 'exception_1',
          exception_type: 'missing_visit_consent',
          patient_id: patientId,
          description: '同意待ちです',
          severity: 'critical',
          created_at: now,
        },
      ],
      now,
    );

    expect(reason.action_href).toBe(`/patients/${encodeURIComponent(patientId)}`);
    expect(reason.action_href).not.toBe(`/patients/${patientId}`);
  });

  it('keeps patient blockers on their existing aggregate destination without a patient id', () => {
    const [reason] = buildBlockedReasons(
      [
        {
          id: 'exception_1',
          exception_type: 'missing_visit_consent',
          patient_id: null,
          description: '同意待ちです',
          severity: 'critical',
          created_at: now,
        },
      ],
      now,
    );

    expect(reason.action_href).toBe('/patients');
  });

  it('centralizes patient board and command-center workflow exception labels without raw descriptions', () => {
    expect(getWorkflowExceptionStatusText('prescription_structuring_block')).toBe(
      '処方構造化の確認中 — 詳細確認が必要です',
    );
    expect(getWorkflowExceptionStatusText('unknown-raw-090-RAW-PHI')).toBe(
      '確認事項があります — 詳細確認が必要です',
    );
    expect(resolveBlockedReasonPresentation('prescription_structuring_block')).toMatchObject({
      category: '医療機関',
      actionLabel: '状況を見る →',
      actionHref: '/prescriptions',
    });
  });
});
