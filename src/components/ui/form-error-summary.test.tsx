// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { FormErrorSummary } from './form-error-summary';

setupDomTestEnv();

const items = [
  { path: 'name', label: '氏名', message: '氏名は必須です' },
  { path: 'gender', label: '性別', message: '性別を選択してください' },
];

describe('FormErrorSummary', () => {
  it('renders labels and messages by default', () => {
    render(<FormErrorSummary items={items} />);

    expect(screen.getByText('入力内容を確認してください')).toBeTruthy();
    expect(screen.getByText('氏名')).toBeTruthy();
    expect(screen.getByText('：氏名は必須です')).toBeTruthy();
  });

  it('can render a label-only summary when inline field messages are already visible', () => {
    render(<FormErrorSummary items={items} title="必須項目を確認してください" showMessage={false} />);

    expect(screen.getByText('必須項目を確認してください')).toBeTruthy();
    expect(screen.getByText('氏名')).toBeTruthy();
    expect(screen.queryByText('：氏名は必須です')).toBeNull();
  });

  it('renders compact chips when requested for label-only summaries', () => {
    render(
      <FormErrorSummary
        items={items}
        title="必須の2項目を入力してください"
        showMessage={false}
        compact
      />
    );

    expect(screen.getByText('必須の2項目を入力してください')).toBeTruthy();
    expect(screen.getByText('氏名')).toBeTruthy();
    expect(screen.getByText('性別')).toBeTruthy();
    expect(screen.queryByText('：性別を選択してください')).toBeNull();
  });
});
