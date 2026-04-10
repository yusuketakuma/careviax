import type { ExternalFocus } from '@/lib/dashboard/home-link-builders';

type SearchParamRecord = Record<string, string | string[] | undefined> | null | undefined;

export type ExternalInitialState = {
  initialFocus?: ExternalFocus;
  initialContext?: string | null;
};

export function readExternalState(params: SearchParamRecord): ExternalInitialState {
  const focus = typeof params?.focus === 'string' ? params.focus : null;
  const context = typeof params?.context === 'string' ? params.context : null;

  return {
    initialFocus:
      focus === 'shares' || focus === 'self_reports' || focus === 'activities'
        ? focus
        : undefined,
    initialContext: context,
  };
}
