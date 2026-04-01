export function buildRequest(
  method: string,
  path: string,
  opts?: {
    body?: unknown;
    searchParams?: Record<string, string>;
    headers?: Record<string, string>;
  }
): Request {
  const url = new URL(path, 'http://localhost');
  if (opts?.searchParams) {
    for (const [k, v] of Object.entries(opts.searchParams)) {
      url.searchParams.set(k, v);
    }
  }
  const init: RequestInit = {
    method,
    headers: { 'content-type': 'application/json', ...opts?.headers },
  };
  if (opts?.body) init.body = JSON.stringify(opts.body);
  return new Request(url, init);
}
