import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  withOrgContextMock,
  templateFindManyMock,
  templateCreateMock,
  templateUpdateManyMock,
} = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
  templateFindManyMock: vi.fn(),
  templateCreateMock: vi.fn(),
  templateUpdateManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext:
    (handler: (req: NextRequest, ctx: { orgId: string; userId: string; role: string }, routeContext: { params: Promise<Record<string, string>> }) => Promise<Response>) =>
      (req: NextRequest, routeContext: { params: Promise<Record<string, string>> }) =>
        handler(req, { orgId: 'org_1', userId: 'user_1', role: 'admin' }, routeContext),
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    template: {
      findMany: templateFindManyMock,
    },
  },
}));
import { GET, POST } from './route';

function createRequest(url: string, body?: unknown) {
  return new NextRequest(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('/api/templates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    templateFindManyMock.mockResolvedValue([]);
    templateCreateMock.mockResolvedValue({ id: 'template_1', name: '主治医報告 基本' });
    templateUpdateManyMock.mockResolvedValue({ count: 1 });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        template: {
          create: templateCreateMock,
          updateMany: templateUpdateManyMock,
        },
      })
    );
  });

  it('lists templates filtered by org and template_type', async () => {
    const response = await GET(
      createRequest('http://localhost/api/templates?template_type=care_report'),
      { params: Promise.resolve({}) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(templateFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          template_type: 'care_report',
        }),
      })
    );
  });

  it('creates a template and clears the previous default when requested', async () => {
    const response = await POST(
      createRequest('http://localhost/api/templates', {
        name: '主治医報告 基本',
        template_type: 'care_report',
        content: { sections: ['summary'] },
        is_default: true,
      }),
      { params: Promise.resolve({}) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(templateUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          template_type: 'care_report',
          is_default: true,
        }),
      })
    );
    expect(templateCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          org_id: 'org_1',
          name: '主治医報告 基本',
          template_type: 'care_report',
          format: 'html',
          version: 1,
          is_default: true,
        }),
      })
    );
  });

  it('creates a consent template with version metadata', async () => {
    const response = await POST(
      createRequest('http://localhost/api/templates', {
        name: '同意書 v2',
        template_type: 'consent_form',
        target_role: 'patient_family',
        format: 'pdf',
        version: 2,
        effective_from: '2026-04-01',
        content: { blocks: ['signature'] },
      }),
      { params: Promise.resolve({}) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(templateCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          template_type: 'consent_form',
          target_role: 'patient_family',
          format: 'pdf',
          version: 2,
          effective_from: new Date('2026-04-01T00:00:00.000Z'),
        }),
      })
    );
  });

  it('returns validation error for unsupported template_type query', async () => {
    const response = await GET(
      createRequest('http://localhost/api/templates?template_type=unknown'),
      { params: Promise.resolve({}) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
  });
});
