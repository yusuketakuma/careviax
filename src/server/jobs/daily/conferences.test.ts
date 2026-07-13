import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  conferenceNoteFindManyMock,
  careCaseFindManyMock,
  dispatchNotificationEventMock,
  withOrgContextMock,
  runJobMock,
} = vi.hoisted(() => ({
  conferenceNoteFindManyMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  dispatchNotificationEventMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  runJobMock: vi.fn(async (_jobType: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    conferenceNote: { findMany: conferenceNoteFindManyMock },
    careCase: { findMany: careCaseFindManyMock },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('../runner', () => ({
  runJob: runJobMock,
}));

vi.mock('@/server/services/notifications', () => ({
  dispatchNotificationEvent: dispatchNotificationEventMock,
}));

import { checkConferenceMeetingReminders } from './conferences';

function buildNote(overrides: Record<string, unknown>) {
  return {
    id: 'note_1',
    org_id: 'org_a',
    case_id: 'case_1',
    title: '担当者会議',
    structured_content: {
      sections: [{ key: 'next_meeting_date', body: '2026-07-04' }],
    },
    ...overrides,
  };
}

function buildCase(overrides: Record<string, unknown>) {
  return {
    id: 'case_1',
    patient_id: 'patient_1',
    primary_pharmacist_id: 'pharmacist_1',
    patient: { name: '山田 太郎' },
    ...overrides,
  };
}

describe('checkConferenceMeetingReminders', () => {
  const todayText = '2026-07-04';
  const tomorrowText = '2026-07-05';
  const twoDaysOutText = '2026-07-06';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // UTCでは7月3日だが、JSTの業務日は7月4日。
    vi.setSystemTime(new Date('2026-07-03T16:30:00.000Z'));
    runJobMock.mockImplementation(async (_jobType: string, fn: () => Promise<unknown>) => fn());
    withOrgContextMock.mockImplementation(
      async (orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn({ orgId }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('dispatches each reminder inside its own note org context (multi-org, no cross-org bleed)', async () => {
    conferenceNoteFindManyMock.mockResolvedValue([
      buildNote({
        id: 'note_a',
        org_id: 'org_a',
        case_id: 'case_a',
        structured_content: { sections: [{ key: 'next_meeting_date', body: tomorrowText }] },
      }),
      buildNote({
        id: 'note_b',
        org_id: 'org_b',
        case_id: 'case_b',
        structured_content: { sections: [{ key: 'next_meeting_date', body: tomorrowText }] },
      }),
    ]);
    careCaseFindManyMock.mockResolvedValue([
      buildCase({ id: 'case_a', primary_pharmacist_id: 'pharmacist_a' }),
      buildCase({ id: 'case_b', primary_pharmacist_id: 'pharmacist_b' }),
    ]);

    const result = await checkConferenceMeetingReminders();

    expect(result).toEqual({ processedCount: 2 });
    expect(dispatchNotificationEventMock).toHaveBeenCalledWith(
      { orgId: 'org_a' },
      expect.objectContaining({ orgId: 'org_a', explicitUserIds: ['pharmacist_a'] }),
    );
    expect(dispatchNotificationEventMock).toHaveBeenCalledWith(
      { orgId: 'org_b' },
      expect.objectContaining({ orgId: 'org_b', explicitUserIds: ['pharmacist_b'] }),
    );
    // org_a のケース担当を org_b の通知宛先に混同していないこと。
    expect(dispatchNotificationEventMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_a', explicitUserIds: ['pharmacist_b'] }),
    );
  });

  it('includes a meeting scheduled for today (boundary: same-day)', async () => {
    conferenceNoteFindManyMock.mockResolvedValue([
      buildNote({
        structured_content: { sections: [{ key: 'next_meeting_date', body: todayText }] },
      }),
    ]);
    careCaseFindManyMock.mockResolvedValue([buildCase({})]);

    const result = await checkConferenceMeetingReminders();

    expect(result).toEqual({ processedCount: 1 });
    expect(dispatchNotificationEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        message: expect.stringContaining(todayText),
        dedupeKey: `conference-next-meeting:note_1:${todayText}`,
        metadata: expect.objectContaining({ next_meeting_date: todayText }),
      }),
    );
  });

  it('excludes a meeting scheduled 2 days out (boundary: just outside the window)', async () => {
    conferenceNoteFindManyMock.mockResolvedValue([
      buildNote({
        structured_content: { sections: [{ key: 'next_meeting_date', body: twoDaysOutText }] },
      }),
    ]);
    careCaseFindManyMock.mockResolvedValue([buildCase({})]);

    const result = await checkConferenceMeetingReminders();

    expect(result).toEqual({ processedCount: 0 });
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('skips a note whose next-meeting section has no parseable date', async () => {
    conferenceNoteFindManyMock.mockResolvedValue([
      buildNote({ structured_content: { sections: [{ key: 'next_meeting_date', body: '未定' }] } }),
    ]);
    careCaseFindManyMock.mockResolvedValue([buildCase({})]);

    const result = await checkConferenceMeetingReminders();

    expect(result).toEqual({ processedCount: 0 });
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
  });

  it('skips a note when its case has no primary pharmacist to notify', async () => {
    conferenceNoteFindManyMock.mockResolvedValue([
      buildNote({
        structured_content: { sections: [{ key: 'next_meeting_date', body: tomorrowText }] },
      }),
    ]);
    careCaseFindManyMock.mockResolvedValue([buildCase({ primary_pharmacist_id: null })]);

    const result = await checkConferenceMeetingReminders();

    expect(result).toEqual({ processedCount: 0 });
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
  });
});
