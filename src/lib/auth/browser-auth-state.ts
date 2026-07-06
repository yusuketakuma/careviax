'use client';

import { useMemo, useSyncExternalStore } from 'react';
import {
  COGNITO_CHALLENGE_STORAGE_KEY,
  readStoredCognitoChallenge,
  type CognitoChallengePayload,
} from '@/lib/auth/cognito-challenge';

const PENDING_BROWSER_SNAPSHOT = '__PHOS_PENDING_BROWSER_SNAPSHOT__';
const DEFAULT_CALLBACK_URL = '/dashboard';
const CALLBACK_URL_BASE = 'https://ph-os.local';

type CognitoChallengeType = CognitoChallengePayload['type'];

type StoredCognitoChallengeState = {
  pending: boolean;
  challenge: CognitoChallengePayload | null;
  error: string | null;
};

function subscribeBrowserSnapshot(onStoreChange: () => void) {
  if (typeof window === 'undefined') return () => {};

  window.addEventListener('storage', onStoreChange);
  window.addEventListener('popstate', onStoreChange);
  window.addEventListener('hashchange', onStoreChange);

  return () => {
    window.removeEventListener('storage', onStoreChange);
    window.removeEventListener('popstate', onStoreChange);
    window.removeEventListener('hashchange', onStoreChange);
  };
}

function getServerBrowserSnapshot() {
  return PENDING_BROWSER_SNAPSHOT;
}

function getLocationSearchSnapshot() {
  return typeof window === 'undefined' ? PENDING_BROWSER_SNAPSHOT : window.location.search;
}

function getStoredChallengeSnapshot() {
  if (typeof window === 'undefined') return PENDING_BROWSER_SNAPSHOT;
  return window.sessionStorage.getItem(COGNITO_CHALLENGE_STORAGE_KEY) ?? '';
}

export function sanitizeLocalCallbackUrl(
  rawCallbackUrl: string | null,
  fallback = DEFAULT_CALLBACK_URL,
) {
  if (!rawCallbackUrl || !rawCallbackUrl.startsWith('/') || rawCallbackUrl.includes('\\')) {
    return fallback;
  }

  try {
    const parsed = new URL(rawCallbackUrl, CALLBACK_URL_BASE);
    if (parsed.origin !== CALLBACK_URL_BASE) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

function safeCallbackUrlFromSearch(search: string, fallback = DEFAULT_CALLBACK_URL) {
  const rawCallbackUrl = new URLSearchParams(search).get('callbackUrl') ?? fallback;
  return sanitizeLocalCallbackUrl(rawCallbackUrl, fallback);
}

export function useSafeCallbackUrl(fallback = DEFAULT_CALLBACK_URL) {
  const search = useSyncExternalStore(
    subscribeBrowserSnapshot,
    getLocationSearchSnapshot,
    getServerBrowserSnapshot,
  );

  return useMemo(() => {
    if (search === PENDING_BROWSER_SNAPSHOT) return fallback;
    return safeCallbackUrlFromSearch(search, fallback);
  }, [fallback, search]);
}

export function useStoredCognitoChallenge(
  expectedType: CognitoChallengeType,
  labels: {
    missing: string;
    malformed: string;
    invalid: string;
  },
): StoredCognitoChallengeState {
  const rawChallenge = useSyncExternalStore(
    subscribeBrowserSnapshot,
    getStoredChallengeSnapshot,
    getServerBrowserSnapshot,
  );

  return useMemo(() => {
    if (rawChallenge === PENDING_BROWSER_SNAPSHOT) {
      return { pending: true, challenge: null, error: null };
    }

    if (!rawChallenge) {
      return { pending: false, challenge: null, error: labels.missing };
    }

    const parsed = readStoredCognitoChallenge(rawChallenge);
    if (!parsed) {
      return { pending: false, challenge: null, error: labels.malformed };
    }

    if (parsed.type !== expectedType) {
      return { pending: false, challenge: null, error: labels.invalid };
    }

    return { pending: false, challenge: parsed, error: null };
  }, [expectedType, labels.invalid, labels.malformed, labels.missing, rawChallenge]);
}
