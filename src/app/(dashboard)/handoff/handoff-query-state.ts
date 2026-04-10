import type { HandoffFilter } from '@/lib/dashboard/home-link-builders';

type SearchParamRecord = Record<string, string | string[] | undefined> | null | undefined;

export type HandoffInitialState = {
  initialDate?: string;
  initialFilter?: HandoffFilter;
  initialContext?: string | null;
};

export function readHandoffState(params: SearchParamRecord): HandoffInitialState {
  const date = typeof params?.date === 'string' ? params.date : null;
  const filter = typeof params?.filter === 'string' ? params.filter : null;
  const context = typeof params?.context === 'string' ? params.context : null;

  return {
    initialDate: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined,
    initialFilter: filter === 'unread' || filter === 'all' ? filter : undefined,
    initialContext: context,
  };
}
