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
              vehicle_resource_id: 'vehicle_1',
              vehicle_resource_label: '社用車A',
              vehicle_load: 2,
              assignment_mode: 'primary',
              care_relationship: 'primary',
              score_breakdown: {
                facilityBonus: -8,
                cadencePenalty: 12,
                vehiclePenalty: 3,
                specialtyPenalty: 40,
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
              reason_code: 'daily_capacity',
              availability_reason_code: 'outside_pharmacy_operating_window',
              reason_label: '日次上限超過',
              detail: '日次上限に到達しています',
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
          deadline_policy: [
            {
              code: 'deadline_adjusted_to_operating_day',
              site_id: 'site_1',
              from_date_key: '2026-04-12',
              to_date_key: '2026-04-10',
            },
            {
              code: 'deadline_buffer_scan_exhausted',
              site_id: 'site_1',
              date_key: '2026-04-10',
              value: '患者A / 玄関暗証番号1234',
            },
            {
              code: 'locked_date_deadline_violation',
              site_id: 'site_1',
              date_key: '2026-04-12',
              value: '2026-04-10',
            },
          ],
          review_candidates: [
            {
              code: 'review_required_candidate',
              reason_code: 'specialty_coverage_unmatched',
              pharmacist_id: 'pharmacist_1',
              site_id: 'site_1',
              proposed_date: '2026-04-09',
              match_status: 'unmatched',
              missing_label_count: 1,
              unknown_procedure_count: 0,
              required_label_count: 1,
            },
          ],
        }}
        actions={[
          {
            label: '時間帯を広げる',
            onClick: handleAction,
          },
        ]}
      />,
    );

    expect(screen.getAllByText('採用候補 1 件')[0]).toBeTruthy();
    expect(screen.getAllByText('採用外 2 件')[0]).toBeTruthy();
    expect(screen.getByText('施設集約 -8')).toBeTruthy();
    expect(screen.getByText('算定制約 +12')).toBeTruthy();
    expect(screen.getByText('車両負荷 +3')).toBeTruthy();
    expect(screen.getByText('専門対応 +40')).toBeTruthy();
    expect(screen.getByText('車両 社用車A')).toBeTruthy();
    expect(screen.getByText('社用車 社用車A / 当日同車両 2 件目')).toBeTruthy();
    expect(screen.getByText('期限診断 3 件')).toBeTruthy();
    expect(screen.getByText('薬剤師確認推奨 1 件')).toBeTruthy();
    expect(screen.getByText('期限診断')).toBeTruthy();
    expect(screen.getByText('営業日へ補正 2026-04-12→2026-04-10')).toBeTruthy();
    expect(screen.getByText('準備日数内に訪問可能日なし 2026-04-10')).toBeTruthy();
    expect(screen.getByText('固定日が期限超過 2026-04-12 2026-04-10')).toBeTruthy();
    expect(screen.queryByText(/玄関暗証番号1234/)).toBeNull();
    expect(screen.queryByText(/患者A/)).toBeNull();
    expect(screen.getByText('休業日・シフト理由')).toBeTruthy();
    expect(screen.getByText('営業時間外 1')).toBeTruthy();
    expect(screen.getByText('訪問可否: 営業時間外')).toBeTruthy();
    expect(screen.getByText('患者連絡前に薬剤師確認推奨（診断表示のみ） 1 件')).toBeTruthy();
    expect(screen.getByText('専門対応未一致 2026-04-09')).toBeTruthy();
    expect(screen.getByText('日次上限超過 1')).toBeTruthy();
    expect(screen.getByText('移動上限超過 1')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '時間帯を広げる' }));
    expect(handleAction).toHaveBeenCalledTimes(1);
  });
});
