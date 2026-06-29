// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { ScheduleDateNavigator } from './schedule-date-navigator';

setupDomTestEnv();

describe('ScheduleDateNavigator', () => {
  it('emits the previous and next day when stepping', () => {
    const onSelectDate = vi.fn();
    render(
      <ScheduleDateNavigator value="2026-04-09" onSelectDate={onSelectDate} inputId="nav-date" />,
    );

    fireEvent.click(screen.getByRole('button', { name: '前日' }));
    expect(onSelectDate).toHaveBeenLastCalledWith('2026-04-08');

    fireEvent.click(screen.getByRole('button', { name: '翌日' }));
    expect(onSelectDate).toHaveBeenLastCalledWith('2026-04-10');
  });

  it('emits the picked date from the native input', () => {
    const onSelectDate = vi.fn();
    render(
      <ScheduleDateNavigator
        value="2026-04-09"
        onSelectDate={onSelectDate}
        inputId="nav-date"
        ariaLabel="対象日を選ぶ"
      />,
    );

    fireEvent.change(screen.getByLabelText('対象日を選ぶ'), {
      target: { value: '2026-05-01' },
    });
    expect(onSelectDate).toHaveBeenCalledWith('2026-05-01');
  });

  it('does not emit on an empty input value (teeth: avoids clobbering the date)', () => {
    const onSelectDate = vi.fn();
    render(
      <ScheduleDateNavigator
        value="2026-04-09"
        onSelectDate={onSelectDate}
        inputId="nav-date"
        ariaLabel="対象日を選ぶ"
      />,
    );

    fireEvent.change(screen.getByLabelText('対象日を選ぶ'), { target: { value: '' } });
    expect(onSelectDate).not.toHaveBeenCalled();
  });
});
