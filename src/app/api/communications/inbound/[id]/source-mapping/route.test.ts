import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  authContextMock,
  authRejectionMock,
  eventFindFirstMock,
  eventUpdateMock,
  mappingFindFirstMock,
  mappingCreateMock,
  withAuthContextOptionsMock,
  withOrgContextMock,
  buildInboundCommunicationEventAssignmentWhereMock,
  canAccessCaseScopedPatientResourceMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  authContextMock: {
    orgId: 'org_1',
    role: 'pharmacist',
    userId: 'user_1',
  },
  authRejectionMock: vi.fn<() => Response | null>(() => null),
  eventFindFirstMock: vi.fn(),
  eventUpdateMock: vi.fn(),
  mappingFindFirstMock: vi.fn(),
  mappingCreateMock: vi.fn(),
  withAuthContextOptionsMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  buildInboundCommunicationEventAssignmentWhereMock: vi.fn(),
  canAccessCaseScopedPatientResourceMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext:
    (handler: (...args: unknown[]) => Promise<Response>, options: unknown) =>
    (req: Request, routeContext: { params: Promise<{ id?: string }> }) => {
      withAuthContextOptionsMock(options);
      const rejection = authRejectionMock();
      if (rejection) return Promise.resolve(rejection);
      return handler(req, authContextMock, routeContext);
    },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/communication-request-access', () => ({
  buildInboundCommunicationEventAssignmentWhere: buildInboundCommunicationEventAssignmentWhereMock,
}));

