import { describe, expect, it } from 'vitest';
import { parseCognitoIdTokenPayload } from './cognito-auth';

function makeJwt(payload: unknown) {
  return [
    Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'signature',
  ].join('.');
}

describe('cognito-auth token parsing', () => {
  it('extracts supported string claims from the ID token payload', () => {
    expect(
      parseCognitoIdTokenPayload(
        makeJwt({
          sub: 'cognito-sub-1',
          email: 'USER@example.jp',
          name: '利用者 太郎',
          ignored: true,
        }),
      ),
    ).toEqual({
      sub: 'cognito-sub-1',
      email: 'USER@example.jp',
      name: '利用者 太郎',
    });
  });

  it('ignores malformed optional claim values', () => {
    expect(
      parseCognitoIdTokenPayload(
        makeJwt({
          sub: 123,
          email: ['user@example.jp'],
          name: null,
        }),
      ),
    ).toEqual({
      sub: undefined,
      email: undefined,
      name: undefined,
    });
  });

  it('rejects malformed, missing, and non-object payloads with the auth error code', () => {
    expect(() => parseCognitoIdTokenPayload('missing-payload')).toThrow('COGNITO_ID_TOKEN_INVALID');
    expect(() => parseCognitoIdTokenPayload('header.not-json.signature')).toThrow(
      'COGNITO_ID_TOKEN_INVALID',
    );
    expect(() => parseCognitoIdTokenPayload(makeJwt([]))).toThrow('COGNITO_ID_TOKEN_INVALID');
    expect(() => parseCognitoIdTokenPayload(makeJwt(null))).toThrow('COGNITO_ID_TOKEN_INVALID');
    expect(() => parseCognitoIdTokenPayload(makeJwt('payload'))).toThrow(
      'COGNITO_ID_TOKEN_INVALID',
    );
  });
});
