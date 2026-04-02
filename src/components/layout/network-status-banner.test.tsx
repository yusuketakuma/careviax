// @vitest-environment jsdom

import { screen, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { NetworkStatusBanner } from './network-status-banner';

setupDomTestEnv();

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const originalOnline = window.navigator.onLine;

afterEach(() => {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value: originalOnline,
  });
});

describe('NetworkStatusBanner', () => {
  it('keeps hydration stable and shows the banner after mount when offline', async () => {
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    const container = document.createElement('div');
    container.innerHTML = renderToString(<NetworkStatusBanner />);
    document.body.append(container);

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    hydrateRoot(container, <NetworkStatusBanner />);

    await waitFor(() => {
      expect(screen.getByText(/ネットワーク接続が切れています/)).not.toBeNull();
    });

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
