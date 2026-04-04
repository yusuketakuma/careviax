'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

const STORAGE_KEY = 'careviax-onboarding-dismissed';

export function OnboardingDismissable({ children }: { children: React.ReactNode }) {
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    setDismissed(localStorage.getItem(STORAGE_KEY) === 'true');
  }, []);

  // Avoid layout shift while reading localStorage
  if (dismissed === null) return null;

  if (dismissed) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setDismissed(true);
          localStorage.setItem(STORAGE_KEY, 'true');
        }}
        className="absolute right-3 top-3 z-10 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="オンボーディングを閉じる"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
      {children}
    </div>
  );
}

export function OnboardingRestoreLink() {
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    setDismissed(localStorage.getItem(STORAGE_KEY) === 'true');
  }, []);

  if (!dismissed) return null;

  return (
    <Button
      variant="link"
      size="sm"
      className="h-auto px-0 py-0 text-xs text-muted-foreground hover:text-foreground"
      onClick={() => {
        localStorage.removeItem(STORAGE_KEY);
        setDismissed(false);
      }}
    >
      オンボーディングを表示
    </Button>
  );
}
