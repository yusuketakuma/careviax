import { describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '@/test/fetch-test-utils';
import { fetchAllShareCommunicationRequests } from './share-workspace-client';

const at = (day: number) => `2026-07-${String(day).padStart(2, '0')}T00:00:00.000Z`;

const scope = {
  expectedPatientId: 'patient_1',
  expectedRequestType: 'patient_share_reply_request' as const,
  expectedRelatedEntityType: 'patient' as const,
  expectedRelatedEntityId: 'patient_1',
};

function request(id: string, day: number) {
  return {
    id,
    patient_id: 'patient_1',
    request_type: 'patient_share_reply_request',
    recipient_name: '田中',
    recipient_role: 'care_manager',
    related_entity_type: 'patient',
    related_entity_id: 'patient_1',
    status: 'sent',
    subject: '共有確認',
    requested_at: at(day),
    responses: [],
    content: 'must-not-enter-client-state',
  };
}

describe('fetchAllShareCommunicationRequests', () => {
  it('follows all cursor pages with the same scope and organization header', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [request('request_2', 12)],
          meta: { limit: 100, has_more: true, next_cursor: 'request_2' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [request('request_1', 11)],
          meta: { limit: 100, has_more: false, next_cursor: null },
        }),
      );

    const payload = await fetchAllShareCommunicationRequests({
      orgId: 'org_1',
      scope,
      errorMessage: 'failed',
      fetchImpl,
    });

    expect(payload.data.map((item) => item.id)).toEqual(['request_2', 'request_1']);
    expect(payload.data[0]).not.toHaveProperty('content');
    expect(payload.data[0]).not.toHaveProperty('recipient_name');
    expect(payload.data[0]).not.toHaveProperty('subject');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const [input, init] of fetchImpl.mock.calls) {
      const url = new URL(String(input), 'http://localhost');
      expect(url.searchParams.get('request_type')).toBe('patient_share_reply_request');
      expect(url.searchParams.get('related_entity_type')).toBe('patient');
      expect(url.searchParams.get('related_entity_id')).toBe('patient_1');
      expect(url.searchParams.get('limit')).toBe('100');
      expect(init?.headers).toEqual({ 'x-org-id': 'org_1' });
    }
    expect(
      new URL(String(fetchImpl.mock.calls[1]?.[0]), 'http://localhost').searchParams.get('cursor'),
    ).toBe('request_2');
  });

  it('fails closed on a duplicate request across pages', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [request('request_1', 12)],
          meta: { limit: 100, has_more: true, next_cursor: 'cursor_1' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [request('request_1', 11)],
          meta: { limit: 100, has_more: false, next_cursor: null },
        }),
      );

    await expect(
      fetchAllShareCommunicationRequests({
        orgId: 'org_1',
        scope,
        errorMessage: 'failed',
        fetchImpl,
      }),
    ).rejects.toThrow('failed');
  });

  it('fails closed when a later page moves forward in the global order', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [request('request_1', 11)],
          meta: { limit: 100, has_more: true, next_cursor: 'cursor_1' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [request('request_2', 12)],
          meta: { limit: 100, has_more: false, next_cursor: null },
        }),
      );

    await expect(
      fetchAllShareCommunicationRequests({
        orgId: 'org_1',
        scope,
        errorMessage: 'failed',
        fetchImpl,
      }),
    ).rejects.toThrow('failed');
  });

  it('fails closed when equal timestamps move forward by id across pages', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [request('request_1', 12)],
          meta: { limit: 100, has_more: true, next_cursor: 'cursor_1' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [request('request_2', 12)],
          meta: { limit: 100, has_more: false, next_cursor: null },
        }),
      );

    await expect(
      fetchAllShareCommunicationRequests({
        orgId: 'org_1',
        scope,
        errorMessage: 'failed',
        fetchImpl,
      }),
    ).rejects.toThrow('failed');
  });

  it('fails closed when five full pages still have more data', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    for (let page = 0; page < 5; page += 1) {
      fetchImpl.mockResolvedValueOnce(
        jsonResponse({
          data: [request(`request_${page}`, 15 - page)],
          meta: { limit: 100, has_more: true, next_cursor: `cursor_${page}` },
        }),
      );
    }

    await expect(
      fetchAllShareCommunicationRequests({
        orgId: 'org_1',
        scope,
        errorMessage: 'failed',
        fetchImpl,
      }),
    ).rejects.toThrow('failed');
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });
});
