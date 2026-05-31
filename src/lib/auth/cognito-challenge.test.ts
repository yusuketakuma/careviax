import { describe, expect, it } from 'vitest';
import {
  decodeCognitoChallenge,
  encodeCognitoChallenge,
  readStoredCognitoChallenge,
} from './cognito-challenge';

describe('cognito challenge payload decoding', () => {
  it('round-trips encoded credential challenge errors', () => {
    const encoded = encodeCognitoChallenge({
      type: 'SOFTWARE_TOKEN_MFA',
      email: 'pharmacist@example.com',
      session: 'session-token',
    });

    expect(decodeCognitoChallenge(encoded)).toEqual({
      type: 'SOFTWARE_TOKEN_MFA',
      email: 'pharmacist@example.com',
      session: 'session-token',
    });
  });

  it('rejects malformed encoded and stored challenge payloads', () => {
    expect(decodeCognitoChallenge('COGNITO_CHALLENGE:not-json')).toBeNull();
    expect(readStoredCognitoChallenge('not-json')).toBeNull();
    expect(readStoredCognitoChallenge(JSON.stringify(['unexpected']))).toBeNull();
    expect(
      readStoredCognitoChallenge(
        JSON.stringify({
          type: 'SOFTWARE_TOKEN_MFA',
          email: 'pharmacist@example.com',
          session: 123,
        }),
      ),
    ).toBeNull();
  });

  it('reads valid stored challenge payloads', () => {
    expect(
      readStoredCognitoChallenge(
        JSON.stringify({
          type: 'NEW_PASSWORD_REQUIRED',
          email: 'pharmacist@example.com',
          session: 'new-password-session',
          extra: 'ignored',
        }),
      ),
    ).toEqual({
      type: 'NEW_PASSWORD_REQUIRED',
      email: 'pharmacist@example.com',
      session: 'new-password-session',
    });
  });
});
