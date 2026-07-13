import { describe, expect, it } from 'vitest';
import {
  buildWorkRequestHref,
  isWorkRequestType,
  WORK_REQUEST_TYPES,
} from './work-request-navigation';

describe('buildWorkRequestHref', () => {
  it('builds task work-request links with related entity context', () => {
    expect(
      buildWorkRequestHref({
        type: 'staff_work_request_visit',
        title: '伊藤さんの訪問に行ってほしい',
        description: '伊藤さんの訪問を代わってほしい',
        relatedEntityType: 'visit_schedule',
        relatedEntityId: 'visit_1',
        context: 'schedule_visit_card',
      }),
    ).toBe(
      '/tasks?work_request=1&work_request_type=staff_work_request_visit&related_entity_type=visit_schedule&related_entity_id=visit_1&context=schedule_visit_card',
    );
  });

  it('defaults to a general work request', () => {
    expect(buildWorkRequestHref()).toBe(
      '/tasks?work_request=1&work_request_type=staff_work_request_general',
    );
  });

  it('keeps the work-request type contract closed to known values', () => {
    expect(WORK_REQUEST_TYPES).toEqual([
      'staff_work_request_visit',
      'staff_work_request_audit',
      'staff_work_request_general',
    ]);
    expect(isWorkRequestType('staff_work_request_audit')).toBe(true);
    expect(isWorkRequestType('unknown_task_type')).toBe(false);
    expect(isWorkRequestType(null)).toBe(false);
  });
});
