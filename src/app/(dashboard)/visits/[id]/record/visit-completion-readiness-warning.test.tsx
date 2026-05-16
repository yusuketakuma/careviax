// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VisitCompletionReadinessWarning } from './visit-completion-readiness-warning';

describe('VisitCompletionReadinessWarning', () => {
  it('announces missing visit medication-management checks before completion', () => {
    render(
      <VisitCompletionReadinessWarning
        items={[
          { label: '服薬状況の確認' },
          { label: '残薬確認' },
          { label: '副作用・有害事象確認' },
          { label: 'ポリファーマシー・重複相互作用確認' },
          { label: '夜間休日連絡体制の確認' },
          { label: '同日併算定制限の確認' },
        ]}
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByText('訪問完了前に必須確認が残っています')).toBeTruthy();
    expect(
      screen.getByText(
        '服薬状況の確認 / 残薬確認 / 副作用・有害事象確認 / ポリファーマシー・重複相互作用確認 / 夜間休日連絡体制の確認',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/同日併算定制限の確認/)).toBeNull();
    expect(
      screen.getByText(
        '完了・課題あり完了・再訪問必要で保存する場合は、訪問薬剤管理セクションで確認を完了してください。',
      ),
    ).toBeTruthy();
  });
});
