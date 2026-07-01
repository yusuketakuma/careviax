import { describe, expect, it } from 'vitest';
import {
  COMMUNICATION_REQUESTS_API_PATH,
  buildCommunicationRequestApiPath,
  buildCommunicationRequestsApiPath,
  buildCommunicationRequestResolveFollowupApiPath,
} from './api-paths';

describe('communication request API path helpers', () => {
  it('builds communication request collection paths', () => {
    expect(COMMUNICATION_REQUESTS_API_PATH).toBe('/api/communication-requests');
    expect(buildCommunicationRequestsApiPath()).toBe('/api/communication-requests');
  });

  it('builds scoped communication request collection query paths', () => {
    const requestPath = buildCommunicationRequestsApiPath({
      requestType: 'care_report_reply_request',
      relatedEntityType: 'care_report',
      relatedEntityId: 'rep/1?x=y#frag',
    });

    expect(requestPath).toBe(
      '/api/communication-requests?request_type=care_report_reply_request&related_entity_type=care_report&related_entity_id=rep%2F1%3Fx%3Dy%23frag',
    );
    const params = new URLSearchParams(requestPath.split('?')[1]);
    expect(params.get('related_entity_id')).toBe('rep/1?x=y#frag');
  });

  it('also accepts prebuilt query params without changing their order', () => {
    const params = new URLSearchParams();
    params.set('status', 'sent');
    params.set('request_type', 'patient_share_reply_request');

    expect(buildCommunicationRequestsApiPath(params)).toBe(
      '/api/communication-requests?status=sent&request_type=patient_share_reply_request',
    );
  });

  it('does not append an empty query string for collection paths', () => {
    expect(buildCommunicationRequestsApiPath(new URLSearchParams())).toBe(
      '/api/communication-requests',
    );
  });

  it('builds communication request detail paths for normal ids', () => {
    expect(buildCommunicationRequestApiPath('request_1')).toBe(
      '/api/communication-requests/request_1',
    );
  });

  it('encodes only the request id path segment', () => {
    const requestId = 'request/1?x=y#frag';

    expect(buildCommunicationRequestApiPath(requestId)).toBe(
      `/api/communication-requests/${encodeURIComponent(requestId)}`,
    );
  });

  it('keeps trusted suffixes outside the encoded request id segment', () => {
    const requestId = 'request/1?x=y#frag';

    expect(buildCommunicationRequestApiPath(requestId, '/responses')).toBe(
      `/api/communication-requests/${encodeURIComponent(requestId)}/responses`,
    );
  });

  it('builds resolve-followup paths through the same segment contract', () => {
    const requestId = 'request/1?x=y#frag';

    expect(buildCommunicationRequestResolveFollowupApiPath(requestId)).toBe(
      `/api/communication-requests/${encodeURIComponent(requestId)}/resolve-followup`,
    );
  });

  it.each(['.', '..'])('rejects exact dot-segment request id %s', (requestId) => {
    expect(() => buildCommunicationRequestApiPath(requestId)).toThrow(RangeError);
    expect(() => buildCommunicationRequestResolveFollowupApiPath(requestId)).toThrow(RangeError);
  });
});
