// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { VisitProposalDiagnosticsCard } from './visit-proposal-diagnostics-card';

setupDomTestEnv();

describe('VisitProposalDiagnosticsCard', () => {
  it('renders structured accepted and rejected diagnostics with actions', () => {
    const handleAction = vi.fn();

    render(
      <VisitProposalDiagnosticsCard
        diagnostics={{
          accepted: [
            {
              pharmacist_id: 'pharmacist_1',
              pharmacist_name: '薬剤師A',
              proposed_date: '2026-04-09',
              route_order: 2,
              score: 11.5,
              travel_summary: '前後訪問から 12 分',
              assignment_mode: 'primary',
              care_relationship: 'primary',
              score_breakdown: {
                facilityBonus: -8,
                cadencePenalty: 12,
              },
              time_window_start: '2026-04-09T09:00:00.000Z',
              time_window_end: '2026-04-09T10:00:00.000Z',
            },
          ],
          rejected: [
            {
              pharmacist_id: 'pharmacist_2',
              pharmacist_name: '薬剤師B',
              proposed_date: '2026-04-09',
              reason_code: 'travel_limit',
              reason_label: '移動上限超過',
              detail: '前後の予定を考慮すると移動負荷が高すぎます',
            },
            {
              pharmacist_id: 'pharmacist_3',
              pharmacist_name: '薬剤師C',
              proposed_date: '2026-04-09',
              reason_code: 'travel_limit',
              reason_label: '移動上限超過',
              detail: '別拠点で距離が長すぎます',
            },
          ],
        }}
        actions={[
          {
            label: '時間帯を広げる',
            onClick: handleAction,
          },
        ]}
      />
    );

    expect(screen.getAllByText('採用候補 1 件')[0]).toBeTruthy();
    expect(screen.getAllByText('採用外 2 件')[0]).toBeTruthy();
    expect(screen.getByText('施設集約 -8')).toBeTruthy();
    expect(screen.getByText('算定制約 +12')).toBeTruthy();
    expect(screen.getAllByText('移動上限超過 2')[0]).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '時間帯を広げる' }));
    expect(handleAction).toHaveBeenCalledTimes(1);
  });
});
