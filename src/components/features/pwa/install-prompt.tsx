'use client';

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Captures the browser's beforeinstallprompt event and shows a banner
 * allowing the user to add PH-OS to their home screen.
 */
export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    setDeferredPrompt(null);
  };

  if (!deferredPrompt || dismissed) return null;

  return (
    <div
      role="banner"
      className={cn(
        'fixed bottom-20 left-4 right-4 z-50 md:bottom-4 md:left-auto md:right-4 md:w-80',
        'flex items-start gap-3 rounded-lg border border-border bg-card p-4 shadow-lg',
        'animate-in slide-in-from-bottom duration-300'
      )}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary">
        <Download className="h-5 w-5 text-primary-foreground" aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-card-foreground">
          PH-OS をホーム画面に追加
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          オフラインでも使えるアプリとして利用できます。
        </p>
        <div className="mt-3 flex gap-2">
          <Button size="sm" className="min-h-[44px] flex-1" onClick={handleInstall}>
            追加
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="min-h-[44px] flex-1"
            onClick={handleDismiss}
          >
            後で
          </Button>
        </div>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="閉じる"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
