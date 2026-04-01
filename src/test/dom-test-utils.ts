import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

export function setupDomTestEnv() {
  afterEach(() => {
    cleanup();
  });

  if (typeof window !== 'undefined' && !window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  }

  if (
    typeof HTMLElement !== 'undefined' &&
    !Object.prototype.hasOwnProperty.call(HTMLElement.prototype, 'scrollIntoView')
  ) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
  }

  if (typeof globalThis.ResizeObserver === 'undefined') {
    class ResizeObserverMock {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  }
}
