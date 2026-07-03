import { describe, it } from 'vitest';
import { expectNoStore, expectSensitiveNoStore } from './api-response-assertions';

describe('api response assertions', () => {
  it('accepts sensitive no-store responses', () => {
    const response = new Response(null, {
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
        Pragma: 'no-cache',
      },
    });

    expectSensitiveNoStore(response);
  });

  it('keeps expectNoStore as an alias for sensitive no-store responses', () => {
    const response = new Response(null, {
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
        Pragma: 'no-cache',
      },
    });

    expectNoStore(response);
  });
});
