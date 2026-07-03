// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import type { CdsAlert } from '@/lib/cds/alert-contract';
import { CdsAlertPanel } from './alert-panel';

setupDomTestEnv();

describe('CdsAlertPanel', () => {
  it('announces critical alert sets once and keeps item details non-interruptive', () => {
    const alerts = [
      {
        type: 'contraindication',
        severity: 'critical',
        message: '禁忌薬が含まれています',
      },
      {
        type: 'duration',
        severity: 'warning',
        message: '投与日数が長めです',
      },
      {
        type: 'note',
        severity: 'info',
        message: '監査時に確認してください',
      },
    ] satisfies CdsAlert[];

    render(<CdsAlertPanel alerts={alerts} />);

    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert').textContent).toContain('禁忌薬が含まれています');
    expect(screen.getByText('投与日数が長めです').closest('[role="alert"]')).toBeNull();
    expect(screen.getByText('監査時に確認してください').closest('[role="alert"]')).toBeNull();
  });

  it('uses a polite status for warning-only, no-alert, and loading states', () => {
    const { rerender } = render(
      <CdsAlertPanel
        alerts={[
          {
            type: 'duration',
            severity: 'warning',
            message: '投与日数が長めです',
          },
        ]}
      />,
    );

    expect(screen.getByRole('status').textContent).toContain('投与日数が長めです');
    expect(screen.queryByRole('alert')).toBeNull();

    rerender(<CdsAlertPanel alerts={[]} />);

    expect(screen.getByRole('status').textContent).toContain('処方安全アラートはありません');
    expect(screen.queryByRole('alert')).toBeNull();

    rerender(<CdsAlertPanel alerts={[]} isLoading />);

    expect(screen.getByRole('status').textContent).toContain('処方安全アラートを確認中です');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows an interruptive safety-unavailable state instead of no alerts', () => {
    const { rerender } = render(<CdsAlertPanel alerts={[]} />);

    expect(screen.getByRole('status').textContent).toContain('処方安全アラートはありません');
    expect(screen.queryByRole('alert')).toBeNull();

    rerender(<CdsAlertPanel alerts={[]} isUnavailable />);

    expect(screen.getByRole('alert').textContent).toContain('処方安全チェックを完了できません');
    expect(screen.queryByText('処方安全アラートはありません')).toBeNull();
  });

  it('renders Tall Man and LASA details when a medication-safety alert is expanded', () => {
    render(
      <CdsAlertPanel
        alerts={[
          {
            type: 'lasa_drug_name',
            severity: 'warning',
            message: '類似薬剤名注意: DOBUTamine注100mg',
            details: {
              drug_display_name: 'DOBUTamine注100mg',
              tall_man_name: 'DOBUTamine注100mg',
              lasa_group_key: 'dobutamine_dopamine',
            },
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '詳細を見る' }));

    expect(screen.getByText('Tall Man表記')).toBeTruthy();
    expect(screen.getAllByText('DOBUTamine注100mg').length).toBeGreaterThan(0);
    expect(screen.getByText('LASAグループ')).toBeTruthy();
    expect(screen.getByText('dobutamine_dopamine')).toBeTruthy();
  });
});
