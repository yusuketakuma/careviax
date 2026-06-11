// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  COGNITO_CHALLENGE_STORAGE_KEY,
  type CognitoChallengePayload,
} from '@/lib/auth/cognito-challenge';
import { useSafeCallbackUrl, useStoredCognitoChallenge } from './browser-auth-state';

const challengeLabels = {
  missing: 'missing',
  malformed: 'malformed',
  invalid: 'invalid',
};

function setSearch(search: string) {
  window.history.replaceState(null, '', `/${search}`);
}

function setStoredChallenge(payload: CognitoChallengePayload | string | null) {
  if (payload === null) {
    window.sessionStorage.removeItem(COGNITO_CHALLENGE_STORAGE_KEY);
    return;
  }

  window.sessionStorage.setItem(
    COGNITO_CHALLENGE_STORAGE_KEY,
    typeof payload === 'string' ? payload : JSON.stringify(payload),
  );
}

afterEach(() => {
  setSearch('');
  window.sessionStorage.clear();
});

describe('useSafeCallbackUrl', () => {
  it('returns a relative callback URL from the current location', () => {
    setSearch('?callbackUrl=%2Fpatients%2Fpatient-1');

    const { result } = renderHook(() => useSafeCallbackUrl());

    expect(result.current).toBe('/patients/patient-1');
  });

  it('rejects non-relative callback URLs', () => {
    setSearch('?callbackUrl=https%3A%2F%2Fexample.com%2Fphish');

    const { result } = renderHook(() => useSafeCallbackUrl());

    expect(result.current).toBe('/dashboard');
  });
});

describe('useStoredCognitoChallenge', () => {
  it('returns the stored Cognito challenge when the type matches', () => {
    setStoredChallenge({
      type: 'SOFTWARE_TOKEN_MFA',
      email: 'user@example.com',
      session: 'session-1',
    });

    const { result } = renderHook(() =>
      useStoredCognitoChallenge('SOFTWARE_TOKEN_MFA', challengeLabels),
    );

    expect(result.current).toEqual({
      pending: false,
      challenge: {
        type: 'SOFTWARE_TOKEN_MFA',
        email: 'user@example.com',
        session: 'session-1',
      },
      error: null,
    });
  });

  it('returns typed errors for missing, malformed, and mismatched challenges', () => {
    const missing = renderHook(() =>
      useStoredCognitoChallenge('NEW_PASSWORD_REQUIRED', challengeLabels),
    );
    expect(missing.result.current.error).toBe('missing');

    setStoredChallenge('not-json');
    const malformed = renderHook(() =>
      useStoredCognitoChallenge('NEW_PASSWORD_REQUIRED', challengeLabels),
    );
    expect(malformed.result.current.error).toBe('malformed');

    setStoredChallenge({
      type: 'SOFTWARE_TOKEN_MFA',
      email: 'user@example.com',
      session: 'session-1',
    });
    const invalid = renderHook(() =>
      useStoredCognitoChallenge('NEW_PASSWORD_REQUIRED', challengeLabels),
    );
    expect(invalid.result.current.error).toBe('invalid');
  });
});
