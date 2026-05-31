import type { Route } from '@playwright/test';

export type CapturedRouteRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
};

export function readRouteBody<T = unknown>(route: Route): T | null {
  try {
    return route.request().postDataJSON() as T;
  } catch {
    return null;
  }
}

export function captureRouteRequest(route: Route): CapturedRouteRequest {
  const request = route.request();
  return {
    method: request.method(),
    url: request.url(),
    headers: request.headers(),
    body: readRouteBody(route),
  };
}

export async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

export async function fulfillCsv(route: Route, body: string, filename: string) {
  await route.fulfill({
    status: 200,
    headers: {
      'content-type': 'text/csv;charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
    },
    body,
  });
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function apiPathPattern(pathname: string) {
  const normalizedPath = `/${pathname.replace(/^\/+|\/+$/g, '')}`;
  return new RegExp(`^(?:https?://[^/]+)?${escapeRegExp(normalizedPath)}/?(?:\\?.*)?$`);
}
