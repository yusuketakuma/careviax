import { encode } from 'next-auth/jwt';
import type { BrowserContext, Page } from '@playwright/test';

const AUTH_SECRET = 'careviax-local-auth-secret';

const LOCAL_USER = {
  id: 'cmnb3swgz0008wgq9gfpgjq6r',
  email: 'demo@careviax.example.com',
  name: '山田 太郎',
  cognitoSub: 'demo-cognito-sub-001',
  sessionVersion: 0,
};

export async function createSessionToken() {
  return encode({
    secret: AUTH_SECRET,
    token: {
      userId: LOCAL_USER.id,
      email: LOCAL_USER.email,
      name: LOCAL_USER.name,
      cognitoSub: LOCAL_USER.cognitoSub,
      sessionVersion: LOCAL_USER.sessionVersion,
      sub: LOCAL_USER.cognitoSub,
    },
    maxAge: 30 * 60,
  });
}

export async function attachLocalSession(context: BrowserContext) {
  const token = await createSessionToken();
  await context.addCookies([
    {
      name: 'next-auth.session-token',
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}

export async function waitForStableUi(page: Page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => null);
}

export async function createInstrumentedPage(
  context: BrowserContext,
  options: { captureHttpErrors?: boolean } = {}
) {
  const page = await context.newPage();
  const errors: string[] = [];
  const captureHttpErrors = options.captureHttpErrors ?? true;

  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(`console:${message.text()}`);
    }
  });

  page.on('pageerror', (error) => {
    errors.push(`pageerror:${error.message}`);
  });

  if (captureHttpErrors) {
    page.on('response', (response) => {
      if (response.status() >= 400) {
        errors.push(`http:${response.status()} ${response.url()}`);
      }
    });
  }

  return { page, errors };
}
