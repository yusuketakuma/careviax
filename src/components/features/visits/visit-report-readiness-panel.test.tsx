// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { VisitReportReadinessPanel } from './visit-report-readiness-panel';

setupDomTestEnv();

describe('VisitReportReadinessPanel', () => {
  it('summarizes required readiness items for mobile visit capture', () => {
    render(
      <VisitReportReadinessPanel
        mode="visit_mobile"
        items={[
          {
            key: 'soap',
            label: 'SOAP',
            description: 'S/O/A/P を入力',
            done: true,
          },
          {
            key: 'collaboration',
            label: '連携メモ',
            description: '医師・ケアマネ向け事項',
            done: false,
          },
        ]}
      />,
    );

    expect(screen.getByText('訪問先で報告書に必要な材料を集める')).toBeTruthy();
    expect(screen.getByText('必須 1/2 充足')).toBeTruthy();
    expect(screen.getByText('連携メモ')).toBeTruthy();
    expect(screen.getByText('次に入力: 連携メモ')).toBeTruthy();
  });

  it('shows the next report action when all required items are ready', () => {
    render(
      <VisitReportReadinessPanel
        mode="visit_detail"
        items={[
          {
            key: 'soap',
            label: 'SOAP本文',
            description: 'S/O/A/P を確認',
            done: true,
          },
          {
            key: 'collaboration',
            label: '他職種へ送る論点',
            description: '連携事項を確認',
            done: true,
          },
        ]}
      />,
    );

    expect(screen.getByText('必須 2/2 充足')).toBeTruthy();
    expect(
      screen.getByText(
        '報告書生成へ進めます。必要に応じて医師向け・ケアマネ向けを選択してください。',
      ),
    ).toBeTruthy();
  });

  it('treats an optional-only checklist as ready', () => {
    render(
      <VisitReportReadinessPanel
        mode="report_detail"
        items={[
          {
            key: 'photo',
            label: '写真',
            description: '必要時のみ添付',
            done: false,
            required: false,
          },
        ]}
      />,
    );

    expect(screen.getByText('必須項目なし')).toBeTruthy();
    expect(
      screen.getByText('算定・送付前の必須確認は揃っています。送付前に宛先だけ最終確認してください。'),
    ).toBeTruthy();
  });
});
