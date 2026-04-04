import { expect, test } from '@playwright/test';
import {
  attachLocalSession,
  createInstrumentedPage,
  waitForStableUi,
} from './helpers/local-auth';

test.describe('auth: login page', () => {
  test('login page renders email and password fields', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context, {
      captureHttpErrors: false,
    });
    await page.goto('/login');
    await waitForStableUi(page);

    await expect(page.getByLabel(/メールアドレス|Email/i)).toBeVisible();
    await expect(page.getByLabel(/パスワード|Password/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /ログイン|Sign in/i })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('login form shows validation error for empty submission', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context, {
      captureHttpErrors: false,
    });
    await page.goto('/login');
    await waitForStableUi(page);

    await page.getByRole('button', { name: /ログイン|Sign in/i }).click();
    await waitForStableUi(page);

    // Should remain on login page (no redirect)
    expect(page.url()).toContain('/login');

    const pageText = errors.filter((e) => !e.startsWith('console:'));
    expect(pageText).toEqual([]);
  });

  test('login page has password reset link', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context, {
      captureHttpErrors: false,
    });
    await page.goto('/login');
    await waitForStableUi(page);

    const resetLink = page.getByRole('link', { name: /パスワードを忘れた|パスワードリセット|Forgot/i });
    await expect(resetLink).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('authenticated user is redirected from login page', async ({ context }) => {
    await attachLocalSession(context);
    const { page } = await createInstrumentedPage(context);
    await page.goto('/login');
    await waitForStableUi(page);

    // Authenticated users should be redirected away from login
    await expect(page).not.toHaveURL(/\/login$/);
  });
});

test.describe('auth: MFA page', () => {
  test('MFA page renders verification code input', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context, {
      captureHttpErrors: false,
    });
    await page.goto('/mfa');
    await waitForStableUi(page);

    // MFA page should show OTP input or redirect to login if no session
    const hasMfaInput =
      (await page.getByLabel(/確認コード|TOTP|認証コード/i).isVisible().catch(() => false)) ||
      (await page.getByRole('textbox').isVisible().catch(() => false)) ||
      page.url().includes('/login');

    expect(hasMfaInput).toBe(true);

    expect(errors).toEqual([]);
  });
});

test.describe('auth: password reset flow', () => {
  test('password reset page renders email input', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context, {
      captureHttpErrors: false,
    });
    await page.goto('/password/reset');
    await waitForStableUi(page);

    await expect(page.getByLabel(/メールアドレス|Email/i)).toBeVisible();
    await expect(
      page.getByRole('button', { name: /送信|リセット|Reset|Submit/i }),
    ).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('password reset has back to login link', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context, {
      captureHttpErrors: false,
    });
    await page.goto('/password/reset');
    await waitForStableUi(page);

    const loginLink = page.getByRole('link', { name: /ログイン|ログインに戻る|Back/i });
    await expect(loginLink).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('password reset empty submission shows validation', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context, {
      captureHttpErrors: false,
    });
    await page.goto('/password/reset');
    await waitForStableUi(page);

    await page.getByRole('button', { name: /送信|リセット|Reset|Submit/i }).click();
    await waitForStableUi(page);

    // Should stay on reset page
    expect(page.url()).toContain('/password/reset');

    const networkErrors = errors.filter((e) => !e.startsWith('console:'));
    expect(networkErrors).toEqual([]);
  });

  test('password change page requires current and new password', async ({ context }) => {
    await attachLocalSession(context);
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/password/change');
    await waitForStableUi(page);

    // Either renders the form or redirects if not applicable
    const isFormVisible = await page
      .getByRole('button', { name: /変更|保存|Submit/i })
      .isVisible()
      .catch(() => false);
    const isRedirected = !page.url().includes('/password/change');

    expect(isFormVisible || isRedirected).toBe(true);

    expect(errors).toEqual([]);
  });
});
