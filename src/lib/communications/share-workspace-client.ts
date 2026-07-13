import { fetchAllCursorPages } from '@/lib/api/cursor-pagination-client';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { buildCommunicationRequestsApiPath } from './api-paths';
import {
  buildShareCommunicationRequestItemSchema,
  type ShareCommunicationRequest,
  type ShareCommunicationRequestScope,
} from './share-workspace-response-schemas';

const SHARE_REQUEST_PAGE_LIMIT = 100;
const SHARE_REQUEST_MAX_PAGES = 5;

function buildShareRequestCollection(scope: ShareCommunicationRequestScope) {
  const requestPath = buildCommunicationRequestsApiPath({
    requestType: scope.expectedRequestType,
    relatedEntityType: scope.expectedRelatedEntityType,
    relatedEntityId: scope.expectedRelatedEntityId,
  });
  const separator = requestPath.indexOf('?');
  if (separator === -1) return { path: requestPath, params: new URLSearchParams() };
  return {
    path: requestPath.slice(0, separator),
    params: new URLSearchParams(requestPath.slice(separator + 1)),
  };
}

export async function fetchAllShareCommunicationRequests(args: {
  orgId: string;
  scope: ShareCommunicationRequestScope;
  errorMessage: string;
  fetchImpl?: typeof fetch;
}): Promise<{ data: ShareCommunicationRequest[] }> {
  const itemSchema = buildShareCommunicationRequestItemSchema(args.scope);
  const collection = buildShareRequestCollection(args.scope);
  const result = await fetchAllCursorPages<ShareCommunicationRequest>({
    path: collection.path,
    params: collection.params,
    init: { headers: buildOrgHeaders(args.orgId) },
    fetchImpl: args.fetchImpl,
    limit: SHARE_REQUEST_PAGE_LIMIT,
    maxPages: SHARE_REQUEST_MAX_PAGES,
    errorMessage: args.errorMessage,
    itemSchema,
  });

  const hasDuplicateId =
    new Set(result.data.map((request) => request.id)).size !== result.data.length;
  const hasInvalidOrder = result.data.some((current, index, requests) => {
    const previous = requests[index - 1];
    if (!previous) return false;
    const previousTime = Date.parse(previous.requested_at);
    const currentTime = Date.parse(current.requested_at);
    return previousTime < currentTime || (previousTime === currentTime && previous.id < current.id);
  });

  // fetchAllCursorPages validates and projects each provider item. Validate only
  // collection-wide invariants here so transformed items are not re-parsed as raw input.
  if (
    result.hasMore ||
    result.data.length > SHARE_REQUEST_PAGE_LIMIT * SHARE_REQUEST_MAX_PAGES ||
    hasDuplicateId ||
    hasInvalidOrder
  ) {
    throw new Error(args.errorMessage);
  }

  return { data: result.data };
}
