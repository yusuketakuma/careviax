import { z } from 'zod';

const countSchema = z.number().finite().int().nonnegative();
const positiveCountSchema = z.number().finite().int().positive();
const metricSchema = z.number().finite().nonnegative();
const optionalMetricSchema = metricSchema.nullable();
const rateSchema = z.number().finite().min(0).max(100);

const runtimeRouteBaseSchema = z
  .object({
    route: z.string().trim().min(1).max(500).regex(/^\//),
    method: z
      .string()
      .trim()
      .min(1)
      .max(20)
      .regex(/^[A-Z]+$/),
    org_scope: z.enum(['with_org', 'without_org', 'mixed']),
    critical_route: z.boolean(),
    critical_route_family: z.string().trim().min(1).max(100).nullable(),
    request_count: positiveCountSchema,
    error_count: countSchema,
    slow_count: countSchema,
    slow_rate: rateSchema,
    average_ms: metricSchema,
    p50_ms: metricSchema,
    p95_ms: metricSchema,
    p99_ms: metricSchema,
    max_ms: metricSchema,
    payload_sample_count: countSchema,
    average_payload_bytes: optionalMetricSchema,
    p95_payload_bytes: optionalMetricSchema,
    max_payload_bytes: optionalMetricSchema,
    query_count_sample_count: countSchema,
    average_query_count: optionalMetricSchema,
    p95_query_count: optionalMetricSchema,
    max_query_count: optionalMetricSchema,
    payload_budget_bytes: optionalMetricSchema,
    payload_budget_status: z.enum(['unconfigured', 'unmeasured', 'within_budget', 'over_budget']),
    payload_budget_met: z.boolean().nullable(),
    payload_budget_over_count: countSchema,
    last_seen_at: z.string().datetime({ offset: true }).nullable(),
    last_status: z.number().int().min(100).max(599).nullable(),
    last_payload_bytes: optionalMetricSchema,
    target_met: z.boolean(),
  })
  .strip();

type RuntimeRoute = z.infer<typeof runtimeRouteBaseSchema>;

const runtimeRouteSchema = runtimeRouteBaseSchema.superRefine((route, context) => {
  const issue = (path: string, message: string) =>
    context.addIssue({ code: 'custom', path: [path], message });

  if (route.error_count > route.request_count) issue('error_count', 'Errors exceed requests');
  if (route.slow_count > route.request_count) issue('slow_count', 'Slow requests exceed requests');
  const expectedSlowRate = Number(((route.slow_count / route.request_count) * 100).toFixed(1));
  if (route.slow_rate !== expectedSlowRate)
    issue('slow_rate', 'Slow rate contradicts request counts');
  if (route.payload_sample_count > route.request_count) {
    issue('payload_sample_count', 'Payload samples exceed requests');
  }
  if (route.query_count_sample_count > route.request_count) {
    issue('query_count_sample_count', 'Query samples exceed requests');
  }
  if (route.payload_budget_over_count > route.payload_sample_count) {
    issue('payload_budget_over_count', 'Payload budget overruns exceed samples');
  }
  if (
    !(route.p50_ms <= route.p95_ms && route.p95_ms <= route.p99_ms && route.p99_ms <= route.max_ms)
  ) {
    issue('p95_ms', 'Latency percentiles must be ordered and bounded by max');
  }
  if (route.average_ms > route.max_ms) issue('average_ms', 'Average latency exceeds max');

  validateSampleMetrics(route, context, 'payload');
  validateSampleMetrics(route, context, 'query_count');

  if (route.critical_route !== (route.critical_route_family != null)) {
    issue('critical_route_family', 'Critical route and family must agree');
  }
  if (!route.critical_route && route.payload_budget_bytes != null) {
    issue('payload_budget_bytes', 'Non-critical routes cannot have a payload budget');
  }

  const budget = route.payload_budget_bytes;
  const measured = route.p95_payload_bytes;
  switch (route.payload_budget_status) {
    case 'unconfigured':
      if (
        budget != null ||
        route.payload_budget_met != null ||
        route.payload_budget_over_count !== 0
      ) {
        issue('payload_budget_status', 'Unconfigured budgets cannot report a budget result');
      }
      break;
    case 'unmeasured':
      if (
        budget == null ||
        measured != null ||
        route.payload_budget_met != null ||
        route.payload_budget_over_count !== 0
      ) {
        issue('payload_budget_status', 'Unmeasured budgets require a budget without measurements');
      }
      break;
    case 'within_budget':
      if (
        budget == null ||
        measured == null ||
        measured > budget ||
        route.payload_budget_met !== true ||
        route.payload_budget_over_count !== 0
      ) {
        issue('payload_budget_status', 'Within-budget status contradicts payload metrics');
      }
      break;
    case 'over_budget':
      if (
        budget == null ||
        measured == null ||
        measured <= budget ||
        route.payload_budget_met !== false ||
        route.payload_budget_over_count === 0
      ) {
        issue('payload_budget_status', 'Over-budget status contradicts payload metrics');
      }
      break;
  }
});

function validateSampleMetrics(
  route: RuntimeRoute,
  context: z.RefinementCtx,
  kind: 'payload' | 'query_count',
) {
  const count = kind === 'payload' ? route.payload_sample_count : route.query_count_sample_count;
  const average = kind === 'payload' ? route.average_payload_bytes : route.average_query_count;
  const p95 = kind === 'payload' ? route.p95_payload_bytes : route.p95_query_count;
  const max = kind === 'payload' ? route.max_payload_bytes : route.max_query_count;
  const path = kind === 'payload' ? 'p95_payload_bytes' : 'p95_query_count';
  const allNull = average == null && p95 == null && max == null;
  const allMeasured = average != null && p95 != null && max != null;

  if ((count === 0 && !allNull) || (count > 0 && !allMeasured)) {
    context.addIssue({
      code: 'custom',
      path: [path],
      message: `${kind} sample count and metrics must agree`,
    });
  }
  if (allMeasured && (average > max || p95 > max)) {
    context.addIssue({ code: 'custom', path: [path], message: `${kind} metrics exceed max` });
  }
}

export const performanceRuntimeResponseSchema = z
  .object({
    data: z
      .object({
        scope: z.literal('current-process'),
        target_ms: z.number().finite().positive(),
        collected_since: z.string().datetime({ offset: true }),
        summary: z
          .object({
            route_count: countSchema,
            total_requests: countSchema,
            slow_requests: countSchema,
            error_requests: countSchema,
            slow_request_rate: rateSchema,
            overall_p50_ms: metricSchema,
            overall_p95_ms: metricSchema,
            overall_p99_ms: metricSchema,
            overall_p95_payload_bytes: optionalMetricSchema,
            overall_p95_query_count: optionalMetricSchema,
            critical_routes: countSchema,
            payload_budgeted_routes: countSchema,
            routes_over_payload_budget: countSchema,
            routes_with_unconfigured_payload_budget: countSchema,
            routes_over_target: countSchema,
          })
          .strip(),
        routes: z.array(runtimeRouteSchema).max(6),
      })
      .strip(),
  })
  .strict()
  .superRefine(({ data }, context) => {
    const { summary } = data;
    const issue = (path: string[], message: string) =>
      context.addIssue({ code: 'custom', path: ['data', 'summary', ...path], message });

    if (summary.slow_requests > summary.total_requests)
      issue(['slow_requests'], 'Slow requests exceed total');
    if (summary.error_requests > summary.total_requests)
      issue(['error_requests'], 'Errors exceed total');
    const expectedSlowRate =
      summary.total_requests === 0
        ? 0
        : Number(((summary.slow_requests / summary.total_requests) * 100).toFixed(1));
    if (summary.slow_request_rate !== expectedSlowRate) {
      issue(['slow_request_rate'], 'Slow rate contradicts request counts');
    }
    if (
      !(
        summary.overall_p50_ms <= summary.overall_p95_ms &&
        summary.overall_p95_ms <= summary.overall_p99_ms
      )
    ) {
      issue(['overall_p95_ms'], 'Overall latency percentiles must be ordered');
    }
    for (const key of [
      'critical_routes',
      'payload_budgeted_routes',
      'routes_over_payload_budget',
      'routes_with_unconfigured_payload_budget',
      'routes_over_target',
    ] as const) {
      if (summary[key] > summary.route_count) issue([key], `${key} exceeds route count`);
    }
    if (summary.routes_over_payload_budget > summary.payload_budgeted_routes) {
      issue(['routes_over_payload_budget'], 'Over-budget routes exceed budgeted routes');
    }
    if (summary.payload_budgeted_routes > summary.critical_routes) {
      issue(['payload_budgeted_routes'], 'Budgeted routes exceed critical routes');
    }
    if (summary.routes_with_unconfigured_payload_budget > summary.critical_routes) {
      issue(
        ['routes_with_unconfigured_payload_budget'],
        'Unconfigured routes exceed critical routes',
      );
    }
    if (data.routes.length > summary.route_count) {
      issue(['route_count'], 'Displayed routes exceed the reported route count');
    }
    if (summary.route_count > summary.total_requests) {
      issue(['total_requests'], 'Route count exceeds total requests');
    }

    const identities = new Set<string>();
    for (const [index, route] of data.routes.entries()) {
      const identity = `${route.method} ${route.route}`;
      if (identities.has(identity)) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'routes', index, 'route'],
          message: 'Runtime route identities must be unique',
        });
      }
      identities.add(identity);
      if (route.target_met !== route.p95_ms <= data.target_ms) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'routes', index, 'target_met'],
          message: 'Latency target status contradicts P95 and target',
        });
      }
    }
  });

export type PerformanceRuntimeResponse = z.infer<typeof performanceRuntimeResponseSchema>;
