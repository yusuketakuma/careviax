import { encode } from 'next-auth/jwt';
import type { BrowserContext, Page } from '@playwright/test';
import { Client } from 'pg';

export const AUTH_SECRET = 'ph-os-local-auth-secret';
const DB_CONNECTION_STRING = (
  process.env.DATABASE_URL ?? 'postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public'
).replace(/\?.*$/, '');
const NOTIFICATION_STREAM_PATH = '/api/notifications/stream';
let cachedLocalUserId: string | null = null;

export const LOCAL_USER = {
  email: 'demo@ph-os.example.com',
  name: '山田 太郎',
  cognitoSub: 'demo-cognito-sub-001',
  sessionVersion: 0,
};

function assertSafeE2eDatabase() {
  if (process.env.PLAYWRIGHT !== '1' && process.env.PLAYWRIGHT_REUSE_SERVER !== '1') {
    throw new Error('Playwright local auth requires PLAYWRIGHT=1 or PLAYWRIGHT_REUSE_SERVER=1');
  }

  const url = new URL(DB_CONNECTION_STRING);
  const databaseName = url.pathname.replace(/^\//, '');
  const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (!isLocalHost || databaseName !== 'ph_os_e2e') {
    throw new Error('Playwright local auth requires a local ph_os_e2e DATABASE_URL');
  }
}

export function shouldIgnoreConsoleError(message: string) {
  const normalized = message.trim();

  if (
    /inline style violates the following Content Security Policy/i.test(normalized) ||
    /Content Security Policy directive 'style-src/i.test(normalized)
  ) {
    return true;
  }

  const ignoredMessages = [
    'Failed to load resource: the server responded with a status of 429 (Too Many Requests)',
    'Failed to load resource: net::ERR_',
    "Can't perform a React state update on a component that hasn't mounted yet.",
  ];

  return ignoredMessages.some((fragment) => normalized.includes(fragment));
}

export function shouldIgnorePageError(message: string) {
  const normalized = message.trim();

  const ignoredMessages = [
    'Internal Next.js error: Router action dispatched before initialization.',
    'Unexpected end of input',
    'Invalid or unexpected token',
    'Manifest file is empty',
  ];

  return ignoredMessages.includes(normalized);
}

async function resolveLocalUserId() {
  if (cachedLocalUserId) {
    return cachedLocalUserId;
  }

  assertSafeE2eDatabase();

  const client = new Client({ connectionString: DB_CONNECTION_STRING });
  await client.connect();

  try {
    const result = await client.query<{ id: string }>(
      `
        SELECT id
        FROM "User"
        WHERE cognito_sub = $1 OR lower(email) = lower($2)
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [LOCAL_USER.cognitoSub, LOCAL_USER.email],
    );

    const userId = result.rows[0]?.id;
    if (!userId) {
      throw new Error('Playwright local auth user could not be resolved from the database');
    }

    cachedLocalUserId = userId;
    return userId;
  } finally {
    await client.end();
  }
}

export async function createSessionToken() {
  const userId = await resolveLocalUserId();

  return encode({
    secret: AUTH_SECRET,
    token: {
      userId,
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
  await page.waitForLoadState('domcontentloaded', { timeout: 45_000 }).catch(() => null);
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => null);
  await page
    .getByText(/Compiling|Rendering/)
    .waitFor({ state: 'detached', timeout: 45_000 })
    .catch(() => null);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableDevNavigationError(message: string) {
  return /net::ERR_ABORTED|frame was detached|net::ERR_EMPTY_RESPONSE|net::ERR_CONNECTION_RESET|net::ERR_CONNECTION_REFUSED|page\.goto: Test timeout|page\.goto: Timeout|page\.reload: Timeout/i.test(
    message,
  );
}

function currentUrlMatchesTarget(page: Page, targetUrl: Parameters<Page['waitForURL']>[0]) {
  const currentUrl = page.url();

  if (targetUrl instanceof RegExp) {
    return targetUrl.test(currentUrl);
  }

  const parsedUrl = new URL(currentUrl);

  if (typeof targetUrl === 'function') {
    return targetUrl(parsedUrl);
  }

  const currentPath = `${parsedUrl.pathname}${parsedUrl.search}`;
  return targetUrl === currentUrl || targetUrl === currentPath;
}

async function waitForCurrentUrlTarget(
  page: Page,
  targetUrl: Parameters<Page['waitForURL']>[0],
  timeout: number,
) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    if (currentUrlMatchesTarget(page, targetUrl)) {
      return;
    }
    await delay(100);
  }

  throw new Error(`Timed out waiting for current URL to match ${String(targetUrl)}`);
}

export async function openStableRoute(page: Page, path: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 90_000 });
      await waitForStableUi(page);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const currentUrl = new URL(page.url());
      const currentPath = `${currentUrl.pathname}${currentUrl.search}`;

      if (!isRetriableDevNavigationError(message)) {
        throw error;
      }

      if (currentPath === path) {
        await waitForStableUi(page);
        return;
      }

      if (attempt === 2) {
        throw error;
      }

      await delay(
        /ERR_CONNECTION|ERR_EMPTY_RESPONSE|ERR_CONNECTION_RESET/i.test(message) ? 1_000 : 250,
      );
    }
  }
}

export async function reloadStablePage(page: Page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 90_000 });
      await waitForStableUi(page);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === 2 || !isRetriableDevNavigationError(message)) {
        throw error;
      }
      await delay(
        /ERR_CONNECTION|ERR_EMPTY_RESPONSE|ERR_CONNECTION_RESET/i.test(message) ? 1_000 : 250,
      );
    }
  }
}

export async function clickAndWaitForStableRoute(
  page: Page,
  targetUrl: Parameters<Page['waitForURL']>[0],
  clickAction: () => Promise<unknown>,
  options: { timeout?: number } = {},
) {
  const timeout = options.timeout ?? 90_000;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let clickError: unknown = null;
    const clickPromise = clickAction().catch((error: unknown) => {
      clickError = error;
    });
    const waitResult = await Promise.any([
      page.waitForURL(targetUrl, {
        timeout,
        waitUntil: 'domcontentloaded',
      }),
      waitForCurrentUrlTarget(page, targetUrl, timeout),
    ])
      .then(() => null)
      .catch((error: unknown) => error);
    await Promise.race([clickPromise, delay(1_000)]);

    if (!waitResult || currentUrlMatchesTarget(page, targetUrl)) {
      await waitForStableUi(page);
      return;
    }

    if (clickError) {
      throw clickError;
    }

    if (
      attempt === 2 ||
      !(waitResult instanceof Error) ||
      (!/timeout/i.test(waitResult.message) && !isRetriableDevNavigationError(waitResult.message))
    ) {
      throw waitResult;
    }

    await delay(isRetriableDevNavigationError(waitResult.message) ? 1_000 : 250);
  }
}

export async function createInstrumentedPage(
  context: BrowserContext,
  options: { captureHttpErrors?: boolean } = {},
) {
  const page = await context.newPage();
  const errors: string[] = [];
  const captureHttpErrors = options.captureHttpErrors ?? true;

  page.on('console', (message) => {
    if (message.type() === 'error' && !shouldIgnoreConsoleError(message.text())) {
      errors.push(`console:${message.text()}`);
    }
  });

  page.on('pageerror', (error) => {
    if (!shouldIgnorePageError(error.message)) {
      errors.push(`pageerror:${error.message}`);
    }
  });

  if (captureHttpErrors) {
    page.on('response', (response) => {
      if (response.url().includes(NOTIFICATION_STREAM_PATH)) {
        return;
      }
      if (response.status() >= 400) {
        errors.push(`http:${response.status()} ${response.url()}`);
      }
    });
  }

  return { page, errors };
}
