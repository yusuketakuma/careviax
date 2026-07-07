import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectNoStore } from '@/test/api-response-assertions';

const { listCommunicationQueueMock, withAuthContextOptions } = vi.hoisted(() => ({
  listCommunicationQueueMock: vi.fn(),
  withAuthContextOptions: [] as Array<{ permission?: string; message?: string }>,
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: { orgId: string; userId: string; role: 'pharmacist' },
    ) => Promise<Response>,
    options?: { permission?: string; message?: string },
  ) => {
    withAuthContextOptions.push(options ?? {});
    return (req: NextRequest) =>
      handler(req, {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      });
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

vi.mock('@/server/services/communication-queue', () => ({
  listCommunicationQueue: listCommunicationQueueMock,
}));

import { GET as rawGET } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);
const jsonPayloadBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

function createRequest(search = '') {
  return new NextRequest(`http://localhost/api/communications/inbound${search}`);
}

describe('/api/communications/inbound', () => {
  it('is gated by the report capability', () => {
    expect(withAuthContextOptions).toContainEqual(
      expect.objectContaining({
        permission: 'canReport',
        message: '他職種受信の閲覧権限がありません',
      }),
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    listCommunicationQueueMock.mockResolvedValue({
      summary: {
        pending_count: 3,
        overdue_count: 0,
        self_reports: 0,
        callback_followups: 0,
        inbound_communications: 3,
        open_requests: 0,
        delivery_backlog: 0,
        expiring_external_shares: 0,
        unconfirmed_count: 0,
        reply_waiting_count: 0,
        failed_count: 0,
      },
      items: [
        {
          id: 'inbound_communication:event_1',
          queue_type: 'inbound_communication',
          title: '電話連絡を受信',
          summary: '他職種または関係者からの受信情報があります。内容は連絡履歴で確認してください。',
          channel: 'phone',
          status: 'needs_review',
          priority: 'high',
          patient_id: 'patient_1',
          patient_name: '佐藤花子',
          due_at: '2026-07-07T01:00:00.000Z',
          action_href: '/patients/patient_1/collaboration',
          action_label: '受信情報を確認',
        },
        {
          id: 'inbound_communication:event_2',
          queue_type: 'inbound_communication',
          title: 'FAX連絡を受信',
          summary: '他職種または関係者からの受信情報があります。内容は連絡履歴で確認してください。',
          channel: 'fax',
          status: 'needs_review',
          priority: 'urgent',
          patient_id: 'patient_2',
          patient_name: '高橋一郎',
          due_at: '2026-07-07T02:00:00.000Z',
          action_href: 'https://signed.example/file?token=secret',
          action_label: '受信情報を確認',
        },
        {
          id: 'inbound_communication:event_3',
          queue_type: 'inbound_communication',
          title: 'MCS連絡を受信',
          summary: '他職種または関係者からの受信情報があります。内容は連絡履歴で確認してください。',
          channel: 'mcs',
          status: 'task_created',
          priority: 'high',
          patient_id: 'patient_3',
          patient_name: '山田三郎',
          due_at: '2026-07-07T03:00:00.000Z',
          action_href: '/patients/patient_3/mcs',
          action_label: '受信情報を確認',
        },
      ],
      timeline: [],
      emergency_drafts: [],
    });
  });

  it('returns summary-only inbound communication inbox items', async () => {
    const response = await GET(createRequest('?limit=10'));
    const payload = (await response.json()) as {
      data: { items: Array<{ channel: string; action_href: string }> };
      meta: {
        count_basis: string;
        limit: number;
        visible_count: number;
        hidden_count: number;
        partial_failures: unknown[];
      };
    };

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(response.headers.get('Content-Length')).toBe(String(jsonPayloadBytes(payload)));
    expect(listCommunicationQueueMock).toHaveBeenCalledWith(
      {},
      {
        orgId: 'org_1',
        limit: 10,
        queueTypes: ['inbound_communication'],
        sourceScope: 'requested',
      },
    );
    expect(payload.meta).toMatchObject({
      count_basis: 'visible_window',
      limit: 10,
      visible_count: 3,
      hidden_count: 0,
      partial_failures: [],
    });
    expect(payload.data.items).toHaveLength(3);
    expect(payload.data.items[0]).toMatchObject({
      channel: 'phone',
      action_href: '/patients/patient_1/collaboration',
    });
    expect(payload.data.items[1]).toMatchObject({
      channel: 'fax',
      action_href: '/communications/requests',
    });
    expect(payload.data.items[2]).toMatchObject({
      channel: 'mcs',
      action_href: '/patients/patient_3/mcs',
    });

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('湿布は残り4枚です');
    expect(serialized).not.toContain('訪問看護師A');
    expect(serialized).not.toContain('090-1234-5678');
    expect(serialized).not.toContain('storageKey');
    expect(serialized).not.toContain('token=secret');
    expect(serialized).not.toContain('medical-care.net');
  });

  it('filters by channel, status, and priority after the inbound bridge projection', async () => {
    const response = await GET(createRequest('?channel=phone&status=needs_review&priority=high'));
    const payload = (await response.json()) as {
      data: { items: Array<{ channel: string; priority: string }> };
      meta: { visible_count: number; hidden_count: number; count_basis: string };
    };

    expect(response.status).toBe(200);
    expect(payload.data.items).toEqual([expect.objectContaining({ channel: 'phone' })]);
    expect(payload.data.items[0].priority).toBe('high');
    expect(payload.meta).toMatchObject({
      visible_count: 1,
      hidden_count: 2,
      count_basis: 'visible_window',
    });
  });

  it('filters mcs channel after the inbound bridge projection', async () => {
    const response = await GET(createRequest('?channel=mcs&status=task_created'));
    const payload = (await response.json()) as {
      data: { items: Array<{ channel: string }> };
    };

    expect(response.status).toBe(200);
    expect(payload.data.items).toEqual([expect.objectContaining({ channel: 'mcs' })]);
  });

  it('filters task-created inbound items after the task bridge projection', async () => {
    const response = await GET(createRequest('?status=task_created'));
    const payload = (await response.json()) as {
      data: { items: Array<{ channel: string; status: string; action_href: string }> };
    };

    expect(response.status).toBe(200);
    expect(payload.data.items).toEqual([
      expect.objectContaining({
        channel: 'mcs',
        status: 'task_created',
        action_href: '/patients/patient_3/mcs',
      }),
    ]);
  });

  it('filters reviewed-but-not-applied inbound items', async () => {
    listCommunicationQueueMock.mockResolvedValueOnce({
      summary: {
        pending_count: 1,
        overdue_count: 0,
        self_reports: 0,
        callback_followups: 0,
        inbound_communications: 1,
        open_requests: 0,
        delivery_backlog: 0,
        expiring_external_shares: 0,
        unconfirmed_count: 0,
        reply_waiting_count: 0,
        failed_count: 0,
      },
      items: [
        {
          id: 'inbound_communication:event_pending_apply',
          queue_type: 'inbound_communication',
          title: '電話連絡を受信',
          summary:
            '受信シグナルはレビュー済みです。残数台帳など業務データへの明示反映が残っています。',
          channel: 'phone',
          status: 'reviewed_pending_action',
          priority: 'high',
          patient_id: 'patient_1',
          patient_name: '佐藤花子',
          due_at: '2026-07-07T01:00:00.000Z',
          action_href: '/patients/patient_1/collaboration',
          action_label: '受信情報を確認',
        },
      ],
      timeline: [],
      emergency_drafts: [],
    });

    const response = await GET(createRequest('?status=reviewed_pending_action'));
    const payload = (await response.json()) as {
      data: {
        summary: { reviewed_pending_action_count: number };
        items: Array<{ status: string; summary: string }>;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.data.summary.reviewed_pending_action_count).toBe(1);
    expect(payload.data.items).toEqual([
      expect.objectContaining({
        status: 'reviewed_pending_action',
        summary:
          '受信シグナルはレビュー済みです。残数台帳など業務データへの明示反映が残っています。',
      }),
    ]);
  });

  it('falls back relative action hrefs that contain signed or storage query material', async () => {
    listCommunicationQueueMock.mockResolvedValueOnce({
      summary: {
        pending_count: 1,
        overdue_count: 0,
        self_reports: 0,
        callback_followups: 0,
        inbound_communications: 1,
        open_requests: 0,
        delivery_backlog: 0,
        expiring_external_shares: 0,
        unconfirmed_count: 0,
        reply_waiting_count: 0,
        failed_count: 0,
      },
      items: [
        {
          id: 'inbound_communication:event_secret_href',
          queue_type: 'inbound_communication',
          title: '電話連絡を受信',
          summary: '他職種または関係者からの受信情報があります。',
          channel: 'phone',
          status: 'needs_review',
          priority: 'high',
          patient_id: 'patient_1',
          patient_name: '佐藤花子',
          due_at: '2026-07-07T01:00:00.000Z',
          action_href: '/patients/patient_1/collaboration?storageKey=secret&token=secret',
          action_label: '受信情報を確認',
        },
      ],
      timeline: [],
      emergency_drafts: [],
    });

    const response = await GET(createRequest());
    const payload = (await response.json()) as {
      data: { items: Array<{ action_href: string }> };
    };

    expect(response.status).toBe(200);
    expect(payload.data.items[0].action_href).toBe('/communications/requests');
    expect(JSON.stringify(payload)).not.toContain('storageKey=secret');
    expect(JSON.stringify(payload)).not.toContain('token=secret');
  });

  it('rejects unsupported filters', async () => {
    const response = await GET(createRequest('?channel=postal'));
    const payload = (await response.json()) as { code: string; details: unknown };

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(payload.code).toBe('VALIDATION_ERROR');
    expect(listCommunicationQueueMock).not.toHaveBeenCalled();
  });

  it('returns a no-store internal error without leaking source errors when the queue read fails', async () => {
    listCommunicationQueueMock.mockRejectedValueOnce(new Error('database unavailable'));

    const response = await GET(createRequest());
    const payload = await response.json();

    expect(response.status).toBe(500);
    expectNoStore(response);
    expect(JSON.stringify(payload)).not.toContain('database unavailable');
  });
});
