'use client';

import { useEffect, useState } from 'react';
import { RotateCcw, Smartphone } from 'lucide-react';

type ScreenOrientationWithLock = ScreenOrientation & {
  lock?: (orientation: 'portrait' | 'landscape' | 'any') => Promise<void>;
  unlock?: () => void;
};

type ViewportState = {
  isPhone: boolean;
  isLandscape: boolean;
};

function readViewportState(): ViewportState {
  if (typeof window === 'undefined') {
    return { isPhone: false, isLandscape: false };
  }

  return {
    isPhone: window.innerWidth < 768,
    isLandscape: window.matchMedia('(orientation: landscape)').matches,
  };
}

export function MobileOrientationGuard() {
  const [viewport, setViewport] = useState<ViewportState>(() => readViewportState());

  useEffect(() => {
    const mediaQuery = window.matchMedia('(orientation: landscape)');
    const syncViewport = () => setViewport(readViewportState());

    syncViewport();
    mediaQuery.addEventListener('change', syncViewport);
    window.addEventListener('resize', syncViewport);

    return () => {
      mediaQuery.removeEventListener('change', syncViewport);
      window.removeEventListener('resize', syncViewport);
    };
  }, []);

  useEffect(() => {
    const orientation = window.screen.orientation as ScreenOrientationWithLock;

    if (!viewport.isPhone) {
      orientation.unlock?.();
      return;
    }

    void orientation.lock?.('portrait')?.catch(() => {
      // Some browsers only allow orientation lock in fullscreen or installed mode.
    });
  }, [viewport.isPhone]);

  if (!viewport.isPhone || !viewport.isLandscape) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-background/95 px-6 text-center backdrop-blur-sm md:hidden print:hidden">
      <div className="max-w-sm space-y-4 rounded-3xl border border-border bg-card p-6 shadow-xl">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Smartphone className="size-7" aria-hidden="true" />
        </div>
        <div className="space-y-2">
          <p className="text-lg font-semibold text-foreground">スマートフォンは縦向きで利用してください</p>
          <p className="text-sm leading-6 text-muted-foreground">
            横向き最適化はタブレット向けです。端末を縦向きに戻すと訪問画面へ復帰します。
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-border/70 px-3 py-2 text-sm text-muted-foreground">
          <RotateCcw className="size-4" aria-hidden="true" />
          端末を回転
        </div>
      </div>
    </div>
  );
}
