'use client';

import { useQuery } from '@tanstack/react-query';
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { buildNavBadgesApiPath } from '@/lib/nav-badges/api-paths';

const NAV_BADGE_REFETCH_INTERVAL_MS = 60_000;

/** href → 件数。undefined はバッジ非表示(0 件 or 取得失敗)。 */
export type NavBadgeCounts = Record<string, number | undefined>;

type NavBadgeApiPayload = {
  data?: {
    audit?: number;
    handoff?: number;
  };
};

type HandoffBoardItemSummary = {
  created_by?: string | null;
  read_by?: string[] | null;
};

/**
 * 自分が関与するハンドオフ件数 = 自分が渡した項目 + 自分が未確認の項目。
 * (現行 HandoffItem には宛先が無いため created_by / read_by から導出する)
 */
export function countMyHandoffItems(
  items: HandoffBoardItemSummary[],
  userId: string | null,
): number {
  if (!userId) return 0;
  return items.filter(
    (item) => item.created_by === userId || !(item.read_by ?? []).includes(userId),
  ).length;
}

export function toBadgeCount(value: number | undefined): number | undefined {
  return typeof value === 'number' && value > 0 ? value : undefined;
}

/**
 * サイドバーの動的バッジ件数(監査 = 自分の監査キュー、ハンドオフ = 自分関与件数)。
 * 取得失敗時は undefined を返してバッジを出さない(エラーは UI に出さない)。
 */
export function useNavBadges(): NavBadgeCounts {
  const orgId = useOrgId();

  const badgeQuery = useQuery({
    queryKey: ['nav-badges', orgId],
    queryFn: async () => {
      const res = await fetch(buildNavBadgesApiPath(), {
        headers: buildOrgHeaders(orgId),
      });
      if (!res.ok) throw new Error('ナビゲーションバッジ件数の取得に失敗しました');
      const payload = await readApiJson<NavBadgeApiPayload>(
        res,
        'ナビゲーションバッジ件数の取得に失敗しました',
      );
      return payload.data ?? {};
    },
    enabled: Boolean(orgId),
    staleTime: NAV_BADGE_REFETCH_INTERVAL_MS,
    refetchInterval: NAV_BADGE_REFETCH_INTERVAL_MS,
    retry: false,
  });

  return {
    '/audit': toBadgeCount(badgeQuery.data?.audit),
    '/handoff': toBadgeCount(badgeQuery.data?.handoff),
  };
}
