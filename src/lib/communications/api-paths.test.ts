import { describe, expect, it } from 'vitest';
import {
  buildCommunicationRequestApiPath,
  buildCommunicationRequestResolveFollowupApiPath,
} from './api-paths';

describe('communication request API path helpers', () => {
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
