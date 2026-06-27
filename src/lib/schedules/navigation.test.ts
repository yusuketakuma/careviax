import { describe, expect, it } from 'vitest';
import {
  buildScheduleFocusHref,
  buildScheduleProposalDetailHref,
  buildVisitScheduleHref,
} from './navigation';

describe('schedule navigation helpers', () => {
  it('builds the schedules page focused on a schedule id', () => {
    expect(buildScheduleFocusHref('schedule_1')).toBe(
      '/schedules?focus=schedule&schedule_id=schedule_1',
    );
  });

  it('builds a schedule proposal detail href', () => {
    expect(buildScheduleProposalDetailHref('proposal_1')).toBe(
      '/schedules/proposals?detail=proposal_1',
    );
  });

  it('builds the visit schedule detail href', () => {
    expect(buildVisitScheduleHref('schedule_1')).toBe('/visit-schedules/schedule_1');
  });

  it('encodes ids without changing spaces to plus signs', () => {
    const id = '../schedule with space?x=1#frag';

    expect(buildScheduleFocusHref(id)).toBe(
      `/schedules?focus=schedule&schedule_id=${encodeURIComponent(id)}`,
    );
    expect(buildScheduleProposalDetailHref(id)).toBe(
      `/schedules/proposals?detail=${encodeURIComponent(id)}`,
    );
    expect(buildVisitScheduleHref(id)).toBe(`/visit-schedules/${encodeURIComponent(id)}`);
    expect(buildScheduleFocusHref(id)).toContain('%20');
    expect(buildScheduleProposalDetailHref(id)).toContain('%20');
    expect(buildVisitScheduleHref(id)).toContain('%20');
  });

  it.each(['.', '..'])('rejects exact dot-segment visit schedule id %s', (scheduleId) => {
    expect(() => buildVisitScheduleHref(scheduleId)).toThrow(RangeError);
  });
});
