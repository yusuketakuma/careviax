// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
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
});
