'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { signIn, signOut, useSession } from 'next-auth/react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Clock, LogOut } from 'lucide-react';
import {
  COGNITO_CHALLENGE_STORAGE_KEY,
  decodeCognitoChallenge,
} from '@/lib/auth/cognito-challenge';
import { clearOfflineEncryptionKey } from '@/lib/offline/crypto';

/** Session duration in ms (30 minutes) */
const SESSION_DURATION_MS = 30 * 60 * 1000;
/** Warning threshold in ms (5 minutes before expiry) */
const WARNING_THRESHOLD_MS = 5 * 60 * 1000;

export function SessionTimeoutModal() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expiryRef = useRef<number>(Date.now() + SESSION_DURATION_MS);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const resetTimer = useCallback(() => {
    expiryRef.current = Date.now() + SESSION_DURATION_MS;
    setOpen(false);
    setPassword('');
    setError(null);
  }, []);

  // Activity listeners to reset the expiry on user interaction
  useEffect(() => {
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'] as const;

    function handleActivity() {
      // Only reset if the modal is not yet showing
      if (!open) {
        expiryRef.current = Date.now() + SESSION_DURATION_MS;
      }
    }

    for (const event of events) {
      window.addEventListener(event, handleActivity, { passive: true });
    }

    return () => {
      for (const event of events) {
        window.removeEventListener(event, handleActivity);
      }
    };
  }, [open]);

  // Countdown tick
  useEffect(() => {
    timerRef.current = setInterval(() => {
      const remaining = expiryRef.current - Date.now();

      if (remaining <= 0) {
        // Session expired, force logout
        void clearOfflineEncryptionKey();
        signOut({ callbackUrl: '/login?error=SessionExpired' });
        return;
      }

      if (remaining <= WARNING_THRESHOLD_MS) {
        setRemainingSeconds(Math.ceil(remaining / 1000));
        setOpen(true);
      }
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  function formatTime(totalSeconds: number): string {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  async function handleExtendSession(e: React.FormEvent) {
    e.preventDefault();
    if (!password || !session?.user?.email) return;

    setError(null);
    setIsLoading(true);

    try {
      const callbackUrl = `${window.location.pathname}${window.location.search}`;
      const result = await signIn('credentials', {
        email: session.user.email,
        password,
        mode: 'password',
        callbackUrl,
        redirect: false,
      });
      if (result?.error) {
        const challenge = decodeCognitoChallenge(result.error);
        if (challenge) {
          window.sessionStorage.setItem(
            COGNITO_CHALLENGE_STORAGE_KEY,
            JSON.stringify(challenge)
          );
          window.location.href = `/mfa?callbackUrl=${encodeURIComponent(callbackUrl)}`;
          return;
        }

        setError('パスワードが正しくありません。');
        return;
      }
      resetTimer();
    } catch {
      setError('再認証に失敗しました。再度お試しください。');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleLogout() {
    await clearOfflineEncryptionKey();
    await signOut({ callbackUrl: '/login' });
  }

  return (
    <Dialog open={open}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-amber-500" aria-hidden="true" />
            セッションタイムアウト
          </DialogTitle>
          <DialogDescription>
            セキュリティのため、一定時間操作がない場合は自動的にログアウトされます。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Countdown */}
          <div className="flex items-center justify-center rounded-lg bg-amber-50 border border-amber-200 p-4">
            <div className="text-center">
              <p className="text-sm text-amber-700 mb-1">セッション残り時間</p>
              <p
                className="text-3xl font-bold font-mono text-amber-800 tabular-nums"
                aria-live="polite"
                aria-atomic="true"
              >
                {formatTime(remainingSeconds)}
              </p>
            </div>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Re-auth form */}
          <form onSubmit={handleExtendSession} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="session-password">
                パスワードを入力してセッションを延長
              </Label>
              <Input
                id="session-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="パスワード"
                disabled={isLoading}
                autoFocus
              />
            </div>

            <Button
              type="submit"
              size="lg"
              className="w-full bg-blue-600 hover:bg-blue-700"
              disabled={!password || isLoading || !session?.user?.email}
              aria-busy={isLoading}
            >
              {isLoading ? '認証中...' : 'セッションを延長'}
            </Button>
          </form>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="lg"
            className="w-full"
            onClick={handleLogout}
          >
            <LogOut className="mr-2 h-4 w-4" />
            ログアウト
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
