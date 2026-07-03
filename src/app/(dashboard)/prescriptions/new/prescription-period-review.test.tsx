// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PrescriptionPeriodReview } from './prescription-period-review';
import type { PeriodReviewLineInput } from './prescription-period-review.shared';

setupDomTestEnv();

const LINES: PeriodReviewLineInput[] = [
  {
    drug_name: 'ロキソニン錠60mg',
    frequency: '毎食後',
    days: 10,
    start_date: '2026-05-22',
    notes: '胃薬と確認',
  },
  {
    drug_name: 'アムロジピン錠5mg',
    frequency: '朝食後',
    days: 28,
    start_date: '2026-05-22',
    dispensing_method: 'unit_dose',
    notes: '今回中止→回収',
  },
];

describe('PrescriptionPeriodReview', () => {
  it('renders the period review table columns and row values (DataTable conversion, W3-E2)', () => {
    render(
      <PrescriptionPeriodReview
        lines={LINES}
        patientName="山田花子"
        submitBlockers={[]}
        canSubmit
        isSubmitting={false}
      />,
    );

    // 7列のヘッダが維持されている。
    for (const header of ['薬剤名', '用法', '日数', '開始日', '終了日', '加工・セット', '注意']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeTruthy();
    }

    // DataTable はデスクトップ表/モバイルカードを両方 DOM に描画するため getAllByText で拾う。
    expect(screen.getAllByText('ロキソニン錠60mg').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('アムロジピン錠5mg').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('胃薬と確認').length).toBeGreaterThanOrEqual(1);
    // DataTable はデスクトップ表/モバイルカードの2ビューを同時描画するため 2行 × 2 = 4。
    expect(screen.getAllByTestId('period-review-row').length).toBe(4);
  });

  it('returns null when there are no filled lines', () => {
    const { container } = render(
      <PrescriptionPeriodReview
        lines={[]}
        patientName="山田花子"
        submitBlockers={[]}
        canSubmit={false}
        isSubmitting={false}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
