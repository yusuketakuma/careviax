// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const requestNavigationConfirmationMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/providers/navigation-confirm-provider', () => ({
  requestNavigationConfirmation: requestNavigationConfirmationMock,
}));

import { useUnsavedChangesGuard } from './use-unsaved-changes-guard';

setupDomTestEnv();

function Harness({ enabled }: { enabled: boolean }) {
  const allowNavigation = useUnsavedChangesGuard({
    enabled,
    message: '未保存の変更があります。このまま離れますか？',
  });

  return (
    <div>
      <button onClick={() => allowNavigation()}>allow</button>
      <a href="http://localhost/next">next</a>
    </div>
  );
}

describe('useUnsavedChangesGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('asks for confirmation on browser history navigation', async () => {
    requestNavigationConfirmationMock.mockResolvedValue(false);
    window.history.pushState({}, '', '/current');

    render(<Harness enabled />);

    window.dispatchEvent(new PopStateEvent('popstate'));

    await waitFor(() => {
      expect(requestNavigationConfirmationMock).toHaveBeenCalledWith(
        '未保存の変更があります。このまま離れますか？'
      );
    });
  });

  it('does not confirm after allowNavigation is called', async () => {
    requestNavigationConfirmationMock.mockResolvedValue(true);

    render(<Harness enabled />);

    fireEvent.click(screen.getByRole('button', { name: 'allow' }));

    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    Object.defineProperty(event, 'returnValue', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    window.dispatchEvent(event);

    expect(requestNavigationConfirmationMock).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
