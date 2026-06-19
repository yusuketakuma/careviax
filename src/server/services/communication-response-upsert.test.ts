import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { upsertCommunicationResponseByIntent } from './communication-response-upsert';

function buildUniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target: ['org_id', 'response_intent_key'] },
  });
}

function createDb() {
  return {
    communicationResponse: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  };
}

describe('upsertCommunicationResponseByIntent', () => {
  const baseArgs = {
    orgId: 'org_1',
    requestId: 'request_1',
    responderName: '医師A',
    content: '確認しました',
    respondedAt: new Date('2026-03-29T00:00:00.000Z'),
  };

  it('returns an existing response for the same intent without creating another row', async () => {
    const db = createDb();
    db.communicationResponse.findFirst.mockResolvedValueOnce({ id: 'response_existing' });

    const result = await upsertCommunicationResponseByIntent({
      db,
      ...baseArgs,
    });

    expect(result).toMatchObject({
      response: { id: 'response_existing' },
      created: false,
      responseIntentKey: expect.stringMatching(/^communication-response:v2:[a-f0-9]{64}$/),
    });
    expect(db.communicationResponse.findFirst).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        request_id: 'request_1',
        OR: [
          {
            response_intent_key: expect.stringMatching(/^communication-response:v2:[a-f0-9]{64}$/),
          },
          {
            response_intent_key: expect.stringMatching(/^communication-response:v1:[a-f0-9]{64}$/),
          },
          {
            response_intent_key: null,
            responder_name: '医師A',
            content: '確認しました',
            responded_at: baseArgs.respondedAt,
          },
        ],
      },
    });
    expect(db.communicationResponse.create).not.toHaveBeenCalled();
  });

  it('creates a response with a deterministic intent key when no prior response exists', async () => {
    const db = createDb();
    db.communicationResponse.findFirst.mockResolvedValueOnce(null);
    db.communicationResponse.create.mockResolvedValueOnce({ id: 'response_created' });

    const result = await upsertCommunicationResponseByIntent({
      db,
      ...baseArgs,
    });

    expect(result).toMatchObject({
      response: { id: 'response_created' },
      created: true,
      responseIntentKey: expect.stringMatching(/^communication-response:v2:[a-f0-9]{64}$/),
    });
    expect(db.communicationResponse.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        request_id: 'request_1',
        responder_name: '医師A',
        content: '確認しました',
        responded_at: baseArgs.respondedAt,
        response_intent_key: result.responseIntentKey,
      }),
    });
  });

  it('returns a concurrently inserted response when the intent key unique constraint wins', async () => {
    const db = createDb();
    db.communicationResponse.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'response_race' });
    db.communicationResponse.create.mockRejectedValueOnce(buildUniqueConstraintError());

    const result = await upsertCommunicationResponseByIntent({
      db,
      ...baseArgs,
    });

    expect(result).toMatchObject({
      response: { id: 'response_race' },
      created: false,
      responseIntentKey: expect.stringMatching(/^communication-response:v2:[a-f0-9]{64}$/),
    });
    expect(db.communicationResponse.findFirst).toHaveBeenLastCalledWith({
      where: {
        org_id: 'org_1',
        request_id: 'request_1',
        response_intent_key: result.responseIntentKey,
      },
    });
  });
});
