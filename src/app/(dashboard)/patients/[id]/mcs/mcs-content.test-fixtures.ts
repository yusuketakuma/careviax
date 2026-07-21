import { vi } from 'vitest';

export type MutationOptions = {
  mutationFn?: (input?: unknown) => Promise<unknown>;
  onSuccess?: (result?: unknown) => unknown;
  onError?: (error: Error) => unknown;
};

export type QueryOptions = {
  queryKey: unknown;
  queryFn?: () => unknown;
};

export const patientMcsEmptyResponsePayload = (patientId: string) => ({
  data: {
    patient: { id: patientId, name: '田中 一郎' },
    importedCount: 0,
    latestMessageAt: null,
    link: null,
    profile: null,
    summary: null,
    messages: [],
    checkLogs: [],
  },
});

export function createJsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function createLoadingMcsQueryResult() {
  return {
    data: {
      link: {
        sourceUrl: 'https://www.medical-care.net/patients/patient_1',
        projectTitle: '在宅支援プロジェクト',
        projectMemo: null,
        memberCount: 3,
        lastSyncAttemptAt: '2026-07-04T09:00:00.000Z',
        lastSyncedAt: null,
        lastSyncError: null,
      },
      profile: null,
      summary: null,
      messages: [
        {
          id: 'msg_1',
          sourceMessageId: 'source_1',
          authorName: '訪問看護 太郎',
          authorRole: '訪問看護',
          authorOrganization: '青葉訪問看護',
          authorDescriptor: null,
          postedAt: '2026-07-04T09:05:00.000Z',
          postedAtLabel: '2026/07/04 18:05',
          body: '訪問看護からのMCS本文。血圧と服薬状況の確認が必要です。',
          reactionCount: 0,
          replyCount: 0,
          sortOrder: null,
          sourceUrl: 'https://www.medical-care.net/messages/source_1',
          syncedAt: '2026-07-04T09:10:00.000Z',
        },
      ],
      checkLogs: [],
    },
    isLoading: true,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
}

export function createLinkedMcsQueryResult() {
  return {
    data: {
      link: {
        sourceUrl: 'https://www.medical-care.net/patients/2463520',
        patientUrl: 'https://www.medical-care.net/patients/2463520',
        projectUrl: 'https://www.medical-care.net/projects/medical/57886227',
        projectTitle: '田中一郎 在宅チーム',
        projectMemo: null,
        memberCount: 8,
        lastSyncAttemptAt: '2026-06-01T00:00:00.000Z',
        lastSyncedAt: '2026-06-01T00:00:00.000Z',
        lastSyncError: null,
      },
      profile: {
        linkedStatus: 'linked',
        participationStatus: 'joined',
        pharmacyParticipants: ['薬剤師 佐藤'],
        counterpartRoles: ['visiting_nurse'],
        lastCheckedAt: '2026-06-16T00:00:00.000Z',
        note: '毎朝確認',
        updatedAt: '2026-06-16T00:05:00.000Z',
      },
      summary: null,
      messages: [],
      checkLogs: [
        {
          id: 'mcs_log_1',
          subject: 'MCS 報告確認',
          content: '食欲低下の共有を確認',
          counterpartName: '田中一郎 在宅チーム',
          occurredAt: '2026-06-16T00:00:00.000Z',
          createdAt: '2026-06-16T00:01:00.000Z',
        },
      ],
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
}
