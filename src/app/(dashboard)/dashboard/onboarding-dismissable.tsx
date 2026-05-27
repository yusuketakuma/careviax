'use client';

import { useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

const STORAGE_KEY = 'ph-os-onboarding-dismissed';
const STORAGE_EVENT = 'ph-os-onboarding-dismissed-change';

function readDismissedSnapshot() {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(STORAGE_KEY) === 'true';
}

function subscribeToDismissed(callback: () => void) {
  if (typeof window === 'undefined') return () => undefined;

  const handleStorage = (event: StorageEvent) => {
    if (event.key && event.key !== STORAGE_KEY) return;
    callback();
  };
  const handleLocalChange = () => callback();

  window.addEventListener('storage', handleStorage);
  window.addEventListener(STORAGE_EVENT, handleLocalChange);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(STORAGE_EVENT, handleLocalChange);
  };
}

function notifyDismissedChange() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(STORAGE_EVENT));
}

function useOnboardingDismissed() {
  return useSyncExternalStore(subscribeToDismissed, readDismissedSnapshot, () => null);
}

export function OnboardingDismissable({ children }: { children: React.ReactNode }) {
  const dismissed = useOnboardingDismissed();

  // Avoid layout shift while reading localStorage
  if (dismissed === null) return null;

  if (dismissed) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          localStorage.setItem(STORAGE_KEY, 'true');
          notifyDismissedChange();
        }}
        className="absolute right-3 top-3 z-10 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:min-h-0 sm:min-w-0"
        aria-label="オンボーディングを閉じる"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
      {children}
    </div>
  );
}

export function OnboardingRestoreLink() {
  const dismissed = useOnboardingDismissed();

  if (!dismissed) return null;

  return (
    <Button
      variant="link"
      size="sm"
      className="h-auto px-0 py-0 text-xs text-muted-foreground hover:text-foreground"
      onClick={() => {
        localStorage.removeItem(STORAGE_KEY);
        notifyDismissedChange();
      }}
    >
      オンボーディングを表示
    </Button>
  );
}
