import { fireEvent, screen } from '@testing-library/react';
import { jsonResponse } from '@/test/fetch-test-utils';

export type QueryConfig = { queryKey: unknown[]; queryFn?: () => Promise<unknown> };

export function fillRequiredPatientFields() {
  fireEvent.change(screen.getByLabelText('氏名 *'), { target: { value: '山田 太郎' } });
  fireEvent.change(screen.getByLabelText('フリガナ *'), { target: { value: 'ヤマダ タロウ' } });
  fireEvent.change(screen.getByLabelText('生年月日 *'), { target: { value: '1950-01-01' } });
  fireEvent.change(screen.getByLabelText('性別 *'), { target: { value: 'male' } });
}

export function careTeamQueryResult(options: { queryKey: unknown[] }, includeBackup = false) {
  const key = options.queryKey[1];
  if (key === 'care-team-pharmacists') {
    return {
      data: [
        { id: 'ph1', name: '薬剤 太郎' },
        ...(includeBackup ? [{ id: 'ph2', name: '薬剤 次郎' }] : []),
      ],
      isLoading: false,
    };
  }
  if (key === 'care-team-staff') {
    return { data: [{ id: 'st1', name: '事務 花子' }], isLoading: false };
  }
  return { data: [], isLoading: false };
}

export function careTeamFailureQueryResult(
  options: { queryKey: unknown[] },
  pharmacistRefetch: () => unknown,
  staffRefetch: () => unknown,
  fallbackRefetch: () => unknown,
) {
  const key = options.queryKey[1];
  if (key === 'care-team-pharmacists') {
    return {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('薬剤師一覧の取得に失敗しました'),
      refetch: pharmacistRefetch,
    };
  }
  if (key === 'care-team-staff') {
    return {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('スタッフ一覧の取得に失敗しました'),
      refetch: staffRefetch,
    };
  }
  return { data: [], isLoading: false, isError: false, refetch: fallbackRefetch };
}

export function lookupFailureQueryResult(
  options: { queryKey: unknown[] },
  targetKey: string,
  message: string,
  refetch: () => unknown,
  fallbackRefetch: () => unknown,
) {
  if (options.queryKey[1] === targetKey) {
    return {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error(message),
      refetch,
    };
  }
  return { data: [], isLoading: false, isError: false, refetch: fallbackRefetch };
}

export function captureQueryConfig(
  configs: QueryConfig[],
  options: QueryConfig,
  refetch: () => unknown,
) {
  configs.push(options);
  return { data: [], isLoading: false, isError: false, refetch };
}

export async function lookupFetchResponse(input: RequestInfo | URL) {
  const url = String(input);
  if (url.includes('/org/members')) return jsonResponse({ data: [] });
  return jsonResponse({
    data: [],
    meta: {
      total_count: 0,
      visible_count: 0,
      hidden_count: 0,
      truncated: false,
      count_basis: url.includes('/service-areas')
        ? 'service_areas'
        : url.includes('/pharmacists')
          ? 'memberships'
          : 'facilities',
      filters_applied: {},
      limit: 100,
    },
  });
}

export const validPatientDefaults = {
  name: '山田 太郎',
  name_kana: 'ヤマダ タロウ',
  birth_date: '1950-01-01',
  gender: 'male',
};

export const duplicatePatientResponse = {
  ok: false,
  status: 409,
  json: async () => ({
    message: '重複',
    details: {
      duplicate_type: 'patient_identity',
      duplicates: [
        {
          id: 'patient_existing',
          name: '山田 太郎',
          name_kana: 'ヤマダ タロウ',
          birth_date: '1950-01-01T00:00:00.000Z',
          gender: 'male',
        },
      ],
    },
  }),
} as Response;
