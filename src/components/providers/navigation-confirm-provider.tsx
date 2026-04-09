'use client';

import { useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

type ConfirmResolver = (confirmed: boolean) => void;

let requestHandler: ((message: string) => Promise<boolean>) | null = null;

export function requestNavigationConfirmation(message: string) {
  if (requestHandler) {
    return requestHandler(message);
  }
  return Promise.resolve(window.confirm(message));
}

export function NavigationConfirmProvider() {
  const resolverRef = useRef<ConfirmResolver | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    requestHandler = (nextMessage: string) =>
      new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
        setMessage(nextMessage);
      });

    return () => {
      requestHandler = null;
    };
  }, []);

  function handleClose(confirmed: boolean) {
    resolverRef.current?.(confirmed);
    resolverRef.current = null;
    setMessage(null);
  }

  return (
    <ConfirmDialog
      open={message != null}
      onOpenChange={(open) => {
        if (!open) handleClose(false);
      }}
      title="未保存の変更があります"
      description={message ?? ''}
      confirmLabel="移動する"
      cancelLabel="とどまる"
      onConfirm={() => handleClose(true)}
    />
  );
}
