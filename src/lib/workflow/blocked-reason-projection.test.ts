import { describe, expect, it } from 'vitest';
import { buildBlockedReasons } from './blocked-reason-projection';

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

  it('keeps non-communication blockers on their existing destinations', () => {
    const [reason] = buildBlockedReasons(
      [
        {
          id: 'exception_1',
          exception_type: 'missing_visit_consent',
          patient_id: 'patient_1',
          description: '同意待ちです',
          severity: 'critical',
          created_at: now,
        },
      ],
      now,
    );

    expect(reason.action_href).toBe('/patients');
  });
});
