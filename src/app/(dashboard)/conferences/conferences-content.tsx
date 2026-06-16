'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  Plus,
  Users,
  ArrowRight,
  Calendar,
  ListChecks,
  FilePlus2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { fetchAllCursorPages } from '@/lib/api/cursor-pagination-client';
import { sectionTemplatesFor, type StructuredSectionDraft } from './conference-note-templates';
import { SectionIntro } from '@/components/ui/section-intro';
import { PageSection } from '@/components/layout/page-section';
import { ActionRail } from '@/components/ui/action-rail';
import { cn } from '@/lib/utils';
import type { ConferencesFocus } from '@/lib/dashboard/home-link-builders';
import { useSyncedSearchParams } from '@/lib/navigation/use-synced-search-params';

type Participant = {
  name: string;
  role: string;
  external_professional_id?: string;
  attended?: boolean;
  is_report_recipient?: boolean;
  email?: string;
  fax?: string;
};

type ParticipantDraft = Participant & {
  external_professional_id?: string;
};

type ExternalProfessionalOption = {
  id: string;
  profession_type: string;
  name: string;
  organization_name: string | null;
  department: string | null;
  phone: string | null;
  email: string | null;
  fax: string | null;
};

type PrescriberInstitutionSuggestion = {
  id: string;
  name: string;
  phone: string | null;
  fax: string | null;
  address: string | null;
  prescribed_date: string;
  prescriber_name: string | null;
};

type ActionItem = {
  title: string;
  assignee?: string;
  converted_task_id?: string;
  converted_at?: string;
};

const NOTE_TYPE_LABELS: Record<string, string> = {
  regular: '定例会議',
  pre_discharge: '退院前',
  service_manager: '担当者会議',
  care_team: '担当者ミーティング',
  emergency: '緊急',
  death_conference: 'デスカンファ',
};

type ConferenceNote = {
  id: string;
  note_type:
    | 'regular'
    | 'pre_discharge'
    | 'service_manager'
    | 'care_team'
    | 'emergency'
    | 'death_conference';
  title: string;
  content: string;
  participants: Participant[];
  conference_date: string;
  action_items: ActionItem[] | null;
  case_id: string | null;
  patient_id?: string | null;
  sync_summary?: {
    report_draft_ids?: string[];
    billing_candidate_id?: string | null;
    visit_proposal_id?: string | null;
    tasks_created?: number;
    medication_issues_created?: number;
  } | null;
  generated_report_id?: string | null;
  created_at: string;
};

type CommunityActivity = {
  id: string;
  activity_type: string;
  title: string;
  description: string | null;
  partner_name: string | null;
  activity_date: string;
  target_population: string | null;
  attendee_count: number | null;
  referrals_generated: number | null;
  follow_up_required: boolean;
  outcome_summary: string | null;
  created_at: string;
};

const PROFESSION_LABELS: Record<string, string> = {
  physician: '医師',
  nurse: '看護師',
  care_manager: 'ケアマネジャー',
  medical_social_worker: '医療ソーシャルワーカー',
  physical_therapist: '理学療法士',
  occupational_therapist: '作業療法士',
  speech_therapist: '言語聴覚士',
  registered_dietitian: '管理栄養士',
  dentist: '歯科医師',
  dental_hygienist: '歯科衛生士',
  home_helper: 'ホームヘルパー',
  care_staff: '介護職',
  other: 'その他',
};

function getConferenceReportDraftIds(
  note: Pick<ConferenceNote, 'sync_summary' | 'generated_report_id'>,
) {
  return Array.from(
    new Set([
      ...(note.sync_summary?.report_draft_ids ?? []),
      ...(note.generated_report_id ? [note.generated_report_id] : []),
    ]),
  );
}

