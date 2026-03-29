import { describe, expect, it, vi } from 'vitest';

const { authHandlerMock } = vi.hoisted(() => ({
  authHandlerMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  authHandler: authHandlerMock,
}));

import { GET, POST } from './route';

describe('/api/auth/[...nextauth]', () => {
  it('re-exports authHandler for GET and POST', () => {
    expect(GET).toBe(authHandlerMock);
    expect(POST).toBe(authHandlerMock);
  });
});
