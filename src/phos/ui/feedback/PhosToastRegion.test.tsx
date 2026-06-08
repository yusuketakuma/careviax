// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { appendPhosToast, PhosToastRegion } from './PhosToastRegion';
import type { PhosToastEntry, PhosToastInput } from './PhosToastRegion';

const actionErrorToast = {
  tone: 'ERROR',
  message_key: 'toast.action.error',
  params: { message: '通信できません。再試行してください。' },
} satisfies PhosToastInput;

describe('PhosToastRegion', () => {
  it('debounces duplicate toast messages inside the configured window', () => {
    const first = appendPhosToast([], actionErrorToast, 1_000, 3_000);
    const duplicate = appendPhosToast(first, actionErrorToast, 2_000, 3_000);
    const afterDebounce = appendPhosToast(duplicate, actionErrorToast, 4_500, 3_000);

    expect(first).toHaveLength(1);
    expect(duplicate).toHaveLength(1);
    expect(afterDebounce).toHaveLength(2);
  });

  it('uses stable params when detecting duplicate toast messages', () => {
    const first = appendPhosToast(
      [],
      { tone: 'INFO', message_key: 'toast.custom', params: { b: '2', a: '1' } },
      1_000,
      3_000,
    );
    const duplicate = appendPhosToast(
      first,
      { tone: 'INFO', message_key: 'toast.custom', params: { a: '1', b: '2' } },
      2_000,
      3_000,
    );

    expect(duplicate).toHaveLength(1);
  });

  it('keeps only the newest toast messages when the stack reaches max count', () => {
    const toasts = [0, 1, 2, 3].reduce<PhosToastEntry[]>(
      (current, index) =>
        appendPhosToast(
          current,
          { tone: 'INFO', message_key: `toast.custom.${index}` },
          1_000 + index,
          3_000,
          3,
        ),
      [],
    );

    expect(toasts).toHaveLength(3);
    expect(toasts.map((toast) => toast.message_key)).toEqual([
      'toast.custom.1',
      'toast.custom.2',
      'toast.custom.3',
    ]);
  });

  it('renders PH-OS toast notifications as a live status region', () => {
    const toasts: PhosToastEntry[] = appendPhosToast(
      [],
      { tone: 'SUCCESS', message_key: 'toast.handoff.created' },
      1_000,
    );

    render(<PhosToastRegion toasts={toasts} />);

    const region = screen.getByRole('status', { name: 'PH-OS toast notifications' });
    expect(within(region).getByText('薬剤師への確認依頼を作成しました。')).toBeTruthy();
  });
});
