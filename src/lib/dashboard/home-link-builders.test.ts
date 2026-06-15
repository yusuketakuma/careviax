import { describe, expect, it } from 'vitest';
import {
  buildHandoffHref,
  buildConferencesHref,
  buildExternalHref,
  buildMyDayHref,
  buildNotificationsHref,
  buildReportsHref,
  buildTasksHref,
  buildWorkflowHref,
} from './home-link-builders';

describe('home-link-builders', () => {
  it('builds My Day hrefs with focused dashboard context', () => {
    expect(
      buildMyDayHref({
        focus: 'visits',
        visitFilter: 'unprepared',
        context: 'dashboard_home',
      }),
    ).toBe('/my-day?focus=visits&visit_filter=unprepared&context=dashboard_home');
  });

  it('builds Tasks hrefs with assigned and status filters', () => {
    expect(
      buildTasksHref({
        assigned: 'me',
        status: 'pending',
        context: 'dashboard_home',
      }),
    ).toBe('/tasks?assigned=me&status=pending&context=dashboard_home');
  });

  it('builds Workflow and Notifications hrefs with dashboard context', () => {
    expect(
      buildWorkflowHref({
        focus: 'communication',
        context: 'dashboard_home',
      }),
    ).toBe('/workflow?focus=communication&context=dashboard_home');

    expect(
      buildNotificationsHref({
        tab: 'unread',
        type: 'urgent',
        context: 'dashboard_home',
      }),
    ).toBe('/notifications?type=urgent&context=dashboard_home');

    expect(
      buildHandoffHref({
        filter: 'unread',
        context: 'dashboard_home',
      }),
    ).toBe('/handoff');

    expect(
      buildReportsHref({
        focus: 'delivery',
        deliveryStatus: 'response_waiting',
        context: 'dashboard_home',
      }),
    ).toBe('/reports?focus=delivery&delivery_status=response_waiting&context=dashboard_home');

    expect(
      buildExternalHref({
        focus: 'self_reports',
        context: 'dashboard_home',
      }),
    ).toBe('/external?focus=self_reports&context=dashboard_home');

    expect(
      buildConferencesHref({
        focus: 'notes',
        context: 'dashboard_home',
      }),
    ).toBe('/conferences?focus=notes&context=dashboard_home');
  });
});
