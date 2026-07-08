import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectNoStore } from '@/test/api-response-assertions';

const {
  inboundCommunicationEventFindManyMock,
  inboundCommunicationEventUpdateManyMock,
  inboundCommunicationSignalUpsertMock,
  withOrgContextMock,
  assignmentWhereMock,
  withAuthContextOptions,
} = vi.hoisted(() => ({
  inboundCommunicationEventFindManyMock: vi.fn(),
  inboundCommunicationEventUpdateManyMock: vi.fn(),
  inboundCommunicationSignalUpsertMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  assignmentWhereMock: vi.fn(),
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

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/communication-request-access', () => ({
  buildInboundCommunicationEventAssignmentWhere: assignmentWhereMock,
}));

import { GET as rawGET } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);
const jsonPayloadBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

function createRequest(search = '') {
  return new NextRequest(`http://localhost/api/communications/inbound/signals${search}`);
}

describe('/api/communications/inbound/signals', () => {
  it('is gated by the report capability', () => {
    expect(withAuthContextOptions).toContainEqual(
      expect.objectContaining({
        permission: 'canReport',
        message: '他職種受信シグナルの閲覧権限がありません',
      }),
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    assignmentWhereMock.mockResolvedValue({
      OR: [{ patient_id: { in: ['patient_1'] } }, { patient_id: null }],
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        inboundCommunicationEvent: {
          findMany: inboundCommunicationEventFindManyMock,
          updateMany: inboundCommunicationEventUpdateManyMock,
        },
        inboundCommunicationSignal: {
          upsert: inboundCommunicationSignalUpsertMock,
        },
      }),
    );
    inboundCommunicationSignalUpsertMock.mockImplementation(async (args) => ({
      id: `signal_${args.where.org_id_inbound_event_id_signal_index.inbound_event_id}_${args.where.org_id_inbound_event_id_signal_index.signal_index}`,
      review_status: args.create.review_status,
      action_status: args.create.action_status,
    }));
    inboundCommunicationEventUpdateManyMock.mockResolvedValue({ count: 3 });
    inboundCommunicationEventFindManyMock.mockResolvedValue([
      {
        id: 'event_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        source_channel: 'phone',
        raw_text:
          '訪問看護師A 090-1234-5678 より、ロキソニンではなく湿布は残り4枚です。storageKey=secret token=secret',
        received_at: new Date('2026-07-07T01:00:00.000Z'),
      },
      {
        id: 'event_2',
        patient_id: 'patient_1',
        case_id: null,
        source_channel: 'email',
        raw_text: '副作用かもしれない発疹があります。至急、早めに来てください。',
        received_at: new Date('2026-07-07T02:00:00.000Z'),
      },
      {
        id: 'event_3',
        patient_id: null,
        case_id: null,
        source_channel: 'fax',
        raw_text: '単なる連絡です。',
        received_at: new Date('2026-07-07T03:00:00.000Z'),
      },
      {
        id: 'event_4',
        patient_id: 'patient_1',
        case_id: null,
        source_channel: 'mcs',
        raw_text:
          'MCS投稿: 訪問看護師Aより、カロナールは残り6錠です。https://www.medical-care.net/projects/secret',
        received_at: new Date('2026-07-07T04:00:00.000Z'),
      },
    ]);
  });

  it('returns only route-allowlisted signal candidates without raw communication text', async () => {
    const response = await GET(createRequest('?limit=10'));
    const payload = (await response.json()) as {
      data: {
        summary: {
          source_event_count: number;
          events_with_signals_count: number;
          signal_count: number;
          urgent_count: number;
          domain_counts: Record<string, number>;
        };
        items: Array<{
          candidate_key: string;
          inbound_event_id: string;
          signal_id: string;
          channel: string;
          patient_linked: boolean;
          case_linked: boolean;
          signal: {
            domain: string;
            type: string;
            has_quantity: boolean;
            unit: string | null;
            quantity_effect: string | null;
            evidence_code: string;
            stock_review: {
              action: string;
              target_label: string;
              observation_kind: string | null;
              ledger_write_policy: string | null;
              review_priority: string | null;
              warning_codes: string[];
              has_medication_identity: boolean | null;
              has_observed_quantity: boolean | null;
              has_usage_quantity: boolean | null;
              direct_ledger_write_allowed: boolean;
            } | null;
          };
        }>;
      };
      meta: {
        count_basis: string;
        visible_count: number;
        hidden_count: number;
        partial_failures: unknown[];
        source: string;
        classifier_version: string;
      };
    };

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(response.headers.get('Content-Length')).toBe(String(jsonPayloadBytes(payload)));
    expect(assignmentWhereMock).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org_1' }));
    expect(inboundCommunicationEventFindManyMock).toHaveBeenCalledWith({
      where: {
        AND: [
          {
            org_id: 'org_1',
            source_channel: { in: ['phone', 'fax', 'email', 'mcs', 'manual'] },
          },
          {
            OR: [{ patient_id: { in: ['patient_1'] } }, { patient_id: null }],
          },
        ],
      },
      orderBy: [{ received_at: 'desc' }, { created_at: 'desc' }, { id: 'desc' }],
      take: 10,
      select: {
        id: true,
        patient_id: true,
        case_id: true,
        source_channel: true,
        raw_text: true,
        received_at: true,
      },
    });
    expect(inboundCommunicationSignalUpsertMock).toHaveBeenCalledTimes(5);
    expect(inboundCommunicationSignalUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id_inbound_event_id_signal_index: {
            org_id: 'org_1',
            inbound_event_id: 'event_1',
            signal_index: 0,
          },
        },
        create: expect.objectContaining({
          org_id: 'org_1',
          patient_id: 'patient_1',
          case_id: 'case_1',
          inbound_event_id: 'event_1',
          signal_index: 0,
          signal_domain: 'medication_stock',
          signal_type: 'observed_quantity',
          extracted_quantity: 4,
          extracted_unit: '枚',
          source_confidence: 'text_parsed_high',
          review_status: 'needs_review',
          action_status: 'not_linked',
          structured_payload: {
            classifier_version: 'inbound_signal_classifier_v1',
            evidence_code: 'remaining_quantity_expression',
            quantity_effect: 'observed_absolute',
            requires_pharmacist_review: true,
          },
        }),
        update: expect.objectContaining({
          patient_id: 'patient_1',
          case_id: 'case_1',
          signal_domain: 'medication_stock',
          signal_type: 'observed_quantity',
          extracted_quantity: 4,
          extracted_unit: '枚',
          structured_payload: expect.objectContaining({
            evidence_code: 'remaining_quantity_expression',
          }),
        }),
        select: {
          id: true,
          review_status: true,
          action_status: true,
        },
      }),
    );
    expect(inboundCommunicationEventUpdateManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        id: { in: ['event_1', 'event_2', 'event_4'] },
        processing_status: 'unprocessed',
      },
      data: {
        processing_status: 'signals_extracted',
      },
    });
    expect(payload.meta).toMatchObject({
      count_basis: 'visible_window',
      visible_count: 5,
      hidden_count: 0,
      partial_failures: [],
      source: 'inbound_communication_event',
      classifier_version: 'inbound_signal_classifier_v1',
    });
    expect(payload.data.summary).toMatchObject({
      source_event_count: 4,
      events_with_signals_count: 3,
      signal_count: 5,
      urgent_count: 1,
      domain_counts: {
        medication_stock: 2,
        medication_safety: 1,
        schedule: 1,
        urgent: 1,
      },
    });
    expect(payload.data.items).toContainEqual(
      expect.objectContaining({
        candidate_key: 'inbound_signal:signal_event_1_0',
        inbound_event_id: 'event_1',
        signal_id: 'signal_event_1_0',
        channel: 'phone',
        patient_linked: true,
        case_linked: true,
        signal: expect.objectContaining({
          domain: 'medication_stock',
          type: 'observed_quantity',
          has_quantity: true,
          unit: '枚',
          quantity_effect: 'observed_absolute',
          evidence_code: 'remaining_quantity_expression',
          stock_review: {
            action: 'stage_for_pharmacist_review',
            target_label: '残数レビュー',
            observation_kind: 'remaining_quantity',
            ledger_write_policy: 'never_direct_from_external',
            review_priority: 'medium',
            warning_codes: ['medication_identity_missing'],
            has_medication_identity: false,
            has_observed_quantity: true,
            has_usage_quantity: false,
            direct_ledger_write_allowed: false,
          },
        }),
      }),
    );
    expect(payload.data.items).toContainEqual(
      expect.objectContaining({
        inbound_event_id: 'event_4',
        channel: 'mcs',
        patient_linked: true,
        signal: expect.objectContaining({
          domain: 'medication_stock',
          type: 'observed_quantity',
          stock_review: expect.objectContaining({
            action: 'stage_for_pharmacist_review',
            target_label: '残数レビュー',
          }),
        }),
      }),
    );
    expect(payload.data.items).toContainEqual(
      expect.objectContaining({
        inbound_event_id: 'event_2',
        signal: expect.objectContaining({
          domain: 'urgent',
          type: 'urgent_review_required',
          stock_review: null,
        }),
      }),
    );

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('湿布は残り4枚です');
    expect(serialized).not.toContain('カロナール');
    expect(serialized).not.toContain('ロキソニン');
    expect(serialized).not.toContain('訪問看護師A');
    expect(serialized).not.toContain('medical-care.net');
    expect(serialized).not.toContain('090-1234-5678');
    expect(serialized).not.toContain('発疹');
    expect(serialized).not.toContain('来てください');
    expect(serialized).not.toContain('storageKey');
    expect(serialized).not.toContain('token=secret');
    expect(serialized).not.toContain('content');
    expect(serialized).not.toContain('subject');
    expect(serialized).not.toContain('counterpart');
    expect(serialized).not.toContain('attachment');
    expect(serialized).not.toContain('extractedQuantity');
    expect(serialized).not.toContain('staging_key');
    expect(serialized).not.toContain('sourceRecordId');
    expect(serialized).not.toContain('source_record_id');
    expect(serialized).not.toContain('observedQuantity');
    expect(serialized).not.toContain('usageQuantity');
  });

  it('filters candidate signals by channel, domain, and type within the visible window', async () => {
    const response = await GET(
      createRequest('?channel=phone&domain=medication_stock&type=observed_quantity'),
    );
    const payload = (await response.json()) as {
      data: { items: Array<{ channel: string; signal: { domain: string; type: string } }> };
      meta: { visible_count: number; hidden_count: number; count_basis: string };
    };

    expect(response.status).toBe(200);
    expect(inboundCommunicationEventFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              source_channel: { equals: 'phone' },
            }),
          ]),
        }),
      }),
    );
    expect(payload.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channel: 'phone',
          signal: expect.objectContaining({
            domain: 'medication_stock',
            type: 'observed_quantity',
          }),
        }),
      ]),
    );
    expect(payload.meta).toMatchObject({
      visible_count: 2,
      hidden_count: 3,
      count_basis: 'visible_window',
    });
  });

  it('queries formal MCS inbound source events by the public mcs channel', async () => {
    const response = await GET(
      createRequest('?channel=mcs&domain=medication_stock&type=observed_quantity'),
    );
    const payload = (await response.json()) as {
      data: { items: Array<{ channel: string; inbound_event_id: string }> };
    };

    expect(response.status).toBe(200);
    expect(inboundCommunicationEventFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              source_channel: { equals: 'mcs' },
            }),
          ]),
        }),
      }),
    );
    expect(payload.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channel: 'mcs',
        }),
      ]),
    );
    expect(JSON.stringify(payload)).not.toContain('medical-care.net');
  });

  it('rejects unsupported filters before reading communication events', async () => {
    const response = await GET(createRequest('?channel=postal&domain=raw&type=foo'));
    const payload = (await response.json()) as { code: string; details: unknown };

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(payload.code).toBe('VALIDATION_ERROR');
    expect(inboundCommunicationEventFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects invalid limit before reading communication events', async () => {
    const response = await GET(createRequest('?limit=abc'));

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(inboundCommunicationEventFindManyMock).not.toHaveBeenCalled();
  });

  it('returns a no-store internal error without leaking row content when the source query fails', async () => {
    inboundCommunicationEventFindManyMock.mockRejectedValueOnce(new Error('database unavailable'));

    const response = await GET(createRequest());
    const payload = await response.json();

    expect(response.status).toBe(500);
    expectNoStore(response);
    expect(JSON.stringify(payload)).not.toContain('湿布は残り4枚です');
    expect(JSON.stringify(payload)).not.toContain('database unavailable');
  });
});
