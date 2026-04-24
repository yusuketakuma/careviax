import { describe, expect, it } from 'vitest';
import { isLayoutNavItemActive, isTopWorkflowLinkActive } from './navigation-utils';
import { MOBILE_BOTTOM_NAV_ITEMS, TOP_WORKFLOW_LINKS } from './navigation-config';
import { Home } from 'lucide-react';

describe('layout navigation active matching', () => {
  it('keeps handoff routes out of the visit mobile nav item', () => {
    const visitItem = MOBILE_BOTTOM_NAV_ITEMS.find((item) => item.label === '訪問時');
    if (!visitItem) throw new Error('visit item is required');

    expect(isLayoutNavItemActive('/visits/schedule_1/record', visitItem)).toBe(true);
    expect(isLayoutNavItemActive('/visits/handoffs/record_1', visitItem)).toBe(false);
  });

  it('matches top workflow links by configured prefixes', () => {
    const reports = TOP_WORKFLOW_LINKS.find((item) => item.label === '報告書');
    if (!reports) throw new Error('report shortcut is required');

    expect(isTopWorkflowLinkActive('/reports/report_1', reports)).toBe(true);
    expect(isTopWorkflowLinkActive('/visits/schedule_1/record', reports)).toBe(false);
  });

  it('keeps handoff routes out of the top visit shortcut', () => {
    const visits = TOP_WORKFLOW_LINKS.find((item) => item.label === '訪問時');
    if (!visits) throw new Error('visit shortcut is required');

    expect(isTopWorkflowLinkActive('/visits/schedule_1/record', visits)).toBe(true);
    expect(isTopWorkflowLinkActive('/visits/handoffs/record_1', visits)).toBe(false);
  });

  it('treats dashboard home as an exact-match root entry', () => {
    const home = { label: 'ホーム', href: '/dashboard', icon: Home };

    expect(isLayoutNavItemActive('/dashboard', home)).toBe(true);
    expect(isLayoutNavItemActive('/dashboard-preview', home)).toBe(false);
  });
});