vi.mock('@/server/services/patient-access', () => ({
  canAccessCaseScopedPatientResource: canAccessCaseScopedPatientResourceMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { POST } from './route';

function routeContext(id = 'event_1') {
  return { params: Promise.resolve({ id }) };
}

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/communications/inbound/event_1/source-mapping', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

type InboundEventFixture = {
  id: string;
  patient_id: string | null;
  case_id: string | null;
  source_channel: string;
  external_thread_id: string | null;
  external_url: string | null;
  sender_contact: string | null;
};

type MappingFixture = {
  id: string;
  patient_id: string;
  case_id: string | null;
  source_system: string;
  mapping_status: string;
  confidence: string;
  created_at: Date;
  reviewed_at: Date | null;
};

function buildInboundEvent(overrides: Partial<InboundEventFixture> = {}): InboundEventFixture {
  return {
    id: 'event_1',
    patient_id: 'patient_1',
    case_id: 'case_1',
    source_channel: 'phone',
    external_thread_id: null,
    external_url: null,
    sender_contact: '090-1234-5678',
    ...overrides,
  };
}

function buildMappingCreateResult(overrides: Partial<MappingFixture> = {}): MappingFixture {
  return {
    id: 'mapping_1',
    patient_id: 'patient_1',
    case_id: 'case_1',
    source_system: 'phone',
    mapping_status: 'needs_review',
    confidence: 'probable',
    created_at: new Date('2026-07-08T01:00:00.000Z'),
    reviewed_at: null,
    ...overrides,
  };
}

describe('POST /api/communications/inbound/[id]/source-mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRejectionMock.mockReturnValue(null);
    buildInboundCommunicationEventAssignmentWhereMock.mockResolvedValue({
      OR: [{ patient_id: { in: ['patient_1'] } }],
    });
    canAccessCaseScopedPatientResourceMock.mockResolvedValue(true);
    eventFindFirstMock.mockResolvedValue(buildInboundEvent());
    mappingFindFirstMock.mockResolvedValue(null);
    mappingCreateMock.mockResolvedValue(buildMappingCreateResult());
    withOrgContextMock.mockImplementation((_orgId, work) =>
      work({
        inboundCommunicationEvent: {
          findFirst: eventFindFirstMock,
          update: eventUpdateMock,
        },
        inboundSourceMapping: {
          findFirst: mappingFindFirstMock,
          create: mappingCreateMock,
        },
      }),
    );
  });

  it('creates a needs_review source mapping with a server-derived source key and minimal response', async () => {
    const response = await POST(
      createRequest({
        patient_id: 'patient_1',
        case_id: 'case_1',
        external_patient_label: '外部患者A',
        external_contact_name: '訪問看護師A',
        external_contact_role: 'nurse',
        external_organization_name: '訪問看護ステーションA',
        confidence: 'probable',
        mapping_status: 'needs_review',
      }),
      routeContext(),
    );

    expect(response.status).toBe(201);
    expectSensitiveNoStore(response);
    expect(withAuthContextOptionsMock).toHaveBeenCalledWith({
      permission: 'canReport',
      message: '他職種受信のsource mapping権限がありません',
    });
    expect(buildInboundCommunicationEventAssignmentWhereMock).toHaveBeenCalledWith({
      db: expect.any(Object),
      orgId: 'org_1',
      accessContext: authContextMock,
    });
    expect(eventFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'event_1',
          org_id: 'org_1',
          AND: [{ OR: [{ patient_id: { in: ['patient_1'] } }] }],
        }),
        select: expect.objectContaining({
          sender_contact: true,
          external_url: true,
        }),
      }),
    );
    expect(canAccessCaseScopedPatientResourceMock).toHaveBeenCalledWith({
      db: expect.any(Object),
      orgId: 'org_1',
      patientId: 'patient_1',
      caseId: 'case_1',
      accessContext: authContextMock,
    });
    expect(mappingCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        source_system: 'phone',
        external_thread_id: 'phone:09012345678',
        external_patient_label: '外部患者A',
        external_contact_name: '訪問看護師A',
        external_contact_role: 'nurse',
        external_organization_name: '訪問看護ステーションA',
        mapping_status: 'needs_review',
        confidence: 'probable',
        created_by: 'user_1',
        reviewed_by: null,
        reviewed_at: null,
      }),
      select: {
        id: true,
        patient_id: true,
        case_id: true,
        source_system: true,
        mapping_status: true,
        confidence: true,
        created_at: true,
        reviewed_at: true,
      },
    });
    expect(eventUpdateMock).not.toHaveBeenCalled();

    const payload = await response.json();
    expect(payload).toMatchObject({
      data: {
        mapping_id: 'mapping_1',
        inbound_event_id: 'event_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        source_system: 'phone',
        mapping_status: 'needs_review',
        confidence: 'probable',
        created_at: '2026-07-08T01:00:00.000Z',
        reviewed_at: null,
      },
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('external_thread_id');
    expect(serialized).not.toContain('external_patient_label');
    expect(serialized).not.toContain('訪問看護師A');
    expect(serialized).not.toContain('090-1234-5678');
    expect(serialized).not.toContain('sender_contact');
    expect(serialized).not.toContain('raw_text');
    expect(serialized).not.toContain('external_url');
    expect(serialized).not.toContain('org_id');
  });

  it('rejects legacy aliases and raw/source fields before touching the database', async () => {
    const response = await POST(
      createRequest({
        patient_id: 'patient_1',
        source_system: 'mcs',
        raw_text: '本文',
        sender_contact: '090-1234-5678',
        source_url: 'https://example.test/thread',
        confidence: 'probable',
        mapping_status: 'needs_review',
      }),
      routeContext(),
    );

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(mappingCreateMock).not.toHaveBeenCalled();
  });

  it('returns a unified 404 when the inbound event is not visible in the current assignment scope', async () => {
    eventFindFirstMock.mockResolvedValueOnce(null);

    const response = await POST(
      createRequest({
        patient_id: 'patient_1',
        confidence: 'probable',
        mapping_status: 'needs_review',
      }),
      routeContext(),
    );

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(mappingCreateMock).not.toHaveBeenCalled();
  });

  it('rejects inaccessible or nonexistent target patient/case before creating a mapping', async () => {
    canAccessCaseScopedPatientResourceMock.mockResolvedValueOnce(false);

    const response = await POST(
      createRequest({
        patient_id: 'patient_1',
        case_id: 'case_1',
        confidence: 'probable',
        mapping_status: 'needs_review',
      }),
      routeContext(),
    );

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(mappingCreateMock).not.toHaveBeenCalled();
  });

  it('rejects mapping targets that conflict with an already linked event patient or case', async () => {
    const response = await POST(
      createRequest({
        patient_id: 'patient_2',
        case_id: 'case_1',
        confidence: 'probable',
        mapping_status: 'needs_review',
      }),
      routeContext(),
    );

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(canAccessCaseScopedPatientResourceMock).not.toHaveBeenCalled();
    expect(mappingCreateMock).not.toHaveBeenCalled();
  });

  it('rejects active mappings without exact/manual confidence before reading the event', async () => {
    const response = await POST(
      createRequest({
        patient_id: 'patient_1',
        case_id: 'case_1',
        confidence: 'probable',
        mapping_status: 'active',
      }),
      routeContext(),
    );

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects active mappings when the source key is only a client-provided thread id', async () => {
    eventFindFirstMock.mockResolvedValueOnce(
      buildInboundEvent({
        source_channel: 'manual',
        external_thread_id: null,
        external_url: null,
        sender_contact: null,
      }),
    );

    const response = await POST(
      createRequest({
        patient_id: 'patient_1',
        case_id: 'case_1',
        external_thread_id: 'manual-thread-from-client',
        confidence: 'exact',
        mapping_status: 'active',
      }),
      routeContext(),
    );

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(mappingCreateMock).not.toHaveBeenCalled();
  });

  it('creates an active mapping only from a server-derived event source key and sets review fields', async () => {
    eventFindFirstMock.mockResolvedValueOnce(
      buildInboundEvent({
        source_channel: 'mcs',
        external_url: 'https://www.medical-care.net/projects/medical/57886227',
        sender_contact: null,
      }),
    );
    mappingCreateMock.mockResolvedValueOnce(
      buildMappingCreateResult({
        source_system: 'mcs',
        mapping_status: 'active',
        confidence: 'exact',
        reviewed_at: new Date('2026-07-08T01:01:00.000Z'),
      }),
    );

    const response = await POST(
      createRequest({
        patient_id: 'patient_1',
        case_id: 'case_1',
        confidence: 'exact',
        mapping_status: 'active',
      }),
      routeContext(),
    );

    expect(response.status).toBe(201);
    expectSensitiveNoStore(response);
    expect(mappingCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source_system: 'mcs',
          external_thread_id: 'mcs:https://www.medical-care.net/projects/medical/57886227',
          mapping_status: 'active',
          confidence: 'exact',
          reviewed_by: 'user_1',
          reviewed_at: expect.any(Date),
        }),
      }),
    );

    const payload = await response.json();
    expect(payload).toMatchObject({
      data: {
        source_system: 'mcs',
        mapping_status: 'active',
        confidence: 'exact',
        reviewed_at: '2026-07-08T01:01:00.000Z',
      },
    });
    expect(JSON.stringify(payload)).not.toContain('medical-care.net');
  });

  it('rejects active mappings with unverified external room ids', async () => {
    const response = await POST(
      createRequest({
        patient_id: 'patient_1',
        case_id: 'case_1',
        external_room_id: 'room_1',
        confidence: 'manual',
        mapping_status: 'active',
      }),
      routeContext(),
    );

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects client-provided thread ids that differ from the server-derived source key', async () => {
    const response = await POST(
      createRequest({
        patient_id: 'patient_1',
        case_id: 'case_1',
        external_thread_id: 'phone:09099999999',
        confidence: 'probable',
        mapping_status: 'needs_review',
      }),
      routeContext(),
    );

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(mappingCreateMock).not.toHaveBeenCalled();
  });

  it('rejects duplicate active or review source mappings', async () => {
    mappingFindFirstMock.mockResolvedValueOnce({
      id: 'existing_mapping_1',
      patient_id: 'patient_2',
      case_id: 'case_2',
      mapping_status: 'active',
    });

    const response = await POST(
      createRequest({
        patient_id: 'patient_1',
        case_id: 'case_1',
        confidence: 'probable',
        mapping_status: 'needs_review',
      }),
      routeContext(),
    );

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    expect(mappingCreateMock).not.toHaveBeenCalled();
  });
});
