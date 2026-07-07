const KIB = 1024;

export type PayloadBudgetStatus = 'unconfigured' | 'unmeasured' | 'within_budget' | 'over_budget';

export type PayloadBudgetDefinition = {
  method: string;
  route: string;
  family: string;
  budget_bytes: number | null;
};

export function routeMetricsKey(method: string, route: string): string {
  return `${method.toUpperCase()} ${route}`;
}

function routeMetricsKeys(method: string, route: string): string[] {
  return [routeMetricsKey(method, route), routeMetricsKey('*', route)];
}

export const CRITICAL_ROUTE_PAYLOAD_BUDGETS: PayloadBudgetDefinition[] = [
  {
    method: 'GET',
    route: '/api/dashboard/cockpit/summary',
    family: 'dashboard-summary',
    budget_bytes: 50 * KIB,
  },
  {
    method: 'GET',
    route: '/api/dashboard/cockpit/details',
    family: 'dashboard-details',
    budget_bytes: 300 * KIB,
  },
  {
    method: 'GET',
    route: '/api/dashboard/cockpit/team',
    family: 'dashboard-team',
    budget_bytes: 120 * KIB,
  },
  {
    method: 'GET',
    route: '/api/dashboard/cockpit/comments',
    family: 'dashboard-comments',
    budget_bytes: 80 * KIB,
  },
  {
    method: 'GET',
    route: '/api/dashboard/cockpit/inbound',
    family: 'dashboard-inbound',
    budget_bytes: 160 * KIB,
  },
  {
    method: 'GET',
    route: '/api/dashboard/cockpit/stock-risks',
    family: 'dashboard-stock-risks',
    budget_bytes: 160 * KIB,
  },
  {
    method: 'GET',
    route: '/api/dashboard/cockpit/report-billing',
    family: 'dashboard-report-billing',
    budget_bytes: 160 * KIB,
  },
  {
    method: 'GET',
    route: '/api/patients/board',
    family: 'patients-board',
    budget_bytes: 300 * KIB,
  },
  {
    method: 'GET',
    route: '/api/patients/:id/overview',
    family: 'patient-detail-initial',
    budget_bytes: 250 * KIB,
  },
  {
    method: 'GET',
    route: '/api/patients/:id/timeline',
    family: 'patient-movement-timeline-list',
    budget_bytes: 250 * KIB,
  },
  {
    method: 'GET',
    route: '/api/care-reports/today-workspace',
    family: 'reports-today-workspace',
    budget_bytes: 250 * KIB,
  },
  {
    method: 'GET',
    route: '/api/care-reports',
    family: 'care-reports-list-search',
    budget_bytes: 250 * KIB,
  },
  {
    method: 'GET',
    route: '/api/visits/today-preparation',
    family: 'visit-preparation',
    budget_bytes: 200 * KIB,
  },
  {
    method: '*',
    route: '/api/billing*',
    family: 'billing',
    budget_bytes: null,
  },
  {
    method: '*',
    route: '/api/tasks',
    family: 'tasks',
    budget_bytes: null,
  },
  {
    method: '*',
    route: '/api/notifications',
    family: 'notifications',
    budget_bytes: null,
  },
];

const EXACT_ROUTE_PAYLOAD_BUDGETS = new Map(
  CRITICAL_ROUTE_PAYLOAD_BUDGETS.filter((definition) => !definition.route.endsWith('*')).map(
    (definition) => [routeMetricsKey(definition.method, definition.route), definition],
  ),
);

function isDynamicRouteSegment(segment: string): boolean {
  if (/^\d+$/.test(segment)) return true;
  if (/^[0-9a-f]{24}$/i.test(segment)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(segment)) {
    return true;
  }
  if (/^[a-z]{1,16}_[a-z0-9][a-z0-9_-]*$/i.test(segment)) return true;
  if (/^c[a-z0-9]{8,}$/i.test(segment)) return true;
  return segment.length >= 8 && /\d/.test(segment) && /^[a-z0-9_-]+$/i.test(segment);
}

function pathnameOnly(route: string): string {
  try {
    return new URL(route).pathname || '/';
  } catch {
    return route.split(/[?#]/, 1)[0] || '/';
  }
}

export function normalizeRoutePath(route: string): string {
  const pathname = pathnameOnly(route);
  const normalizedPathname = pathname
    .split('/')
    .map((segment) => {
      if (!segment) return segment;
      return isDynamicRouteSegment(segment) ? ':id' : segment;
    })
    .join('/');

  return normalizedPathname || '/';
}

export function resolveRoutePayloadBudget(
  method: string,
  route: string,
): PayloadBudgetDefinition | null {
  const normalizedRoute = normalizeRoutePath(route);
  for (const key of routeMetricsKeys(method, normalizedRoute)) {
    const exact = EXACT_ROUTE_PAYLOAD_BUDGETS.get(key);
    if (exact) return exact;
  }

  return (
    CRITICAL_ROUTE_PAYLOAD_BUDGETS.find((definition) => {
      if (!definition.route.endsWith('*')) return false;
      if (definition.method !== '*' && definition.method !== method.toUpperCase()) return false;
      return normalizedRoute.startsWith(definition.route.slice(0, -1));
    }) ?? null
  );
}

export function payloadBudgetStatus(
  budgetBytes: number | null,
  p95PayloadBytes: number | null,
): PayloadBudgetStatus {
  if (budgetBytes == null) return 'unconfigured';
  if (p95PayloadBytes == null) return 'unmeasured';
  return p95PayloadBytes <= budgetBytes ? 'within_budget' : 'over_budget';
}
