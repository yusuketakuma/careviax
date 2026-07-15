// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PrintActionButton } from './print-action-button';

setupDomTestEnv();

describe('PrintActionButton', () => {
  it('calls window.print when clicked', async () => {
    const printMock = vi.fn();
    vi.stubGlobal('print', printMock);

    render(<PrintActionButton label="印刷する" />);
    fireEvent.click(screen.getByRole('button', { name: '印刷する' }));

    expect(printMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('uses a custom print handler when provided', async () => {
    const printMock = vi.fn();
    const onPrint = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('print', printMock);

    render(<PrintActionButton label="監査して印刷" onPrint={onPrint} />);
    fireEvent.click(screen.getByRole('button', { name: '監査して印刷' }));

    await waitFor(() => expect(onPrint).toHaveBeenCalledTimes(1));
    expect(printMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('accepts the native keyboard-generated click for the print action', () => {
    const printMock = vi.fn();
    vi.stubGlobal('print', printMock);

    render(<PrintActionButton label="印刷する" />);
    const button = screen.getByRole('button', { name: '印刷する' });
    button.focus();
    fireEvent.click(button, { detail: 0 });

    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('type')).toBe('button');
    expect(printMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('latches a pending custom print action against rapid duplicate activation', async () => {
    let resolvePrint: (() => void) | undefined;
    const onPrint = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePrint = resolve;
        }),
    );

    render(<PrintActionButton label="監査して印刷" onPrint={onPrint} />);
    const button = screen.getByRole('button', { name: '監査して印刷' });
    fireEvent.click(button);
    fireEvent.click(button, { detail: 0 });

    expect(onPrint).toHaveBeenCalledTimes(1);
    expect(button).toHaveProperty('disabled', true);

    await act(async () => {
      resolvePrint?.();
      await Promise.resolve();
    });
    await waitFor(() => expect(button).toHaveProperty('disabled', false));
  });
});