function NoteCard({
  note,
  onConvertToTask,
  onGenerateReport,
  generating,
}: {
  note: ConferenceNote;
  onConvertToTask: (note: ConferenceNote, item: ActionItem) => void;
  onGenerateReport: (note: ConferenceNote) => void;
  generating: boolean;
}) {
  const dateStr = format(parseISO(note.conference_date), 'yyyy年M月d日(E) HH:mm', {
    locale: ja,
  });

  const pendingActionCount = (note.action_items ?? []).filter(
    (item) => !item.converted_task_id,
  ).length;
  const hasPending = pendingActionCount > 0;
  const reportDraftIds = getConferenceReportDraftIds(note);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base">{note.title}</CardTitle>
          {hasPending ? (
            <Badge className="shrink-0 bg-amber-100 text-amber-900 hover:bg-amber-100">
              未処理 {pendingActionCount}件
            </Badge>
          ) : note.action_items && note.action_items.length > 0 ? (
            <Badge variant="outline" className="shrink-0 text-xs text-muted-foreground">
              完了
            </Badge>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Calendar className="size-3.5" aria-hidden="true" />
            {dateStr}
          </span>
          <span className="flex items-center gap-1">
            <Users className="size-3.5" aria-hidden="true" />
            {note.participants.map((item) => item.name).join('、')}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="whitespace-pre-line text-sm text-foreground">{note.content}</p>

        {note.participants.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {note.participants.map((item, index) => (
              <Badge key={`${item.name}-${index}`} variant="outline" className="text-xs">
                {item.name}（{item.role}）
              </Badge>
            ))}
          </div>
        ) : null}

        {note.action_items && note.action_items.length > 0 ? (
          <div className="space-y-1.5">
            <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <ListChecks className="size-3.5" aria-hidden="true" />
              アクションアイテム
            </p>
            <ul className="space-y-1.5" role="list">
              {note.action_items.map((item, index) => (
                <li
                  key={`${item.title}-${index}`}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-1.5"
                >
                  <div className="min-w-0">
                    <span className="text-sm">{item.title}</span>
                    {item.assignee ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        担当: {item.assignee}
                      </span>
                    ) : null}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={Boolean(item.converted_task_id)}
                    className="h-6 shrink-0 px-2 text-xs text-blue-700 hover:bg-blue-50"
                    onClick={() => onConvertToTask(note, item)}
                  >
                    <ArrowRight className="mr-1 size-3" aria-hidden="true" />
                    {item.converted_task_id ? 'タスク化済み' : 'タスク化'}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {note.note_type === 'pre_discharge' ||
        note.note_type === 'service_manager' ||
        note.note_type === 'death_conference' ||
        note.note_type === 'care_team' ? (
          <div className="space-y-3">
            {note.sync_summary || note.generated_report_id ? (
              <div className="rounded-md border border-sky-200 bg-sky-50/50 p-3">
                <p className="text-xs font-medium text-sky-900">保存後アクション</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge variant="outline">報告書ドラフト {reportDraftIds.length}件</Badge>
                  <Badge variant="outline">
                    タスク化 {note.sync_summary?.tasks_created ?? 0}件
                  </Badge>
                  <Badge variant="outline">
                    薬学課題 {note.sync_summary?.medication_issues_created ?? 0}件
                  </Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {reportDraftIds.length > 0 ? (
                    <Link
                      href="/reports"
                      className="inline-flex min-h-[44px] items-center rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted sm:min-h-0"
                    >
                      報告書を確認
                    </Link>
                  ) : null}
                  {reportDraftIds.map((reportId, index) => (
                    <Link
                      key={reportId}
                      href={`/reports/${reportId}`}
                      className="inline-flex min-h-[44px] items-center rounded-lg border border-sky-200 bg-background px-3 py-1.5 text-xs font-medium text-sky-900 hover:bg-sky-50 sm:min-h-0"
                    >
                      ドラフト{index + 1}
                    </Link>
                  ))}
                  {note.sync_summary?.billing_candidate_id ? (
                    <Link
                      href="/billing/candidates"
                      className="inline-flex min-h-[44px] items-center rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted sm:min-h-0"
                    >
                      算定候補を確認
                    </Link>
                  ) : null}
                  {note.sync_summary?.visit_proposal_id ? (
                    <Link
                      href={`/schedules/proposals?case_id=${note.case_id ?? ''}&patient_id=${note.patient_id ?? ''}&focus=patient`}
                      className="inline-flex min-h-[44px] items-center rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted sm:min-h-0"
                    >
                      訪問候補を確認
                    </Link>
                  ) : note.case_id || note.patient_id ? (
                    <Link
                      href={`/schedules/proposals?case_id=${note.case_id ?? ''}&patient_id=${note.patient_id ?? ''}&focus=patient`}
                      className="inline-flex min-h-[44px] items-center rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted sm:min-h-0"
                    >
                      訪問候補を作成
                    </Link>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="flex justify-end">
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/api/conference-notes/${note.id}/pdf`}
                  target="_blank"
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-border px-2 text-xs font-medium hover:bg-muted sm:h-7 sm:min-h-0 sm:min-w-0"
                >
                  PDF
                </Link>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  onClick={() => onGenerateReport(note)}
                  disabled={generating}
                >
                  <FilePlus2 className="mr-1 size-3.5" aria-hidden="true" />
                  {generating ? '生成中...' : '報告書を生成'}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SummaryNoteCard({
  note,
  selected,
  loading,
  onSelect,
}: {
  note: ConferenceNote;
  selected: boolean;
  loading: boolean;
  onSelect: (noteId: string) => void;
}) {
  const dateStr = format(parseISO(note.conference_date), 'yyyy年M月d日(E) HH:mm', {
    locale: ja,
  });
  const reportCount = new Set([
    ...(note.sync_summary?.report_draft_ids ?? []),
    ...(note.generated_report_id ? [note.generated_report_id] : []),
  ]).size;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">{note.title}</CardTitle>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Calendar className="size-3.5" aria-hidden="true" />
                {dateStr}
              </span>
              <span>{NOTE_TYPE_LABELS[note.note_type] ?? note.note_type}</span>
              {note.participants.length > 0 ? (
                <span className="flex items-center gap-1">
                  <Users className="size-3.5" aria-hidden="true" />
                  {note.participants.map((item) => item.name).join('、')}
                </span>
              ) : null}
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant={selected ? 'secondary' : 'outline'}
            onClick={() => onSelect(note.id)}
            disabled={loading}
          >
            {loading ? '読込中' : selected ? '詳細表示中' : '詳細を開く'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-1.5">
          {reportCount > 0 ? <Badge variant="outline">報告書 {reportCount}件</Badge> : null}
          {note.sync_summary?.billing_candidate_id ? (
            <Badge variant="outline">算定候補あり</Badge>
          ) : null}
          {note.sync_summary?.visit_proposal_id ? (
            <Badge variant="outline">訪問候補あり</Badge>
          ) : null}
          {note.sync_summary?.tasks_created ? (
            <Badge variant="outline">タスク {note.sync_summary.tasks_created}件</Badge>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function ActivityCard({ activity }: { activity: CommunityActivity }) {
  const dateStr = format(parseISO(activity.activity_date), 'yyyy年M月d日(E) HH:mm', {
    locale: ja,
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{activity.title}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {activity.activity_type}
              {activity.partner_name ? ` / ${activity.partner_name}` : ''}
            </p>
          </div>
          {activity.follow_up_required ? (
            <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">要フォロー</Badge>
          ) : (
            <Badge variant="outline">完了</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-xs text-muted-foreground">{dateStr}</div>
        {activity.description ? (
          <p className="whitespace-pre-line text-sm text-foreground">{activity.description}</p>
        ) : null}
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">対象</p>
            <p>{activity.target_population ?? '未設定'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">参加者数</p>
            <p>{activity.attendee_count ?? 0}名</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">紹介件数</p>
            <p>{activity.referrals_generated ?? 0}件</p>
          </div>
        </div>
        {activity.outcome_summary ? (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
            {activity.outcome_summary}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ConferencesContent({
  initialFocus,
  initialContext,
  initialViewMode = 'list',
  initialNoteType = 'all',
}: {
  initialFocus?: ConferencesFocus;
  initialContext?: string | null;
  initialViewMode?: 'list' | 'calendar';
  initialNoteType?: 'all' | 'pre_discharge' | 'service_manager' | 'death_conference' | 'care_team';
} = {}) {
  const replaceConferencesUrl = useSyncedSearchParams();
  const orgId = useOrgId();
  const isBootstrappingOrg = !orgId;
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const contextPatientId = searchParams.get('patient_id')?.trim() || '';
  const contextCaseId = searchParams.get('case_id')?.trim() || '';
  const [newNoteOpen, setNewNoteOpen] = useState(false);
  const [newActivityOpen, setNewActivityOpen] = useState(false);
  const [reportDialogNote, setReportDialogNote] = useState<ConferenceNote | null>(null);
  const [reportTypeDraft, setReportTypeDraft] = useState('internal_record');
  const [autoSendReport, setAutoSendReport] = useState(false);
  const [includeStructuredInReport, setIncludeStructuredInReport] = useState(true);
  const [noteViewMode, setNoteViewMode] = useState<'list' | 'calendar'>(initialViewMode);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<Date | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [selectedNoteType, setSelectedNoteType] = useState<
    'all' | 'pre_discharge' | 'service_manager' | 'death_conference' | 'care_team'
  >(initialNoteType);
  const [lastSyncSummary, setLastSyncSummary] = useState<{
    title: string;
    caseId?: string | null;
    patientId?: string | null;
    reportDraftIds?: string[];
    billingCandidateId?: string;
    visitProposalId?: string;
    tasksCreated?: number;
    medicationIssuesCreated?: number;
  } | null>(null);

  const [noteType, setNoteType] = useState<ConferenceNote['note_type']>('regular');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [conferenceDate, setConferenceDate] = useState('');
  const [structuredSectionDraftStore, setStructuredSectionDraftStore] = useState<
    Partial<Record<ConferenceNote['note_type'], Record<string, string>>>
  >({});
  const [structuredSectionDrafts, setStructuredSectionDrafts] = useState<StructuredSectionDraft[]>(
    () => sectionTemplatesFor('regular'),
  );
  const [participantDrafts, setParticipantDrafts] = useState<ParticipantDraft[]>([
    { name: '', role: '', attended: true, is_report_recipient: false },
  ]);
  const [actionItemsRaw, setActionItemsRaw] = useState('');

  const [activityType, setActivityType] = useState('');
  const [activityTitle, setActivityTitle] = useState('');
  const [activityDescription, setActivityDescription] = useState('');
  const [partnerName, setPartnerName] = useState('');
  const [activityDate, setActivityDate] = useState('');
  const [targetPopulation, setTargetPopulation] = useState('');
  const [attendeeCount, setAttendeeCount] = useState('');
  const [referralsGenerated, setReferralsGenerated] = useState('');
  const [outcomeSummary, setOutcomeSummary] = useState('');

  const notesQuery = useQuery({
    queryKey: ['conference-notes', orgId, selectedNoteType, contextPatientId, contextCaseId],
    queryFn: async () => {
      const params = new URLSearchParams({
        detail_level: 'summary',
      });
      if (selectedNoteType !== 'all') {
        params.set('conference_type', selectedNoteType);
      }
      if (contextPatientId) {
        params.set('patient_id', contextPatientId);
      }
      if (contextCaseId) {
        params.set('case_id', contextCaseId);
      }
      return fetchAllCursorPages<ConferenceNote>({
        path: '/api/conference-notes',
        params,
        init: {
          headers: { 'x-org-id': orgId },
        },
        errorMessage: 'カンファレンスノートの取得に失敗しました',
      });
    },
    enabled: !!orgId,
  });

  const selectedNoteDetailQuery = useQuery({
    queryKey: ['conference-note-detail', orgId, selectedNoteId],
    queryFn: async () => {
      if (!selectedNoteId) return null;
      const response = await fetch(`/api/conference-notes/${selectedNoteId}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('カンファレンスノート詳細の取得に失敗しました');
      const payload = (await response.json()) as { data: ConferenceNote };
      return payload.data;
    },
    enabled: Boolean(orgId && selectedNoteId),
  });

  const activitiesQuery = useQuery({
    queryKey: ['community-activities', orgId],
    queryFn: async () => {
      return fetchAllCursorPages<CommunityActivity>({
        path: '/api/community-activities',
        init: {
          headers: { 'x-org-id': orgId },
        },
        errorMessage: '地域活動の取得に失敗しました',
      });
    },
    enabled: !!orgId,
  });

  const externalProfessionalsQuery = useQuery({
    queryKey: ['conference-external-professionals', orgId],
    queryFn: async () => {
      const response = await fetch('/api/admin/external-professionals', {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('他職種マスターの取得に失敗しました');
      return response.json() as Promise<{ data: ExternalProfessionalOption[] }>;
    },
    enabled: !!orgId,
  });

  const conferenceCalendarQuery = useQuery({
    queryKey: [
      'conference-notes-calendar',
      orgId,
      selectedNoteType,
      contextPatientId,
      contextCaseId,
      format(calendarMonth, 'yyyy-MM'),
    ],
    queryFn: async () => {
      const monthStart = startOfMonth(calendarMonth);
      const monthEnd = endOfMonth(calendarMonth);
      const params = new URLSearchParams({
        date_from: format(monthStart, 'yyyy-MM-dd'),
        date_to: format(monthEnd, 'yyyy-MM-dd'),
        detail_level: 'summary',
      });
      if (selectedNoteType !== 'all') {
        params.set('conference_type', selectedNoteType);
      }
      if (contextPatientId) {
        params.set('patient_id', contextPatientId);
      }
      if (contextCaseId) {
        params.set('case_id', contextCaseId);
      }
      return fetchAllCursorPages<ConferenceNote>({
        path: '/api/conference-notes',
        params,
        init: {
          headers: { 'x-org-id': orgId },
        },
        errorMessage: 'カレンダー用カンファレンス記録の取得に失敗しました',
      });
    },
    enabled: !!orgId,
  });

  const prescriberInstitutionSuggestionQuery = useQuery({
    queryKey: [
      'conference-prescriber-institution-suggestion',
      orgId,
      contextPatientId,
      contextCaseId,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (contextPatientId) {
        params.set('patient_id', contextPatientId);
      }
      if (contextCaseId) {
        params.set('case_id', contextCaseId);
      }
      const response = await fetch(`/api/prescriber-institutions/suggestion?${params.toString()}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('処方元医療機関候補の取得に失敗しました');
      return response.json() as Promise<{ data: PrescriberInstitutionSuggestion | null }>;
    },
    enabled: !!orgId && (!!contextPatientId || !!contextCaseId),
  });

  const createNoteMutation = useMutation({
    mutationFn: async (payload: object) => {
      const response = await fetch('/api/conference-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error('作成に失敗しました');
      return response.json() as Promise<{
        data: ConferenceNote;
        sync?: {
          report_draft_ids?: string[];
          billing_candidate_id?: string;
          visit_proposal_id?: string;
          tasks_created?: number;
          medication_issues_created?: number;
        };
      }>;
    },
    onSuccess: (payload) => {
      queryClient.invalidateQueries({ queryKey: ['conference-notes', orgId] });
      queryClient.invalidateQueries({ queryKey: ['conference-notes-calendar', orgId] });
      if (contextPatientId) {
        queryClient.invalidateQueries({
          queryKey: ['patient-home-operations', contextPatientId, orgId],
        });
      }
      setNewNoteOpen(false);
      resetNoteForm();
      toast.success('カンファレンスノートを作成しました');
      setLastSyncSummary({
        title: payload.data.title,
        caseId: payload.data.case_id ?? null,
        patientId: payload.data.patient_id ?? null,
        reportDraftIds: payload.sync?.report_draft_ids,
        billingCandidateId: payload.sync?.billing_candidate_id,
        visitProposalId: payload.sync?.visit_proposal_id,
        tasksCreated: payload.sync?.tasks_created,
        medicationIssuesCreated: payload.sync?.medication_issues_created,
      });
    },
    onError: () => toast.error('カンファレンスノートの作成に失敗しました'),
  });

  const createActivityMutation = useMutation({
    mutationFn: async (payload: object) => {
      const response = await fetch('/api/community-activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error('作成に失敗しました');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['community-activities', orgId] });
      setNewActivityOpen(false);
      resetActivityForm();
      toast.success('地域活動を登録しました');
    },
    onError: () => toast.error('地域活動の登録に失敗しました'),
  });

  const convertActionItemMutation = useMutation({
    mutationFn: async ({
      noteId,
      actionItemIndex,
    }: {
      noteId: string;
      actionItemIndex: number;
    }) => {
      const response = await fetch(`/api/conference-notes/${noteId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({ action_item_index: actionItemIndex }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message ?? 'タスク化に失敗しました');
      }
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['conference-notes', orgId] });
      await queryClient.invalidateQueries({ queryKey: ['conference-notes-calendar', orgId] });
      if (selectedNoteId) {
        await queryClient.invalidateQueries({
          queryKey: ['conference-note-detail', orgId, selectedNoteId],
        });
      }
      await queryClient.invalidateQueries({ queryKey: ['tasks', orgId] });
      toast.success('アクションアイテムをタスク化しました');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const generateReportMutation = useMutation({
    mutationFn: async ({
      note,
      reportType,
      autoSend,
      includeStructuredContent,
    }: {
      note: ConferenceNote;
      reportType: string;
      autoSend: boolean;
      includeStructuredContent: boolean;
    }) => {
      const response = await fetch(`/api/conference-notes/${note.id}/generate-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({
          report_type: reportType,
          auto_send: autoSend,
          include_structured_content: includeStructuredContent,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message ?? '報告書生成に失敗しました');
      }
      return response.json() as Promise<{
        data: {
          report_draft_ids: string[];
          queued_recipients?: Array<{
            report_id: string;
            name: string;
            channel: string;
          }>;
        };
      }>;
    },
    onSuccess: (payload) => {
      toast.success(
        `報告書ドラフトを${payload.data.report_draft_ids.length}件生成しました${
          payload.data.queued_recipients?.length
            ? ` / 送付下書き ${payload.data.queued_recipients.length}件`
            : ''
        }`,
      );
      const generatedForNoteId = reportDialogNote?.id ?? null;
      setReportDialogNote(null);
      queryClient.invalidateQueries({ queryKey: ['conference-notes', orgId] });
      queryClient.invalidateQueries({ queryKey: ['conference-notes-calendar', orgId] });
      if (generatedForNoteId) {
        queryClient.invalidateQueries({
          queryKey: ['conference-note-detail', orgId, generatedForNoteId],
        });
      }
      queryClient.invalidateQueries({ queryKey: ['care-reports', orgId] });
      queryClient.invalidateQueries({ queryKey: ['care-report-analytics', orgId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function resetNoteForm() {
    setNoteType('regular');
    setTitle('');
    setContent('');
    setConferenceDate('');
    setStructuredSectionDraftStore({});
    setStructuredSectionDrafts(sectionTemplatesFor('regular'));
    setParticipantDrafts([{ name: '', role: '', attended: true, is_report_recipient: false }]);
    setActionItemsRaw('');
  }

  function handleNoteTypeChange(value: ConferenceNote['note_type']) {
    const nextDraftStore = {
      ...structuredSectionDraftStore,
      [noteType]: Object.fromEntries(
        structuredSectionDrafts.map((section) => [section.key, section.body]),
      ),
    };
    setNoteType(value);
    setStructuredSectionDraftStore(nextDraftStore);
    setStructuredSectionDrafts(
      sectionTemplatesFor(value).map((section) => ({
        ...section,
        body: nextDraftStore[value]?.[section.key] ?? '',
      })),
    );
  }

  function resetActivityForm() {
    setActivityType('');
    setActivityTitle('');
    setActivityDescription('');
    setPartnerName('');
    setActivityDate('');
    setTargetPopulation('');
    setAttendeeCount('');
    setReferralsGenerated('');
    setOutcomeSummary('');
  }

  function handleCreateNote() {
    const structuredSections = structuredSectionDrafts
      .map((section) => ({
        key: section.key,
        label: section.label,
        body: section.body.trim(),
      }))
      .filter((section) => section.body.length > 0);

    if (!title.trim() || !conferenceDate || (!content.trim() && structuredSections.length === 0)) {
      toast.error('タイトル・日時・内容または構造化項目を入力してください');
      return;
    }

    const participants: Participant[] = participantDrafts
      .map((item) => ({
        name: item.name.trim(),
        role: item.role.trim(),
        attended: item.attended ?? true,
        is_report_recipient: item.is_report_recipient ?? false,
        external_professional_id: item.external_professional_id,
        email: item.email?.trim() || undefined,
        fax: item.fax?.trim() || undefined,
      }))
      .filter((item) => item.name);

    const actionItems: ActionItem[] = actionItemsRaw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [titleValue, assignee] = line.split('/').map((item) => item.trim());
        return {
          title: titleValue ?? line,
          ...(assignee ? { assignee } : {}),
        };
      });

    createNoteMutation.mutate({
      note_type: noteType,
      conference_type: noteType,
      title,
      ...(contextPatientId ? { patient_id: contextPatientId } : {}),
      ...(contextCaseId ? { case_id: contextCaseId } : {}),
      ...(content.trim() ? { content } : {}),
      conference_date: new Date(conferenceDate).toISOString(),
      participants,
      ...(structuredSections.length > 0
        ? {
            structured_content: {
              template: noteType,
              sections: structuredSections,
            },
          }
        : {}),
      ...(actionItems.length > 0 ? { action_items: actionItems } : {}),
    });
  }

  function handleCreateActivity() {
    if (!activityType.trim() || !activityTitle.trim() || !activityDate) {
      toast.error('活動種別・タイトル・実施日時は必須です');
      return;
    }

    createActivityMutation.mutate({
      activity_type: activityType,
      title: activityTitle,
      description: activityDescription || undefined,
      partner_name: partnerName || undefined,
      activity_date: new Date(activityDate).toISOString(),
      target_population: targetPopulation || undefined,
      attendee_count: attendeeCount ? Number(attendeeCount) : undefined,
      referrals_generated: referralsGenerated ? Number(referralsGenerated) : undefined,
      follow_up_required: true,
      outcome_summary: outcomeSummary || undefined,
    });
  }

  function handleConvertToTask(note: ConferenceNote, item: ActionItem) {
    if (item.converted_task_id) {
      toast.info('このアクションアイテムは既にタスク化されています');
      return;
    }

    const index = (note.action_items ?? []).findIndex(
      (candidate) => candidate.title === item.title && candidate.assignee === item.assignee,
    );
    if (index < 0) {
      toast.error('アクションアイテムを特定できませんでした');
      return;
    }

    convertActionItemMutation.mutate({
      noteId: note.id,
      actionItemIndex: index,
    });
  }

  function reportTypeOptions(note: ConferenceNote) {
    switch (note.note_type) {
      case 'pre_discharge':
        return [{ value: 'physician_report', label: '医師向け報告書' }];
      case 'service_manager':
        return [{ value: 'care_manager_report', label: 'ケアマネ向け報告書' }];
      case 'emergency':
        return [
          { value: 'physician_report', label: '医師向け報告書' },
          { value: 'internal_record', label: '内部記録' },
        ];
      default:
        return [{ value: 'internal_record', label: '内部記録' }];
    }
  }

  function handleGenerateReport(note: ConferenceNote) {
    const options = reportTypeOptions(note);
    setReportTypeDraft(options[0]?.value ?? 'internal_record');
    setAutoSendReport(false);
    setIncludeStructuredInReport(true);
    setReportDialogNote(note);
  }

  function handleConfirmGenerateReport() {
    if (!reportDialogNote) return;
    generateReportMutation.mutate({
      note: reportDialogNote,
      reportType: reportTypeDraft,
      autoSend: autoSendReport,
      includeStructuredContent: includeStructuredInReport,
    });
  }

  const notes = notesQuery.data?.data ?? [];
  const calendarNotes = conferenceCalendarQuery.data?.data ?? [];
  const activities = activitiesQuery.data?.data ?? [];
  const contextSummary =
    initialContext === 'dashboard_home'
      ? initialFocus === 'activities'
        ? 'ホームから地域活動と紹介導線にフォーカスして開いています。'
        : 'ホームからカンファレンス記録にフォーカスして開いています。'
      : initialContext === 'patient_detail'
        ? '患者詳細からこの患者のカンファレンス記録にフォーカスして開いています。'
        : null;
  const externalProfessionals = externalProfessionalsQuery.data?.data ?? [];
  const prescriberInstitutionSuggestion = prescriberInstitutionSuggestionQuery.data?.data ?? null;
  const calendarMonthStart = startOfMonth(calendarMonth);
  const calendarMonthEnd = endOfMonth(calendarMonth);
  const calendarDays = eachDayOfInterval({
    start: startOfWeek(calendarMonthStart, { weekStartsOn: 1 }),
    end: endOfWeek(calendarMonthEnd, { weekStartsOn: 1 }),
  });
  const calendarNotesByDate = new Map<string, ConferenceNote[]>();
  for (const note of calendarNotes) {
    const key = note.conference_date.slice(0, 10);
    const bucket = calendarNotesByDate.get(key);
    if (bucket) {
      bucket.push(note);
    } else {
      calendarNotesByDate.set(key, [note]);
    }
  }
  const selectedCalendarNotes = selectedCalendarDate
    ? (calendarNotesByDate.get(format(selectedCalendarDate, 'yyyy-MM-dd')) ?? [])
    : [];

  function updateParticipantAt(
    index: number,
    updater: (draft: ParticipantDraft) => ParticipantDraft,
  ) {
    setParticipantDrafts((current) =>
      current.map((draft, draftIndex) => (draftIndex === index ? updater(draft) : draft)),
    );
  }

  function applyExternalProfessional(index: number, externalProfessionalId: string) {
    const match = externalProfessionals.find((item) => item.id === externalProfessionalId);
    if (!match) {
      updateParticipantAt(index, (draft) => ({
        ...draft,
        external_professional_id: undefined,
        ...(externalProfessionalId
          ? {}
          : {
              name: '',
              role: '',
              email: undefined,
              fax: undefined,
            }),
      }));
      return;
    }

    updateParticipantAt(index, (draft) => ({
      ...draft,
      external_professional_id: match.id,
      name: match.name,
      role: conferenceRoleLabel(match.profession_type, match.organization_name),
      email: match.email ?? undefined,
      fax: match.fax ?? undefined,
    }));
  }

  function appendPrescriberInstitutionParticipant() {
    if (!prescriberInstitutionSuggestion) return;

    const suggestedName =
      prescriberInstitutionSuggestion.prescriber_name ?? prescriberInstitutionSuggestion.name;
    const alreadyExists = participantDrafts.some(
      (participant) =>
        participant.name.trim() === suggestedName &&
        (participant.fax?.trim() || '') === (prescriberInstitutionSuggestion.fax ?? ''),
    );
    if (alreadyExists) {
      toast.info('処方元医療機関候補は既に参加者に追加されています');
      return;
    }

    setParticipantDrafts((current) => [
      ...current,
      {
        name: suggestedName,
        role: `処方元医療機関 / ${prescriberInstitutionSuggestion.name}`,
        attended: true,
        is_report_recipient: false,
        fax: prescriberInstitutionSuggestion.fax ?? undefined,
      },
    ]);
  }

  return (
    <div className="space-y-6">
      {contextSummary ? (
        <Alert
          className="border-sky-200 bg-sky-50 text-sky-900"
          data-testid="conferences-context-banner"
        >
          <Users className="size-4 text-sky-700" aria-hidden="true" />
          <AlertDescription className="text-sky-800">{contextSummary}</AlertDescription>
        </Alert>
      ) : null}
      <SectionIntro
        title="会議と活動の入口"
        description="カンファレンス記録と地域活動の件数を先に確認し、どちらに着手するかを最初に判断します。"
      />
      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <Card className="border-slate-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">多職種カンファレンス</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4 text-sm">
            <div>
              <p className="font-medium">{notes.length}件の記録</p>
              <p className="text-muted-foreground">
                医師・看護師・ケアマネとの情報共有を一元管理します。
              </p>
            </div>
            <Button size="sm" onClick={() => setNewNoteOpen(true)}>
              <Plus className="mr-1.5 size-3.5" aria-hidden="true" />
              新規記録
            </Button>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">地域活動</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4 text-sm">
            <div>
              <p className="font-medium">{activities.length}件の活動</p>
              <p className="text-muted-foreground">
                勉強会・地域連携・相談会の実績と紹介導線を記録します。
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setNewActivityOpen(true)}>
              <Plus className="mr-1.5 size-3.5" aria-hidden="true" />
              活動登録
            </Button>
          </CardContent>
        </Card>
      </div>

      {isBootstrappingOrg ||
      notesQuery.isLoading ||
      activitiesQuery.isLoading ||
      (noteViewMode === 'calendar' && conferenceCalendarQuery.isLoading) ? (
        <div className="space-y-2">
          {[1, 2].map((item) => (
            <div key={item} className="h-32 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : null}

      <PageSection
        title="カンファレンス記録"
        description="会議記録は一覧またはカレンダーで確認し、タスク化や報告書生成へつなげます。"
        className={cn(initialFocus === 'notes' ? 'rounded-2xl ring-2 ring-primary/25' : null)}
        contentClassName="space-y-4"
        actions={
          <ActionRail>
            <div className="flex rounded-lg border border-border bg-background p-1">
              <button
                type="button"
                aria-pressed={noteViewMode === 'list'}
                className={`min-h-11 min-w-11 rounded-md px-3 py-1 text-xs font-medium sm:min-h-0 sm:min-w-0 ${
                  noteViewMode === 'list'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground'
                }`}
                onClick={() => {
                  setNoteViewMode('list');
                  replaceConferencesUrl({ view: null });
                }}
              >
                一覧
              </button>
              <button
                type="button"
                aria-pressed={noteViewMode === 'calendar'}
                className={`min-h-11 min-w-11 rounded-md px-3 py-1 text-xs font-medium sm:min-h-0 sm:min-w-0 ${
                  noteViewMode === 'calendar'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground'
                }`}
                onClick={() => {
                  setNoteViewMode('calendar');
                  replaceConferencesUrl({ view: 'calendar' });
                }}
              >
                カレンダー
              </button>
            </div>
          </ActionRail>
        }
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">
              {noteViewMode === 'calendar' ? `${calendarNotes.length}件` : `${notes.length}件`}
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:items-end">
            <Tabs
              value={selectedNoteType}
              onValueChange={(value) => {
                const nextValue = value as typeof selectedNoteType;
                setSelectedNoteType(nextValue);
                replaceConferencesUrl({ note_type: nextValue === 'all' ? null : nextValue });
              }}
            >
              <TabsList variant="line">
                <TabsTrigger value="all" className="min-w-11">
                  全て
                </TabsTrigger>
                <TabsTrigger value="pre_discharge">退院前</TabsTrigger>
                <TabsTrigger value="service_manager">担当者会議</TabsTrigger>
                <TabsTrigger value="death_conference">デスカンファ</TabsTrigger>
                <TabsTrigger value="care_team">その他</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
        {noteViewMode === 'list' ? (
          <div className="space-y-4">
            {notes.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                カンファレンス記録はまだありません
              </div>
            ) : (
              notes.map((note) => (
                <div key={note.id} className="space-y-3">
                  <SummaryNoteCard
                    note={note}
                    selected={selectedNoteId === note.id}
                    loading={
                      selectedNoteId === note.id &&
                      selectedNoteDetailQuery.isLoading &&
                      !selectedNoteDetailQuery.data
                    }
                    onSelect={(noteId) =>
                      setSelectedNoteId((current) => (current === noteId ? null : noteId))
                    }
                  />
                  {selectedNoteId === note.id ? (
                    selectedNoteDetailQuery.data ? (
                      <NoteCard
                        note={selectedNoteDetailQuery.data}
                        onConvertToTask={handleConvertToTask}
                        onGenerateReport={handleGenerateReport}
                        generating={generateReportMutation.isPending}
                      />
                    ) : selectedNoteDetailQuery.isError ? (
                      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                        カンファレンス詳細を取得できませんでした
                      </div>
                    ) : (
                      <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
                        カンファレンス詳細を読み込んでいます
                      </div>
                    )
                  ) : null}
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-foreground">
                {format(calendarMonth, 'yyyy年M月', { locale: ja })}
              </h3>
              <div className="flex gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  onClick={() => {
                    setCalendarMonth((current) => subMonths(current, 1));
                    setSelectedCalendarDate(null);
                  }}
                >
                  <ChevronLeft className="size-4" aria-hidden="true" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  onClick={() => {
                    setCalendarMonth(new Date());
                    setSelectedCalendarDate(null);
                  }}
                >
                  今月
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  onClick={() => {
                    setCalendarMonth((current) => addMonths(current, 1));
                    setSelectedCalendarDate(null);
                  }}
                >
                  <ChevronRight className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-border">
              <div className="grid grid-cols-7 border-b bg-muted/50">
                {['月', '火', '水', '木', '金', '土', '日'].map((label) => (
                  <div
                    key={label}
                    className="py-2 text-center text-xs font-medium text-muted-foreground"
                  >
                    {label}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {calendarDays.map((day) => {
                  const key = format(day, 'yyyy-MM-dd');
                  const dayNotes = calendarNotesByDate.get(key) ?? [];
                  const isSelected =
                    selectedCalendarDate !== null && isSameDay(selectedCalendarDate, day);
                  const visibleNotes = dayNotes.slice(0, 2);
                  const overflowCount = dayNotes.length - visibleNotes.length;

                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() =>
                        setSelectedCalendarDate((current) =>
                          current && isSameDay(current, day) ? null : day,
                        )
                      }
                      className={`min-h-[110px] border-b border-r p-2 text-left align-top last:border-r-0 ${
                        isSameMonth(day, calendarMonth) ? 'bg-background' : 'bg-muted/20'
                      } ${isSelected ? 'ring-2 ring-inset ring-primary' : ''}`}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">
                          {format(day, 'd')}
                        </span>
                        {dayNotes.length > 0 ? (
                          <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                            {dayNotes.length}件
                          </Badge>
                        ) : null}
                      </div>
                      <div className="space-y-1">
                        {visibleNotes.map((note) => (
                          <div
                            key={note.id}
                            className="truncate rounded bg-sky-50 px-1.5 py-1 text-[11px] text-sky-900"
                          >
                            {format(parseISO(note.conference_date), 'HH:mm')} {note.title}
                          </div>
                        ))}
                        {overflowCount > 0 ? (
                          <div className="text-[11px] text-muted-foreground">
                            ほか {overflowCount} 件
                          </div>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedCalendarDate ? (
              <div className="space-y-3 rounded-lg border border-border p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">
                      {format(selectedCalendarDate, 'yyyy年M月d日(E)', { locale: ja })}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {selectedCalendarNotes.length}件の会議
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setSelectedCalendarDate(null)}>
                    閉じる
                  </Button>
                </div>
                {selectedCalendarNotes.length === 0 ? (
                  <div className="text-sm text-muted-foreground">この日の会議はありません</div>
                ) : (
                  <div className="space-y-3">
                    {selectedCalendarNotes.map((note) => (
                      <div
                        key={note.id}
                        className="rounded-lg border border-border bg-background p-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium text-foreground">{note.title}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {format(parseISO(note.conference_date), 'HH:mm')} /{' '}
                              {NOTE_TYPE_LABELS[note.note_type] ?? note.note_type}
                            </p>
                          </div>
                          {note.sync_summary?.visit_proposal_id ? (
                            <Badge variant="outline">訪問候補あり</Badge>
                          ) : null}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {note.generated_report_id ||
                          note.sync_summary?.report_draft_ids?.length ? (
                            <Badge variant="outline">報告書あり</Badge>
                          ) : null}
                          {note.sync_summary?.billing_candidate_id ? (
                            <Badge variant="outline">算定候補あり</Badge>
                          ) : null}
                          {note.sync_summary?.tasks_created ? (
                            <Badge variant="outline">
                              タスク {note.sync_summary.tasks_created}件
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}
      </PageSection>

      <SectionIntro
        title="地域活動と紹介導線"
        description="地域活動の実績と、後続フォローが必要な案件を同じまとまりで追います。"
      />
      <section
        className={cn(
          'space-y-4',
          initialFocus === 'activities' ? 'rounded-2xl ring-2 ring-primary/25' : null,
        )}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">地域活動と紹介導線</h2>
          <p className="text-sm text-muted-foreground">{activities.length}件</p>
        </div>
        <div className="space-y-4">
          {activities.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              地域活動はまだありません
            </div>
          ) : (
            activities.map((activity) => <ActivityCard key={activity.id} activity={activity} />)
          )}
        </div>
      </section>

      {lastSyncSummary ? (
        <>
          <SectionIntro
            title="保存後アクション"
            description="会議保存に連動して生成された報告書、タスク、候補導線を確認します。"
          />
          <Card className="border-sky-200 bg-sky-50/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">保存後アクション</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-slate-700">
                「{lastSyncSummary.title}」の保存に連動して、必要な後続処理を作成しました。
              </p>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">
                  報告書ドラフト {Array.from(new Set(lastSyncSummary.reportDraftIds ?? [])).length}
                  件
                </Badge>
                <Badge variant="outline">タスク化 {lastSyncSummary.tasksCreated ?? 0}件</Badge>
                <Badge variant="outline">
                  薬学課題 {lastSyncSummary.medicationIssuesCreated ?? 0}件
                </Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/reports"
                  className="inline-flex rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted"
                >
                  報告書を確認
                </Link>
                {Array.from(new Set(lastSyncSummary.reportDraftIds ?? [])).map(
                  (reportId, index) => (
                    <Link
                      key={reportId}
                      href={`/reports/${reportId}`}
                      className="inline-flex rounded-lg border border-sky-200 bg-background px-3 py-2 text-sm font-medium text-sky-900 hover:bg-sky-50"
                    >
                      ドラフト{index + 1}
                    </Link>
                  ),
                )}
                {lastSyncSummary.billingCandidateId ? (
                  <Link
                    href="/billing/candidates"
                    className="inline-flex rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted"
                  >
                    算定候補を確認
                  </Link>
                ) : null}
                {lastSyncSummary.visitProposalId ? (
                  <Link
                    href={`/schedules/proposals?case_id=${lastSyncSummary.caseId ?? ''}&patient_id=${lastSyncSummary.patientId ?? ''}&focus=patient`}
                    className="inline-flex rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted"
                  >
                    訪問候補を確認
                  </Link>
                ) : lastSyncSummary.caseId || lastSyncSummary.patientId ? (
                  <Link
                    href={`/schedules/proposals?case_id=${lastSyncSummary.caseId ?? ''}&patient_id=${lastSyncSummary.patientId ?? ''}&focus=patient`}
                    className="inline-flex rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted"
                  >
                    訪問候補を作成
                  </Link>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}

      <Dialog
        open={newNoteOpen}
        onOpenChange={(open) => {
          setNewNoteOpen(open);
          if (!open) {
            resetNoteForm();
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>カンファレンスノート新規作成</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="conf-type">会議種別</Label>
              <Select
                value={noteType}
                onValueChange={(value) =>
                  handleNoteTypeChange(value as ConferenceNote['note_type'])
                }
              >
                <SelectTrigger id="conf-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="regular">定例会議</SelectItem>
                  <SelectItem value="pre_discharge">退院前カンファ</SelectItem>
                  <SelectItem value="service_manager">担当者会議</SelectItem>
                  <SelectItem value="care_team">多職種カンファ</SelectItem>
                  <SelectItem value="death_conference">デスカンファ</SelectItem>
                  <SelectItem value="emergency">緊急カンファ</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="conf-title">タイトル</Label>
              <Input
                id="conf-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例: 山田太郎様 定期カンファレンス"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="conf-date">開催日時</Label>
              <Input
                id="conf-date"
                type="datetime-local"
                value={conferenceDate}
                onChange={(event) => setConferenceDate(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>参加者</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setParticipantDrafts((current) => [
                      ...current,
                      { name: '', role: '', attended: true, is_report_recipient: false },
                    ])
                  }
                >
                  <Plus className="mr-1 size-3.5" aria-hidden="true" />
                  参加者を追加
                </Button>
              </div>
              {prescriberInstitutionSuggestion ? (
                <div className="rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-3 text-sm">
                  <p className="font-medium text-sky-900">
                    処方元医療機関候補: {prescriberInstitutionSuggestion.name}
                  </p>
                  <p className="mt-1 text-xs text-sky-800">
                    {prescriberInstitutionSuggestion.prescriber_name
                      ? `主担当: ${prescriberInstitutionSuggestion.prescriber_name}`
                      : '医療機関名を参加者候補として利用できます'}
                    {prescriberInstitutionSuggestion.fax
                      ? ` / FAX ${prescriberInstitutionSuggestion.fax}`
                      : prescriberInstitutionSuggestion.phone
                        ? ` / TEL ${prescriberInstitutionSuggestion.phone}`
                        : ''}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    onClick={appendPrescriberInstitutionParticipant}
                  >
                    参加者に追加
                  </Button>
                </div>
              ) : null}
              <div className="space-y-3">
                {participantDrafts.map((participant, index) => (
                  <div key={`participant-${index}`} className="rounded-lg border p-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>登録済み他職種</Label>
                        <Select
                          value={participant.external_professional_id ?? 'manual'}
                          onValueChange={(value) =>
                            applyExternalProfessional(
                              index,
                              !value || value === 'manual' ? '' : value,
                            )
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="手入力または登録済みから選択" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="manual">手入力</SelectItem>
                            {externalProfessionals.map((item) => (
                              <SelectItem key={item.id} value={item.id}>
                                {item.name} / {item.organization_name ?? item.profession_type}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>氏名</Label>
                        <Input
                          list={`conference-participant-suggestions-${index}`}
                          value={participant.name}
                          onChange={(event) => {
                            const matched = externalProfessionals.find(
                              (item) => item.name === event.target.value,
                            );
                            if (matched) {
                              applyExternalProfessional(index, matched.id);
                              return;
                            }
                            updateParticipantAt(index, (draft) => ({
                              ...draft,
                              external_professional_id: undefined,
                              name: event.target.value,
                              ...(draft.external_professional_id
                                ? {
                                    role: '',
                                    email: undefined,
                                    fax: undefined,
                                  }
                                : {}),
                            }));
                          }}
                        />
                        <datalist id={`conference-participant-suggestions-${index}`}>
                          {externalProfessionals.map((item) => (
                            <option key={item.id} value={item.name}>
                              {item.organization_name ?? item.profession_type}
                            </option>
                          ))}
                        </datalist>
                      </div>
                      <div className="space-y-1.5">
                        <Label>役割・所属</Label>
                        <Input
                          value={participant.role}
                          onChange={(event) =>
                            updateParticipantAt(index, (draft) => ({
                              ...draft,
                              external_professional_id: undefined,
                              role: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>メール</Label>
                        <Input
                          value={participant.email ?? ''}
                          onChange={(event) =>
                            updateParticipantAt(index, (draft) => ({
                              ...draft,
                              external_professional_id: undefined,
                              email: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>FAX</Label>
                        <Input
                          value={participant.fax ?? ''}
                          onChange={(event) =>
                            updateParticipantAt(index, (draft) => ({
                              ...draft,
                              external_professional_id: undefined,
                              fax: event.target.value,
                            }))
                          }
                        />
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap gap-4">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={participant.attended ?? true}
                            onChange={(event) =>
                              updateParticipantAt(index, (draft) => ({
                                ...draft,
                                attended: event.target.checked,
                              }))
                            }
                          />
                          <span>出席</span>
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={participant.is_report_recipient ?? false}
                            onChange={(event) =>
                              updateParticipantAt(index, (draft) => ({
                                ...draft,
                                is_report_recipient: event.target.checked,
                              }))
                            }
                          />
                          <span>報告書送付対象</span>
                        </label>
                      </div>
                      {participantDrafts.length > 1 ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setParticipantDrafts((current) =>
                              current.filter((_, draftIndex) => draftIndex !== index),
                            )
                          }
                        >
                          削除
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="conf-content">内容</Label>
              <Textarea
                id="conf-content"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder="カンファレンスの内容・決定事項を記録"
                rows={5}
              />
            </div>
            <div className="space-y-3">
              <Label>構造化項目</Label>
              <div className="space-y-3">
                {structuredSectionDrafts.map((section) => (
                  <div key={section.key} className="space-y-1.5">
                    <Label htmlFor={`conf-section-${section.key}`}>{section.label}</Label>
                    <Textarea
                      id={`conf-section-${section.key}`}
                      value={section.body}
                      onChange={(event) =>
                        setStructuredSectionDrafts((current) =>
                          current.map((item) =>
                            item.key === section.key ? { ...item, body: event.target.value } : item,
                          ),
                        )
                      }
                      placeholder={section.placeholder}
                      rows={section.rows ?? 3}
                    />
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                種別別の構造化項目は、報告書生成・算定候補・後続タスク/訪問候補の判断材料として利用されます。
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="conf-actions">
                アクションアイテム
                <span className="ml-1 text-xs text-muted-foreground">（1行1件、内容/担当）</span>
              </Label>
              <Textarea
                id="conf-actions"
                value={actionItemsRaw}
                onChange={(event) => setActionItemsRaw(event.target.value)}
                placeholder={'主治医に疑義照会/鈴木薬剤師\n服薬カレンダー更新/佐藤看護師'}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" size="sm" onClick={resetNoteForm} />}>
              キャンセル
            </DialogClose>
            <Button size="sm" onClick={handleCreateNote} disabled={createNoteMutation.isPending}>
              {createNoteMutation.isPending ? '作成中...' : '作成'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={newActivityOpen} onOpenChange={setNewActivityOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>地域活動の登録</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="activity-type">活動種別</Label>
              <Input
                id="activity-type"
                value={activityType}
                onChange={(event) => setActivityType(event.target.value)}
                placeholder="例: 地域勉強会"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="activity-date">実施日時</Label>
              <Input
                id="activity-date"
                type="datetime-local"
                value={activityDate}
                onChange={(event) => setActivityDate(event.target.value)}
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="activity-title">タイトル</Label>
              <Input
                id="activity-title"
                value={activityTitle}
                onChange={(event) => setActivityTitle(event.target.value)}
                placeholder="例: 施設職員向け服薬支援研修"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="partner-name">連携先</Label>
              <Input
                id="partner-name"
                value={partnerName}
                onChange={(event) => setPartnerName(event.target.value)}
                placeholder="例: 東町地域包括支援センター"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="target-population">対象</Label>
              <Input
                id="target-population"
                value={targetPopulation}
                onChange={(event) => setTargetPopulation(event.target.value)}
                placeholder="例: ケアマネジャー"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="attendee-count">参加者数</Label>
              <Input
                id="attendee-count"
                type="number"
                value={attendeeCount}
                onChange={(event) => setAttendeeCount(event.target.value)}
                min={0}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="referrals-generated">紹介件数</Label>
              <Input
                id="referrals-generated"
                type="number"
                value={referralsGenerated}
                onChange={(event) => setReferralsGenerated(event.target.value)}
                min={0}
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="activity-description">内容</Label>
              <Textarea
                id="activity-description"
                value={activityDescription}
                onChange={(event) => setActivityDescription(event.target.value)}
                rows={4}
                placeholder="活動の内容、実施背景、地域からの反応を記録"
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="outcome-summary">成果・次の動き</Label>
              <Textarea
                id="outcome-summary"
                value={outcomeSummary}
                onChange={(event) => setOutcomeSummary(event.target.value)}
                rows={3}
                placeholder="紹介候補、フォローが必要な案件、次回施策など"
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose
              render={<Button variant="outline" size="sm" onClick={resetActivityForm} />}
            >
              キャンセル
            </DialogClose>
            <Button
              size="sm"
              onClick={handleCreateActivity}
              disabled={createActivityMutation.isPending}
            >
              {createActivityMutation.isPending ? '登録中...' : '登録'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!reportDialogNote}
        onOpenChange={(open) => (!open ? setReportDialogNote(null) : null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>報告書を生成</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>報告書種別</Label>
              <Select
                value={reportTypeDraft}
                onValueChange={(value) => setReportTypeDraft(value ?? reportTypeDraft)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {reportDialogNote
                    ? reportTypeOptions(reportDialogNote).map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))
                    : null}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoSendReport}
                onChange={(event) => setAutoSendReport(event.target.checked)}
              />
              <span>送付対象に送達下書きも作成する</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeStructuredInReport}
                onChange={(event) => setIncludeStructuredInReport(event.target.checked)}
              />
              <span>構造化項目を報告書本文に含める</span>
            </label>
            <p className="text-xs text-muted-foreground">
              `is_report_recipient` が付いた参加者に、メールまたは FAX
              の送付下書きを自動起票します。
            </p>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" size="sm" />}>キャンセル</DialogClose>
            <Button
              size="sm"
              onClick={handleConfirmGenerateReport}
              disabled={generateReportMutation.isPending}
            >
              {generateReportMutation.isPending ? '生成中...' : '生成する'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function conferenceRoleLabel(professionType: string, organizationName: string | null) {
  const professionLabel = PROFESSION_LABELS[professionType] ?? professionType;

  return organizationName ? `${organizationName} / ${professionLabel}` : professionLabel;
}
