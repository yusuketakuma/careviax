import { describe, expect, it, vi } from 'vitest';
import {
  claimFirstVisitDocumentVersion,
  FirstVisitDocumentVersionConflictError,
  nextFirstVisitDocumentVersion,
} from './first-visit-document-version';

describe('FirstVisitDocument version claims', () => {
  it('always advances the token by at least one millisecond', () => {
    const expected = new Date('2026-07-17T00:00:00.500Z');
    expect(nextFirstVisitDocumentVersion(expected, new Date('2026-07-17T00:00:00.100Z')))
      .toEqual(new Date('2026-07-17T00:00:00.501Z'));
    expect(nextFirstVisitDocumentVersion(expected, new Date('2026-07-17T00:00:01.000Z')))
      .toEqual(new Date('2026-07-17T00:00:01.000Z'));
  });

  it('claims by org, id, and exact version while preserving supplied data', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const expected = new Date('2026-07-17T00:00:00.000Z');

    const updatedAt = await claimFirstVisitDocumentVersion(
      { firstVisitDocument: { updateMany } } as never,
      {
        id: 'doc_1',
        orgId: 'org_1',
        expectedUpdatedAt: expected,
        now: expected,
        data: { document_url: '/documents/1' },
      },
    );

    expect(updatedAt).toEqual(new Date('2026-07-17T00:00:00.001Z'));
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'doc_1', org_id: 'org_1', updated_at: expected },
      data: { document_url: '/documents/1', updated_at: updatedAt },
    });
  });

  it('throws only the typed conflict when the token no longer matches', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    await expect(
      claimFirstVisitDocumentVersion(
        { firstVisitDocument: { updateMany } } as never,
        {
          id: 'doc_1',
          orgId: 'org_1',
          expectedUpdatedAt: new Date('2026-07-17T00:00:00.000Z'),
        },
      ),
    ).rejects.toBeInstanceOf(FirstVisitDocumentVersionConflictError);
  });

  it('does not mask unknown database failures', async () => {
    const failure = new Error('database unavailable');
    const updateMany = vi.fn().mockRejectedValue(failure);
    await expect(
      claimFirstVisitDocumentVersion(
        { firstVisitDocument: { updateMany } } as never,
        {
          id: 'doc_1',
          orgId: 'org_1',
          expectedUpdatedAt: new Date('2026-07-17T00:00:00.000Z'),
        },
      ),
    ).rejects.toBe(failure);
  });
});
