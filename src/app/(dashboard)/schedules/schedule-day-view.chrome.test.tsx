// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { OnboardingWarningBadges, ScheduleBoardSkeleton } from './schedule-day-view.chrome';

afterEach(() => {
  cleanup();
});

describe('schedule day-view chrome', () => {
  it('renders only the missing onboarding warnings', () => {
    render(
      <OnboardingWarningBadges
        readiness={{
          consent_obtained: false,
          first_visit_doc_delivered: true,
          emergency_contact_set: false,
          management_plan_approved: false,
          primary_physician_set: false,
        }}
      />,
    );

    expect(screen.getByRole('list', { name: '訪問前提の未完了項目' })).toBeTruthy();
    expect(screen.getByText('同意未取得')).toBeTruthy();
    expect(screen.getByText('緊急連絡先未登録')).toBeTruthy();
    expect(screen.getByText('管理計画未承認')).toBeTruthy();
    expect(screen.getByText('主治医未設定')).toBeTruthy();
    expect(screen.queryByText('初回文書未交付')).toBeNull();
  });

  it('renders the loading skeleton with an accessible label', () => {
    render(<ScheduleBoardSkeleton />);

    expect(screen.getByRole('status', { name: 'スケジュールボード読み込み中' })).toBeTruthy();
  });
});
