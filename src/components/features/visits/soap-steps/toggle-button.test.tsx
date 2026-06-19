// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { ToggleButton } from './toggle-button';

setupDomTestEnv();

describe('SOAP ToggleButton', () => {
  it('exposes the selected state and dispatches toggle actions', () => {
    const onToggle = vi.fn();

    const { rerender } = render(<ToggleButton selected={false} label="眠気" onToggle={onToggle} />);

    const button = screen.getByRole('button', { name: '眠気' });
    expect(button.getAttribute('aria-pressed')).toBe('false');

    rerender(<ToggleButton selected label="眠気" onToggle={onToggle} />);

    expect(button.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(button);

    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
