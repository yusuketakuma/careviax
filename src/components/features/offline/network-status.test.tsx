// @vitest-environment jsdom

import { screen, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { NetworkStatus } from './network-status';

setupDomTestEnv();

const originalOnline = window.navigator.onLine;

afterEach(() => {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value: originalOnline,
  });
});

describe('NetworkStatus', () => {
  it('hydrates cleanly and shows the offline banner when the browser is offline', async () => {
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    const container = document.createElement('div');
    container.innerHTML = renderToString(<NetworkStatus />);
    document.body.append(container);

    hydrateRoot(container, <NetworkStatus />);

    await waitFor(() => {
      expect(screen.getByText('オフライン — 読取専用モード')).not.toBeNull();
    });
  });
});
