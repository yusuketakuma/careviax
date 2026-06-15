// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { DashboardContent } from './dashboard-content';

setupDomTestEnv();

vi.mock('./dashboard-cockpit', () => ({
  DashboardCockpit: () => <div data-testid="dashboard-cockpit">dashboard-cockpit</div>,
}));

describe('DashboardContent', () => {
  it('renders only the current operations cockpit', () => {
    render(<DashboardContent />);

    expect(screen.getByTestId('dashboard-cockpit')).toBeTruthy();
    expect(screen.queryByText('スケジュール')).toBeNull();
    expect(screen.queryByText('業務導線')).toBeNull();
    expect(screen.queryByText('請求状況')).toBeNull();
    expect(screen.queryByText('職種ごとの初動')).toBeNull();
    expect(screen.queryByText('主業務フロー')).toBeNull();
  });
});
