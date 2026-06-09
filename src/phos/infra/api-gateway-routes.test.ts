import { describe, expect, it } from 'vitest';
import { UserRole } from '@/phos/contracts/phos_contracts';
import { findPhosRoute, PHOS_API_ROUTES } from './api-gateway-routes';

const SPEC_ROUTE_KEYS = [
  'GET /cards',
  'GET /cards/{card_id}',
  'POST /cards/{card_id}/actions',
  'GET /capacity',
  'GET /claim-candidates',
  'POST /claim-candidates/{candidate_id}/exclude',
  'GET /fee-rules',
  'GET /visit-packets/{packet_id}/visit-mode',
  'POST /visit-packets/{packet_id}/visit-steps/{step}',
  'POST /evidence/presign-upload',
  'GET /handoffs',
  'POST /handoffs',
  'POST /handoffs/{handoff_id}/open',
  'POST /handoffs/{handoff_id}/resolve',
  'POST /handoffs/{handoff_id}/return',
  'GET /report-deliveries',
  'POST /report-deliveries/{delivery_id}/reply',
  'POST /report-deliveries/{delivery_id}/action-done',
] as const;

describe('PH-OS API Gateway route manifest', () => {
  it('contains every PH-OS v1.1 business API route from the spec', () => {
    expect(PHOS_API_ROUTES.map((route) => route.route_key).sort()).toEqual(
      [...SPEC_ROUTE_KEYS].sort(),
    );
  });

  it('marks implemented business APIs as Lambda handlers, not Next.js Route Handlers', () => {
    expect(PHOS_API_ROUTES.map((route) => route.route_key).sort()).toEqual(
      [...SPEC_ROUTE_KEYS].sort(),
    );

    for (const route of PHOS_API_ROUTES) {
      expect(route.lambda_handler).toMatch(/^@\/phos\/backend\//);
      expect(route.lambda_handler).toMatch(/-lambda#/);
      expect(route.lambda_handler).not.toContain('src/app/api');
      expect(route.lambda_handler).not.toContain('route.ts');
      expect(route.lambda_handler).not.toContain('-handlers#create');
      expect(route.required_scopes.length).toBeGreaterThan(0);
      expect(route.allowed_roles.length).toBeGreaterThan(0);
    }
  });

  it('points every route to an importable composed Lambda export', async () => {
    for (const route of PHOS_API_ROUTES) {
      const [modulePath, exportName] = route.lambda_handler.split('#');
      expect(modulePath).toBeTruthy();
      expect(exportName).toBeTruthy();
      const lambdaModule = await import(modulePath.replace('@/', '@/'));
      expect(lambdaModule[exportName as keyof typeof lambdaModule]).toEqual(expect.any(Function));
    }
  });

  it('points Cards and Evidence routes to composed Lambda exports', async () => {
    const searchRoute = findPhosRoute('GET /cards');
    const detailRoute = findPhosRoute('GET /cards/{card_id}');
    const actionRoute = findPhosRoute('POST /cards/{card_id}/actions');
    const evidenceRoute = findPhosRoute('POST /evidence/presign-upload');
    const cardsModule = await import('@/phos/backend/cards-lambda');
    const evidenceModule = await import('@/phos/backend/evidence-lambda');

    expect(searchRoute?.lambda_handler).toBe('@/phos/backend/cards-lambda#cardSearchHandler');
    expect(detailRoute?.lambda_handler).toBe('@/phos/backend/cards-lambda#cardDetailHandler');
    expect(actionRoute?.lambda_handler).toBe(
      '@/phos/backend/cards-lambda#executeCardActionHandler',
    );
    expect(evidenceRoute?.lambda_handler).toBe(
      '@/phos/backend/evidence-lambda#evidencePresignUploadHandler',
    );
    expect(cardsModule.cardSearchHandler).toEqual(expect.any(Function));
    expect(cardsModule.cardDetailHandler).toEqual(expect.any(Function));
    expect(cardsModule.executeCardActionHandler).toEqual(expect.any(Function));
    expect(evidenceModule.evidencePresignUploadHandler).toEqual(expect.any(Function));
  });

  it('keeps route-level RBAC policy explicit in the API Gateway manifest', () => {
    expect(findPhosRoute('GET /cards')).toMatchObject({
      required_scopes: ['phos/cards.read'],
      allowed_roles: [
        UserRole.PHARMACIST,
        UserRole.PHARMACY_CLERK,
        UserRole.MANAGER,
        UserRole.ADMIN,
      ],
    });
    expect(findPhosRoute('POST /cards/{card_id}/actions')).toMatchObject({
      required_scopes: ['phos/cards.write'],
      allowed_roles: Object.values(UserRole),
    });
    expect(findPhosRoute('GET /capacity')).toMatchObject({
      required_scopes: ['phos/capacity.read'],
      allowed_roles: [UserRole.MANAGER, UserRole.ADMIN],
    });
    expect(findPhosRoute('POST /handoffs')).toMatchObject({
      required_scopes: ['phos/handoffs.write'],
      allowed_roles: [UserRole.PHARMACY_CLERK, UserRole.MANAGER, UserRole.ADMIN],
    });
    expect(findPhosRoute('POST /handoffs/{handoff_id}/resolve')).toMatchObject({
      required_scopes: ['phos/handoffs.write'],
      allowed_roles: [UserRole.PHARMACIST, UserRole.MANAGER, UserRole.ADMIN],
    });
    expect(findPhosRoute('POST /report-deliveries/{delivery_id}/reply')).toMatchObject({
      required_scopes: ['phos/report-deliveries.write'],
      allowed_roles: [
        UserRole.PHARMACIST,
        UserRole.PHARMACY_CLERK,
        UserRole.MANAGER,
        UserRole.ADMIN,
      ],
    });
    expect(findPhosRoute('POST /report-deliveries/{delivery_id}/action-done')).toMatchObject({
      required_scopes: ['phos/report-deliveries.write'],
      allowed_roles: [UserRole.PHARMACIST, UserRole.MANAGER, UserRole.ADMIN],
    });
  });

  it('has no remaining planned PH-OS v1.1 API routes in the manifest', () => {
    expect(PHOS_API_ROUTES.every((route) => route.lambda_handler.length > 0)).toBe(true);
  });

  it('points Handoff routes to composed Lambda exports, not unbound handler factories', async () => {
    const handoffRoutes = PHOS_API_ROUTES.filter((route) => route.route_key.includes('/handoffs'));
    const lambdaModule = await import('@/phos/backend/handoffs-lambda');

    for (const route of handoffRoutes) {
      expect(route.lambda_handler).toMatch(/^@\/phos\/backend\/handoffs-lambda#/);
      expect(route.lambda_handler).not.toContain('handoffs-handlers#create');
      const exportName = route.lambda_handler.split('#')[1];
      expect(exportName).toBeTruthy();
      expect(lambdaModule[exportName as keyof typeof lambdaModule]).toEqual(expect.any(Function));
    }
  });

  it('points the Capacity route to a composed Lambda export', async () => {
    const route = findPhosRoute('GET /capacity');
    const lambdaModule = await import('@/phos/backend/capacity-lambda');

    expect(route?.lambda_handler).toBe('@/phos/backend/capacity-lambda#capacityHandler');
    const exportName = route?.lambda_handler.split('#')[1];
    expect(exportName).toBeTruthy();
    expect(lambdaModule[exportName as keyof typeof lambdaModule]).toEqual(expect.any(Function));
  });

  it('points VisitMode routes to composed Lambda exports', async () => {
    const getRoute = findPhosRoute('GET /visit-packets/{packet_id}/visit-mode');
    const postRoute = findPhosRoute('POST /visit-packets/{packet_id}/visit-steps/{step}');
    const lambdaModule = await import('@/phos/backend/visit-mode-lambda');

    expect(getRoute?.lambda_handler).toBe('@/phos/backend/visit-mode-lambda#getVisitModeHandler');
    expect(postRoute?.lambda_handler).toBe(
      '@/phos/backend/visit-mode-lambda#updateVisitStepHandler',
    );
    expect(lambdaModule.getVisitModeHandler).toEqual(expect.any(Function));
    expect(lambdaModule.updateVisitStepHandler).toEqual(expect.any(Function));
  });

  it('points ReportDelivery routes to composed Lambda exports', async () => {
    const route = findPhosRoute('GET /report-deliveries');
    const replyRoute = findPhosRoute('POST /report-deliveries/{delivery_id}/reply');
    const actionDoneRoute = findPhosRoute('POST /report-deliveries/{delivery_id}/action-done');
    const lambdaModule = await import('@/phos/backend/report-deliveries-lambda');

    expect(route?.lambda_handler).toBe(
      '@/phos/backend/report-deliveries-lambda#reportDeliverySearchHandler',
    );
    expect(route?.response_contract).toBe('ReportDeliverySearchResponse');
    expect(replyRoute).toMatchObject({
      lambda_handler: '@/phos/backend/report-deliveries-lambda#registerReportReplyHandler',
      requires_idempotency_key: true,
      requires_expected_version: true,
      response_contract: 'ReportDeliveryMutationResponse',
    });
    expect(actionDoneRoute).toMatchObject({
      lambda_handler: '@/phos/backend/report-deliveries-lambda#markReportActionDoneHandler',
      requires_idempotency_key: true,
      requires_expected_version: true,
      response_contract: 'ReportDeliveryMutationResponse',
    });
    expect(lambdaModule.reportDeliverySearchHandler).toEqual(expect.any(Function));
    expect(lambdaModule.registerReportReplyHandler).toEqual(expect.any(Function));
    expect(lambdaModule.markReportActionDoneHandler).toEqual(expect.any(Function));
  });

  it('points ClaimCandidate and FeeRule routes to composed Lambda exports', async () => {
    const searchRoute = findPhosRoute('GET /claim-candidates');
    const excludeRoute = findPhosRoute('POST /claim-candidates/{candidate_id}/exclude');
    const feeRoute = findPhosRoute('GET /fee-rules');
    const claimModule = await import('@/phos/backend/claim-candidates-lambda');
    const feeModule = await import('@/phos/backend/fee-rules-lambda');

    expect(searchRoute).toMatchObject({
      lambda_handler: '@/phos/backend/claim-candidates-lambda#claimCandidateSearchHandler',
      required_scopes: ['phos/claim-candidates.read'],
      response_contract: 'ClaimCandidateSearchResponse',
    });
    expect(excludeRoute).toMatchObject({
      lambda_handler: '@/phos/backend/claim-candidates-lambda#excludeClaimCandidateHandler',
      required_scopes: ['phos/claim-candidates.write'],
      requires_idempotency_key: true,
      requires_expected_version: true,
      response_contract: 'ClaimCandidateMutationResponse',
    });
    expect(feeRoute).toMatchObject({
      lambda_handler: '@/phos/backend/fee-rules-lambda#feeRuleSearchHandler',
      required_scopes: ['phos/fee-rules.read'],
      response_contract: 'FeeRuleSearchResponse',
    });
    expect(claimModule.claimCandidateSearchHandler).toEqual(expect.any(Function));
    expect(claimModule.excludeClaimCandidateHandler).toEqual(expect.any(Function));
    expect(feeModule.feeRuleSearchHandler).toEqual(expect.any(Function));
  });

  it('requires idempotency and expected version on mutating state endpoints', () => {
    expect(findPhosRoute('POST /cards/{card_id}/actions')).toMatchObject({
      requires_idempotency_key: true,
      requires_expected_version: true,
      response_contract: 'ActionResponse',
    });
    expect(findPhosRoute('POST /visit-packets/{packet_id}/visit-steps/{step}')).toMatchObject({
      requires_idempotency_key: true,
      requires_expected_version: true,
    });
    expect(findPhosRoute('GET /capacity')).toMatchObject({
      requires_idempotency_key: false,
      requires_expected_version: false,
      response_contract: 'CapacityResponse',
    });
    expect(findPhosRoute('POST /claim-candidates/{candidate_id}/exclude')).toMatchObject({
      requires_idempotency_key: true,
      requires_expected_version: true,
      response_contract: 'ClaimCandidateMutationResponse',
    });
    expect(findPhosRoute('POST /handoffs')).toMatchObject({
      requires_idempotency_key: true,
      requires_expected_version: true,
    });
    expect(findPhosRoute('POST /handoffs/{handoff_id}/resolve')).toMatchObject({
      requires_idempotency_key: true,
      requires_expected_version: true,
    });
    expect(findPhosRoute('POST /handoffs/{handoff_id}/open')).toMatchObject({
      requires_idempotency_key: true,
      requires_expected_version: true,
    });
    expect(findPhosRoute('POST /handoffs/{handoff_id}/return')).toMatchObject({
      requires_idempotency_key: true,
      requires_expected_version: true,
    });
    expect(findPhosRoute('POST /report-deliveries/{delivery_id}/reply')).toMatchObject({
      requires_idempotency_key: true,
      requires_expected_version: true,
    });
    expect(findPhosRoute('POST /report-deliveries/{delivery_id}/action-done')).toMatchObject({
      requires_idempotency_key: true,
      requires_expected_version: true,
    });
  });

  it('requires replay-safe idempotency but not expected version for presign-only uploads', () => {
    expect(findPhosRoute('POST /evidence/presign-upload')).toMatchObject({
      requires_idempotency_key: true,
      requires_expected_version: false,
      response_contract: 'EvidencePresignUploadResponse',
    });
  });
});
