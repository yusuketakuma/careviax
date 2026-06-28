// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
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
});
