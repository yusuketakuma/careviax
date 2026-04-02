import { describe, expect, it } from 'vitest';
import { groupPatientMcsMessagesByDay, orderPatientMcsMessages } from './messages';
import type { PatientMcsViewMessage } from './dto';

const baseMessage = (overrides: Partial<PatientMcsViewMessage>): PatientMcsViewMessage => ({
  id: 'message',
  sourceMessageId: '1',
  authorName: '篠原 陽子',
  authorRole: '看護師',
  authorOrganization: '訪問看護',
  authorDescriptor: '看護師（訪問看護）',
  postedAt: '2026-04-02T01:00:00.000Z',
  postedAtLabel: '10:00',
  body: '共有です。',
  reactionCount: 0,
  replyCount: 0,
  sortOrder: 0,
  sourceUrl: 'https://www.medical-care.net/projects/medical/1#message-1',
  syncedAt: '2026-04-02T03:00:00.000Z',
  ...overrides,
});

describe('orderPatientMcsMessages', () => {
  it('orders messages chronologically by posted timestamp by default asc', () => {
    const ordered = orderPatientMcsMessages(
      [
        baseMessage({ id: '2', sourceMessageId: '2', postedAt: '2026-04-02T03:00:00.000Z' }),
        baseMessage({ id: '1', sourceMessageId: '1', postedAt: '2026-04-02T01:00:00.000Z' }),
      ],
      'asc'
    );

    expect(ordered.map((item) => item.id)).toEqual(['1', '2']);
  });

  it('falls back to sync timestamp and supports reverse ordering', () => {
    const ordered = orderPatientMcsMessages(
      [
        baseMessage({
          id: '1',
          sourceMessageId: '1',
          postedAt: null,
          syncedAt: '2026-04-02T02:00:00.000Z',
        }),
        baseMessage({
          id: '2',
          sourceMessageId: '2',
          postedAt: null,
          syncedAt: '2026-04-02T03:00:00.000Z',
        }),
      ],
      'desc'
    );

    expect(ordered.map((item) => item.id)).toEqual(['2', '1']);
  });

  it('uses numeric message ids for stable tie-breaking when timestamps match', () => {
    const ordered = orderPatientMcsMessages(
      [
        baseMessage({ id: '10', sourceMessageId: '10', sortOrder: 0 }),
        baseMessage({ id: '2', sourceMessageId: '2', sortOrder: 0 }),
      ],
      'asc'
    );

    expect(ordered.map((item) => item.id)).toEqual(['2', '10']);
  });

  it('keeps tie-breakers aligned with descending order', () => {
    const ordered = orderPatientMcsMessages(
      [
        baseMessage({ id: '1', sourceMessageId: '1', postedAt: '2026-04-02T03:00:00.000Z', sortOrder: 0 }),
        baseMessage({ id: '2', sourceMessageId: '2', postedAt: '2026-04-02T03:00:00.000Z', sortOrder: 1 }),
      ],
      'desc'
    );

    expect(ordered.map((item) => item.id)).toEqual(['2', '1']);
  });

  it('pushes messages without any sortable timestamp to the end', () => {
    const ordered = orderPatientMcsMessages(
      [
        baseMessage({
          id: 'undated',
          sourceMessageId: '9',
          postedAt: null,
          syncedAt: '',
        }),
        baseMessage({
          id: 'dated',
          sourceMessageId: '1',
          postedAt: '2026-04-02T01:00:00.000Z',
        }),
      ],
      'asc'
    );

    expect(ordered.map((item) => item.id)).toEqual(['dated', 'undated']);
  });

  it('groups ordered messages by day for timeline rendering', () => {
    const groups = groupPatientMcsMessagesByDay([
      baseMessage({ id: '1', postedAt: '2026-04-02T01:00:00.000Z' }),
      baseMessage({ id: '2', postedAt: '2026-04-02T03:00:00.000Z' }),
      baseMessage({ id: '3', postedAt: '2026-04-03T01:00:00.000Z' }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.messages.map((item) => item.id)).toEqual(['1', '2']);
    expect(groups[1]?.messages.map((item) => item.id)).toEqual(['3']);
  });
});
