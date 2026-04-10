import type { HomeLinkContext, WorkflowFocus } from '@/lib/dashboard/home-link-builders';

type SearchParamRecord = Record<string, string | string[] | undefined> | null | undefined;

export type WorkflowInitialState = {
  initialFocus?: WorkflowFocus;
  initialContext?: HomeLinkContext | null;
};

export function readWorkflowState(params: SearchParamRecord): WorkflowInitialState {
  const focus = typeof params?.focus === 'string' ? params.focus : null;
  const context = typeof params?.context === 'string' ? params.context : null;

  return {
    initialFocus:
      focus === 'control_center' ||
      focus === 'communication' ||
      focus === 'workbench' ||
      focus === 'exceptions'
        ? focus
        : undefined,
    initialContext: context === 'dashboard_home' ? context : null,
  };
}
