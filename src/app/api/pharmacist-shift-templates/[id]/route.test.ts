import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  pharmacistShiftTemplateFindFirstMock,
  pharmacistShiftTemplateDeleteMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  pharmacistShiftTemplateFindFirstMock: vi.fn(),
  pharmacistShiftTemplateDeleteMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    pharmacistShiftTemplate: {
      findFirst: pharmacistShiftTemplateFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { DELETE } from './route';

function createRequest() {
  return new NextRequest('http://localhost/api/pharmacist-shift-templates/template_1', {
    method: 'DELETE',
  });
}

describe('/api/pharmacist-shift-templates/[id] DELETE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'admin',
      },
    });
    pharmacistShiftTemplateFindFirstMock.mockResolvedValue({ id: 'template_1' });
    pharmacistShiftTemplateDeleteMock.mockResolvedValue({ id: 'template_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        pharmacistShiftTemplate: {
          delete: pharmacistShiftTemplateDeleteMock,
        },
      }),
    );
  });

  it('deletes an existing shift template', async () => {
    const response = (await DELETE(createRequest(), {
      params: Promise.resolve({ id: 'template_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(pharmacistShiftTemplateDeleteMock).toHaveBeenCalledWith({
      where: { id: 'template_1' },
    });
  });
});
