import { afterEach, describe, expect, it } from 'vitest';
import {
  getAuthBaseUrl,
  getAuthSecret,
  LOCAL_FALLBACK_AUTH_SECRET,
  LOCAL_FALLBACK_AUTH_URL,
} from '../secret';

function setNodeEnv(value: string | undefined) {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) {
    delete env.NODE_ENV;
    return;
  }
  env.NODE_ENV = value;
}

describe('getAuthSecret', () => {
  const originalEnv = {
    allowLocalAuthFallback: process.env.ALLOW_LOCAL_AUTH_FALLBACK,
    authSecret: process.env.AUTH_SECRET,
    awsExecutionEnv: process.env.AWS_EXECUTION_ENV,
    nodeEnv: process.env.NODE_ENV,
    playwright: process.env.PLAYWRIGHT,
    nextAuthUrl: process.env.NEXTAUTH_URL,
    nextPublicAppUrl: process.env.NEXT_PUBLIC_APP_URL,
    nextAuthSecret: process.env.NEXTAUTH_SECRET,
    vercel: process.env.VERCEL,
  };

  afterEach(() => {
    process.env.ALLOW_LOCAL_AUTH_FALLBACK = originalEnv.allowLocalAuthFallback;
    process.env.AUTH_SECRET = originalEnv.authSecret;
    process.env.AWS_EXECUTION_ENV = originalEnv.awsExecutionEnv;
    setNodeEnv(originalEnv.nodeEnv);
    process.env.PLAYWRIGHT = originalEnv.playwright;
    process.env.NEXTAUTH_URL = originalEnv.nextAuthUrl;
    process.env.NEXT_PUBLIC_APP_URL = originalEnv.nextPublicAppUrl;
    process.env.NEXTAUTH_SECRET = originalEnv.nextAuthSecret;
    process.env.VERCEL = originalEnv.vercel;
  });

  it('prefers explicit env secrets', () => {
    process.env.NEXTAUTH_SECRET = 'nextauth-secret';
    process.env.AUTH_SECRET = 'auth-secret';

    expect(getAuthSecret()).toBe('nextauth-secret');
  });

  it('falls back to the local secret outside hosted runtimes', () => {
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.AUTH_SECRET;
    setNodeEnv('development');
    delete process.env.VERCEL;
    delete process.env.AWS_EXECUTION_ENV;

    expect(getAuthSecret()).toBe(LOCAL_FALLBACK_AUTH_SECRET);
  });

  it('returns undefined in production without an explicit secret', () => {
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.AUTH_SECRET;
    setNodeEnv('production');
    delete process.env.VERCEL;
    delete process.env.AWS_EXECUTION_ENV;

    expect(getAuthSecret()).toBeUndefined();
  });
});

describe('getAuthBaseUrl', () => {
  it('prefers NEXTAUTH_URL over NEXT_PUBLIC_APP_URL', () => {
    process.env.NEXTAUTH_URL = 'https://auth.example.com';
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';

    expect(getAuthBaseUrl()).toBe('https://auth.example.com');
  });

  it('falls back to the local app URL outside hosted runtimes', () => {
    delete process.env.NEXTAUTH_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    setNodeEnv('development');

    expect(getAuthBaseUrl()).toBe(LOCAL_FALLBACK_AUTH_URL);
  });

  it('returns undefined in production without an explicit URL', () => {
    delete process.env.NEXTAUTH_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    setNodeEnv('production');

    expect(getAuthBaseUrl()).toBeUndefined();
  });
});
