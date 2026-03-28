'use client';

import { useCallback, useEffect, useRef } from 'react';

type UnsavedChangesGuardOptions = {
  enabled: boolean;
  message?: string;
};

export function useUnsavedChangesGuard({
  enabled,
  message = '未保存の変更があります。このまま離れますか？',
}: UnsavedChangesGuardOptions) {
  const bypassRef = useRef(false);
  const currentUrlRef = useRef<string>('');

  const allowNavigation = useCallback(() => {
    bypassRef.current = true;
  }, []);

  useEffect(() => {
    currentUrlRef.current = window.location.href;
  }, []);

  useEffect(() => {
    if (!enabled) {
      bypassRef.current = false;
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (bypassRef.current) return;
      event.preventDefault();
      event.returnValue = message;
    };

    const handleDocumentClick = (event: MouseEvent) => {
      if (bypassRef.current || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target;
      if (!(target instanceof Element)) return;

      const anchor = target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download')) return;

      const nextUrl = new URL(anchor.href, window.location.href);
      const currentUrl = new URL(window.location.href);

      if (nextUrl.origin !== currentUrl.origin) return;
      if (
        nextUrl.pathname === currentUrl.pathname &&
        nextUrl.search === currentUrl.search
      ) {
        return;
      }
      if (nextUrl.href === currentUrl.href) return;

      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      bypassRef.current = true;
    };

    const handlePopState = () => {
      if (bypassRef.current) return;

      const confirmed = window.confirm(message);
      if (!confirmed) {
        window.history.pushState(window.history.state, '', currentUrlRef.current);
        return;
      }

      bypassRef.current = true;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('click', handleDocumentClick, true);
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('click', handleDocumentClick, true);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [enabled, message]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    currentUrlRef.current = window.location.href;
  });

  return allowNavigation;
}
