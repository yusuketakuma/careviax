import type { ConferencesFocus } from '@/lib/dashboard/home-link-builders';

type SearchParamRecord = Record<string, string | string[] | undefined> | null | undefined;

export type ConferencesInitialState = {
  initialFocus?: ConferencesFocus;
  initialContext?: string | null;
  initialViewMode?: 'list' | 'calendar';
  initialNoteType?: 'all' | 'pre_discharge' | 'service_manager' | 'death_conference' | 'care_team';
};

export function readConferencesState(params: SearchParamRecord): ConferencesInitialState {
  const focus = typeof params?.focus === 'string' ? params.focus : null;
  const context = typeof params?.context === 'string' ? params.context : null;
  const view = typeof params?.view === 'string' ? params.view : null;
  const noteType = typeof params?.note_type === 'string' ? params.note_type : null;

  return {
    initialFocus: focus === 'notes' || focus === 'activities' ? focus : undefined,
    initialContext: context,
    initialViewMode: view === 'calendar' || view === 'list' ? view : undefined,
    initialNoteType:
      noteType === 'all' ||
      noteType === 'pre_discharge' ||
      noteType === 'service_manager' ||
      noteType === 'death_conference' ||
      noteType === 'care_team'
        ? noteType
        : undefined,
  };
}
