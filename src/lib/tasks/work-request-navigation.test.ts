import { describe, expect, it } from 'vitest';
import { buildWorkRequestHref } from './work-request-navigation';

describe('buildWorkRequestHref', () => {
  it('builds task work-request links with related entity context', () => {
    expect(
      buildWorkRequestHref({
        type: 'staff_work_request_visit',
        title: '伊藤さんの訪問に行ってほしい',
        relatedEntityType: 'visit_schedule',
        relatedEntityId: 'visit_1',
        context: 'schedule_visit_card',
      }),
    ).toBe(
      '/tasks?work_request=1&work_request_type=staff_work_request_visit&work_request_title=%E4%BC%8A%E8%97%A4%E3%81%95%E3%82%93%E3%81%AE%E8%A8%AA%E5%95%8F%E3%81%AB%E8%A1%8C%E3%81%A3%E3%81%A6%E3%81%BB%E3%81%97%E3%81%84&related_entity_type=visit_schedule&related_entity_id=visit_1&context=schedule_visit_card',
    );
  });

  it('defaults to a general work request', () => {
    expect(buildWorkRequestHref()).toBe(
      '/tasks?work_request=1&work_request_type=staff_work_request_general',
    );
  });
});
