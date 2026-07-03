import { vi } from 'vitest';

export type JsonResponseInit = ResponseInit | number;

function normalizeResponseInit(init: JsonResponseInit = {}): ResponseInit {
  if (typeof init === 'number') {
    return { status: init };
  }
  return init;
}

export function jsonResponse(body: unknown, init: JsonResponseInit = {}) {
  const responseInit = normalizeResponseInit(init);
  const headers = new Headers(responseInit.headers);
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return new Response(JSON.stringify(body), {
    ...responseInit,
    headers,
  });
}

export function createJsonFetchMock(body: unknown, init: JsonResponseInit = {}) {
  return vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body, init));
}

export function stubJsonFetch(body: unknown, init: JsonResponseInit = {}) {
  const fetchMock = createJsonFetchMock(body, init);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
