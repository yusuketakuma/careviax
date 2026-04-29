import { describe, expect, it } from 'vitest';
import { redactSharedUrl, sanitizeSentryBreadcrumb, sanitizeSentryEvent } from './sentry-redaction';

describe('Sentry redaction', () => {
  it('removes otp query params and redacts shared route tokens', () => {
    expect(redactSharedUrl('https://app.example/shared/token_123?otp=654321&utm=mail')).toBe(
      'https://app.example/shared/[redacted]?utm=mail',
    );
    expect(
      redactSharedUrl('/api/external-access/token_123/self-report?otp=654321&source=sms'),
    ).toBe('/api/external-access/[redacted]/self-report?source=sms');
  });

  it('redacts otp headers and nested body data without mutating the original event', () => {
    const event = {
      request: {
        url: 'https://app.example/api/external-access/token_123?otp=654321',
        headers: {
          'content-type': 'application/json',
          'x-otp': '654321',
        },
        data: {
          otp: '654321',
          nested: {
            body: '{"otp":"111222","note":"keep"}',
          },
        },
      },
    };

    const sanitized = sanitizeSentryEvent(event);

    expect(sanitized).toEqual({
      request: {
        url: 'https://app.example/api/external-access/[redacted]',
        headers: {
          'content-type': 'application/json',
          'x-otp': '[REDACTED]',
        },
        data: {
          otp: '[REDACTED]',
          nested: {
            body: '{"otp":"[REDACTED]","note":"keep"}',
          },
        },
      },
    });
    expect(event.request.headers['x-otp']).toBe('654321');
    expect(event.request.data.otp).toBe('654321');
  });

  it('redacts shared URLs and otp values from breadcrumb data', () => {
    const breadcrumb = sanitizeSentryBreadcrumb({
      category: 'fetch',
      message: 'POST /api/external-access/token_123/self-report?otp=654321',
      data: {
        url: '/shared/token_123?otp=654321',
        body: {
          otp: '654321',
        },
      },
    });

    expect(breadcrumb).toEqual({
      category: 'fetch',
      message: 'POST /api/external-access/[redacted]/self-report?otp=[REDACTED]',
      data: {
        url: '/shared/[redacted]',
        body: {
          otp: '[REDACTED]',
        },
      },
    });
  });
});
