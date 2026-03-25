'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  msUntilSessionWarning,
  msUntilSessionExpiry,
} from '@/lib/utils/session';

interface SessionTimeoutWarningProps {
  /** Called when the user requests a session refresh. */
  onRefresh: () => Promise<void>;
}

/**
 * Monitors session activity and shows a warning modal 5 minutes before expiry.
 * Automatically redirects to /login when the session expires.
 */
export function SessionTimeoutWarning({ onRefresh }: SessionTimeoutWarningProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const lastActivityRef = useRef<number>(Date.now());
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearAllTimers = useCallback(() => {
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
  }, []);

  const handleExpiry = useCallback(() => {
    clearAllTimers();
    setOpen(false);
    router.push('/login');
  }, [clearAllTimers, router]);

  const scheduleTimers = useCallback(() => {
    clearAllTimers();

    const now = lastActivityRef.current;
    const msToWarning = msUntilSessionWarning(now);
    const msToExpiry = msUntilSessionExpiry(now);

    if (msToExpiry <= 0) {
      handleExpiry();
      return;
    }

    warningTimerRef.current = setTimeout(() => {
      const remaining = Math.ceil(msUntilSessionExpiry(lastActivityRef.current) / 1000);
      setSecondsLeft(remaining);
      setOpen(true);

      countdownRef.current = setInterval(() => {
        setSecondsLeft((prev) => {
          if (prev <= 1) {
            if (countdownRef.current) clearInterval(countdownRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }, msToWarning);

    expiryTimerRef.current = setTimeout(handleExpiry, msToExpiry);
  }, [clearAllTimers, handleExpiry]);

  // Track activity to reset the session timer
  const resetActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    if (open) return; // Don't reschedule while warning is visible
    scheduleTimers();
  }, [open, scheduleTimers]);

  useEffect(() => {
    scheduleTimers();

    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, resetActivity, { passive: true }));

    return () => {
      clearAllTimers();
      events.forEach((e) => window.removeEventListener(e, resetActivity));
    };
  }, [scheduleTimers, resetActivity, clearAllTimers]);

  const handleExtend = async () => {
    setIsRefreshing(true);
    try {
      await onRefresh();
      lastActivityRef.current = Date.now();
      setOpen(false);
      scheduleTimers();
    } catch {
      // If refresh fails, expire the session
      handleExpiry();
    } finally {
      setIsRefreshing(false);
    }
  };

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const timeLabel =
    minutes > 0
      ? `${minutes}分${seconds.toString().padStart(2, '0')}秒`
      : `${seconds}秒`;

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>セッションがまもなく終了します</AlertDialogTitle>
          <AlertDialogDescription>
            {secondsLeft > 0 ? (
              <>
                セッションの有効期限まで残り{' '}
                <span className="font-semibold text-foreground">{timeLabel}</span>{' '}
                です。「セッションを延長」を押して作業を続けるか、自動的にログアウトされます。
              </>
            ) : (
              'セッションが終了しました。ログインページへ移動します。'
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button
            variant="outline"
            onClick={handleExpiry}
            disabled={isRefreshing}
          >
            ログアウト
          </Button>
          <Button
            onClick={handleExtend}
            disabled={isRefreshing || secondsLeft === 0}
          >
            {isRefreshing ? '延長中...' : 'セッションを延長'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
