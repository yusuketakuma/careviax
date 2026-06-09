// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchBox } from './SearchBox';

describe('SearchBox', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('focuses the search input with slash outside form fields', () => {
    render(<SearchBox query="" onQueryChange={vi.fn()} />);

    fireEvent.keyDown(window, { key: '/' });

    expect(screen.getByRole('textbox')).toBe(document.activeElement);
  });

  it('debounces input for 300ms', () => {
    vi.useFakeTimers();
    const onQueryChange = vi.fn();
    render(<SearchBox query="" onQueryChange={onQueryChange} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '山田' } });
    act(() => vi.advanceTimersByTime(299));
    expect(onQueryChange).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(onQueryChange).toHaveBeenCalledWith('山田');
  });

  it('waits for debounce after IME composition and commits once on Enter', () => {
    vi.useFakeTimers();
    const onQueryChange = vi.fn();
    render(<SearchBox query="" onQueryChange={onQueryChange} />);
    const input = screen.getByRole('textbox');

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: 'やま' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onQueryChange).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '山田' } });
    fireEvent.compositionEnd(input);
    act(() => vi.advanceTimersByTime(299));
    expect(onQueryChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onQueryChange).toHaveBeenCalledWith('山田');

    onQueryChange.mockClear();
    fireEvent.change(input, { target: { value: '山田' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onQueryChange).toHaveBeenCalledWith('山田');
    act(() => vi.advanceTimersByTime(300));
    expect(onQueryChange).toHaveBeenCalledTimes(1);
  });
});
