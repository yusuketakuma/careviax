// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
});
