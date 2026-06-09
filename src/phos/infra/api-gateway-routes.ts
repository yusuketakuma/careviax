import { UserRole, type UserRole as UserRoleType } from '@/phos/contracts/phos_contracts';

export type PhosApiRoute = {
  route_key: string;
  method: 'GET' | 'POST';
  path: string;
  lambda_handler: string;
  required_scopes: readonly string[];
  allowed_roles: readonly UserRoleType[];
  requires_idempotency_key: boolean;
  requires_expected_version: boolean;
  response_contract:
    | 'CardSearchResponse'
    | 'CardDetailResponse'
    | 'ActionResponse'
    | 'ClaimCandidateSearchResponse'
    | 'ClaimCandidateMutationResponse'
    | 'CapacityResponse'
    | 'EvidencePresignUploadResponse'
    | 'FeeRuleSearchResponse'
    | 'HandoffSearchResponse'
    | 'HandoffMutationResponse'
    | 'VisitModeView'
    | 'ReportDeliverySearchResponse'
    | 'ReportDeliveryMutationResponse';
};

export const PHOS_API_ROUTES = [
  {
    route_key: 'GET /cards',
    method: 'GET',
    path: '/cards',
    lambda_handler: '@/phos/backend/cards-lambda#cardSearchHandler',
    required_scopes: ['phos/cards.read'],
    allowed_roles: [UserRole.PHARMACIST, UserRole.PHARMACY_CLERK, UserRole.MANAGER, UserRole.ADMIN],
    requires_idempotency_key: false,
    requires_expected_version: false,
    response_contract: 'CardSearchResponse',
  },
  {
    route_key: 'GET /cards/{card_id}',
    method: 'GET',
    path: '/cards/{card_id}',
    lambda_handler: '@/phos/backend/cards-lambda#cardDetailHandler',
    required_scopes: ['phos/cards.read'],
    allowed_roles: [UserRole.PHARMACIST, UserRole.PHARMACY_CLERK, UserRole.MANAGER, UserRole.ADMIN],
    requires_idempotency_key: false,
    requires_expected_version: false,
    response_contract: 'CardDetailResponse',
  },
  {
    route_key: 'POST /cards/{card_id}/actions',
    method: 'POST',
    path: '/cards/{card_id}/actions',
    lambda_handler: '@/phos/backend/cards-lambda#executeCardActionHandler',
    required_scopes: ['phos/cards.write'],
    allowed_roles: Object.values(UserRole),
    requires_idempotency_key: true,
    requires_expected_version: true,
    response_contract: 'ActionResponse',
  },
  {
    route_key: 'GET /capacity',
    method: 'GET',
    path: '/capacity',
    lambda_handler: '@/phos/backend/capacity-lambda#capacityHandler',
    required_scopes: ['phos/capacity.read'],
    allowed_roles: [UserRole.MANAGER, UserRole.ADMIN],
    requires_idempotency_key: false,
    requires_expected_version: false,
    response_contract: 'CapacityResponse',
  },
  {
    route_key: 'GET /claim-candidates',
    method: 'GET',
    path: '/claim-candidates',
    lambda_handler: '@/phos/backend/claim-candidates-lambda#claimCandidateSearchHandler',
    required_scopes: ['phos/claim-candidates.read'],
    allowed_roles: [UserRole.PHARMACIST, UserRole.PHARMACY_CLERK, UserRole.MANAGER, UserRole.ADMIN],
    requires_idempotency_key: false,
    requires_expected_version: false,
    response_contract: 'ClaimCandidateSearchResponse',
  },
  {
    route_key: 'POST /claim-candidates/{candidate_id}/exclude',
    method: 'POST',
    path: '/claim-candidates/{candidate_id}/exclude',
    lambda_handler: '@/phos/backend/claim-candidates-lambda#excludeClaimCandidateHandler',
    required_scopes: ['phos/claim-candidates.write'],
    allowed_roles: [UserRole.PHARMACIST, UserRole.MANAGER, UserRole.ADMIN],
    requires_idempotency_key: true,
    requires_expected_version: true,
    response_contract: 'ClaimCandidateMutationResponse',
  },
  {
    route_key: 'GET /fee-rules',
    method: 'GET',
    path: '/fee-rules',
    lambda_handler: '@/phos/backend/fee-rules-lambda#feeRuleSearchHandler',
    required_scopes: ['phos/fee-rules.read'],
    allowed_roles: [UserRole.PHARMACIST, UserRole.PHARMACY_CLERK, UserRole.MANAGER, UserRole.ADMIN],
    requires_idempotency_key: false,
    requires_expected_version: false,
    response_contract: 'FeeRuleSearchResponse',
  },
  {
    route_key: 'GET /visit-packets/{packet_id}/visit-mode',
    method: 'GET',
    path: '/visit-packets/{packet_id}/visit-mode',
    lambda_handler: '@/phos/backend/visit-mode-lambda#getVisitModeHandler',
    required_scopes: ['phos/visit-mode.read'],
    allowed_roles: [
      UserRole.PHARMACIST,
      UserRole.DISPENSE_ASSISTANT,
      UserRole.MANAGER,
      UserRole.ADMIN,
    ],
    requires_idempotency_key: false,
    requires_expected_version: false,
    response_contract: 'VisitModeView',
  },
  {
    route_key: 'POST /visit-packets/{packet_id}/visit-steps/{step}',
    method: 'POST',
    path: '/visit-packets/{packet_id}/visit-steps/{step}',
    lambda_handler: '@/phos/backend/visit-mode-lambda#updateVisitStepHandler',
    required_scopes: ['phos/visit-mode.write'],
    allowed_roles: [
      UserRole.PHARMACIST,
      UserRole.DISPENSE_ASSISTANT,
      UserRole.MANAGER,
      UserRole.ADMIN,
    ],
    requires_idempotency_key: true,
    requires_expected_version: true,
    response_contract: 'VisitModeView',
  },
  {
    route_key: 'POST /evidence/presign-upload',
    method: 'POST',
    path: '/evidence/presign-upload',
    lambda_handler: '@/phos/backend/evidence-lambda#evidencePresignUploadHandler',
    required_scopes: ['phos/evidence.write'],
    allowed_roles: [UserRole.PHARMACIST, UserRole.PHARMACY_CLERK, UserRole.MANAGER, UserRole.ADMIN],
    requires_idempotency_key: true,
    requires_expected_version: false,
    response_contract: 'EvidencePresignUploadResponse',
  },
  {
    route_key: 'GET /handoffs',
    method: 'GET',
    path: '/handoffs',
    lambda_handler: '@/phos/backend/handoffs-lambda#handoffSearchHandler',
    required_scopes: ['phos/handoffs.read'],
    allowed_roles: [UserRole.PHARMACIST, UserRole.PHARMACY_CLERK, UserRole.MANAGER, UserRole.ADMIN],
    requires_idempotency_key: false,
    requires_expected_version: false,
    response_contract: 'HandoffSearchResponse',
  },
  {
    route_key: 'POST /handoffs',
    method: 'POST',
    path: '/handoffs',
    lambda_handler: '@/phos/backend/handoffs-lambda#createHandoffHandler',
    required_scopes: ['phos/handoffs.write'],
    allowed_roles: [UserRole.PHARMACY_CLERK, UserRole.MANAGER, UserRole.ADMIN],
    requires_idempotency_key: true,
    requires_expected_version: true,
    response_contract: 'HandoffMutationResponse',
  },
  {
    route_key: 'POST /handoffs/{handoff_id}/resolve',
    method: 'POST',
    path: '/handoffs/{handoff_id}/resolve',
    lambda_handler: '@/phos/backend/handoffs-lambda#resolveHandoffHandler',
    required_scopes: ['phos/handoffs.write'],
    allowed_roles: [UserRole.PHARMACIST, UserRole.MANAGER, UserRole.ADMIN],
    requires_idempotency_key: true,
    requires_expected_version: true,
    response_contract: 'HandoffMutationResponse',
  },
  {
    route_key: 'POST /handoffs/{handoff_id}/open',
    method: 'POST',
    path: '/handoffs/{handoff_id}/open',
    lambda_handler: '@/phos/backend/handoffs-lambda#openHandoffHandler',
    required_scopes: ['phos/handoffs.write'],
    allowed_roles: [UserRole.PHARMACIST, UserRole.MANAGER, UserRole.ADMIN],
    requires_idempotency_key: true,
    requires_expected_version: true,
    response_contract: 'HandoffMutationResponse',
  },
  {
    route_key: 'POST /handoffs/{handoff_id}/return',
    method: 'POST',
    path: '/handoffs/{handoff_id}/return',
    lambda_handler: '@/phos/backend/handoffs-lambda#returnHandoffHandler',
    required_scopes: ['phos/handoffs.write'],
    allowed_roles: [UserRole.PHARMACIST, UserRole.MANAGER, UserRole.ADMIN],
    requires_idempotency_key: true,
    requires_expected_version: true,
    response_contract: 'HandoffMutationResponse',
  },
  {
    route_key: 'GET /report-deliveries',
    method: 'GET',
    path: '/report-deliveries',
    lambda_handler: '@/phos/backend/report-deliveries-lambda#reportDeliverySearchHandler',
    required_scopes: ['phos/report-deliveries.read'],
    allowed_roles: [UserRole.PHARMACIST, UserRole.PHARMACY_CLERK, UserRole.MANAGER, UserRole.ADMIN],
    requires_idempotency_key: false,
    requires_expected_version: false,
    response_contract: 'ReportDeliverySearchResponse',
  },
  {
    route_key: 'POST /report-deliveries/{delivery_id}/reply',
    method: 'POST',
    path: '/report-deliveries/{delivery_id}/reply',
    lambda_handler: '@/phos/backend/report-deliveries-lambda#registerReportReplyHandler',
    required_scopes: ['phos/report-deliveries.write'],
    allowed_roles: [UserRole.PHARMACIST, UserRole.PHARMACY_CLERK, UserRole.MANAGER, UserRole.ADMIN],
    requires_idempotency_key: true,
    requires_expected_version: true,
    response_contract: 'ReportDeliveryMutationResponse',
  },
  {
    route_key: 'POST /report-deliveries/{delivery_id}/action-done',
    method: 'POST',
    path: '/report-deliveries/{delivery_id}/action-done',
    lambda_handler: '@/phos/backend/report-deliveries-lambda#markReportActionDoneHandler',
    required_scopes: ['phos/report-deliveries.write'],
    allowed_roles: [UserRole.PHARMACIST, UserRole.MANAGER, UserRole.ADMIN],
    requires_idempotency_key: true,
    requires_expected_version: true,
    response_contract: 'ReportDeliveryMutationResponse',
  },
] as const satisfies readonly PhosApiRoute[];

export function findPhosRoute(route_key: string): PhosApiRoute | undefined {
  return PHOS_API_ROUTES.find((route) => route.route_key === route_key);
}
