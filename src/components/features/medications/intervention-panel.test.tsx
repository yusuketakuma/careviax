// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { jsonResponse } from '@/test/fetch-test-utils';
import { InterventionPanel, type Intervention } from './intervention-panel';

setupDomTestEnv();

function buildIntervention(overrides: Partial<Intervention> = {}): Intervention {
  return {
    id: 'intervention_1',
    patient_id: 'patient_1',
    issue_id: null,
    type: 'dose_adjustment',
    description: '用量を減量',
    outcome: null,
    performed_by: 'user_1',
    performed_at: '2026-06-20T00:00:00.000Z',
    created_at: '2026-06-20T00:05:00.000Z',
    ...overrides,
  };
}

function openCreateDialog() {
  // Passing initialInterventions suppresses the mount-time fetch.
  render(<InterventionPanel patientId="patient_1" initialInterventions={[buildIntervention()]} />);
  fireEvent.click(screen.getByRole('button', { name: '介入記録' }));
}

describe('InterventionPanel new intervention form', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('renders a named skeleton while interventions are loading', () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}) as Promise<Response>);

    render(<InterventionPanel patientId="patient_1" />);

    expect(screen.getByRole('status', { name: '介入記録を読み込み中' })).toBeTruthy();
    expect(screen.queryByText('読み込み中...', { selector: 'p' })).toBeNull();
    expect(screen.queryByText('介入記録はありません。')).toBeNull();
    expect(screen.queryByText('介入記録の読み込みに失敗しました。')).toBeNull();
  });

  it('shows the intervention type label, not the raw enum, in the closed select trigger', async () => {
    // A bare <SelectValue /> leaks the raw default enum. Explicit children keep SSR labels stable.
    openCreateDialog();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '介入記録の追加' })).toBeTruthy();
    });

    const trigger = document.querySelector('[data-slot="select-trigger"]');
    expect(trigger?.textContent).toContain('その他');
    expect(trigger?.textContent).not.toContain('other');
  });

  it('defaults the performed-at input to local wall-clock minutes, not UTC', async () => {
    // datetime-local expects local wall-clock time. Reusing UTC ISO text shifts by 9 hours in JST.
    const originalTz = process.env.TZ;
    process.env.TZ = 'Asia/Tokyo';
    // performedAt is captured during initial render; real timers keep the dialog async path moving.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-28T00:00:00.000Z')); // JST is 2026-06-28 09:00

    try {
      render(
        <InterventionPanel patientId="patient_1" initialInterventions={[buildIntervention()]} />,
      );
      vi.useRealTimers();

      fireEvent.click(screen.getByRole('button', { name: '介入記録' }));
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: '介入記録の追加' })).toBeTruthy();
      });

      const input = document.querySelector(
        'input[type="datetime-local"]',
      ) as HTMLInputElement | null;
      // Local wall-clock time should be JST 09:00, not the UTC slice 00:00.
      expect(input?.value).toBe('2026-06-28T09:00');
      expect(input?.value).not.toBe('2026-06-28T00:00');
    } finally {
      process.env.TZ = originalTz;
    }
  });

  it('keeps API messages from failed intervention creation responses', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ message: '介入記録の作成権限がありません' }, 403),
    );

    openCreateDialog();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '介入記録の追加' })).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('介入内容'), {
      target: { value: '服薬支援を実施' },
    });
    fireEvent.click(screen.getByRole('button', { name: '追加' }));

    await waitFor(() => {
      expect(screen.getByText('介入記録の作成権限がありません')).toBeTruthy();
    });
  });

  it('keeps API messages from failed intervention outcome save responses', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ message: '介入結果の更新権限がありません' }, 403),
    );

    render(
      <InterventionPanel patientId="patient_1" initialInterventions={[buildIntervention()]} />,
    );

    const expandButton = document.querySelector(
      'button[aria-expanded="false"]',
    ) as HTMLButtonElement;
    fireEvent.click(expandButton);
    fireEvent.click(screen.getByRole('button', { name: '記録' }));
    fireEvent.change(screen.getByPlaceholderText('介入の結果・効果を記録...'), {
      target: { value: '症状軽快' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(screen.getByText('介入結果の更新権限がありません')).toBeTruthy();
    });
  });
});
