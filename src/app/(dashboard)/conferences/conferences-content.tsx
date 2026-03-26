'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Plus, Users, ArrowRight, Calendar, ListChecks } from 'lucide-react';
import { toast } from 'sonner';
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
import { Textarea } from '@/components/ui/textarea';
import { useOrgId } from '@/lib/hooks/use-org-id';

type Participant = {
  name: string;
  role: string;
};

type ActionItem = {
  title: string;
  assignee?: string;
  converted_task_id?: string;
  converted_at?: string;
};

type ConferenceNote = {
  id: string;
  title: string;
  content: string;
  participants: Participant[];
  conference_date: string;
  action_items: ActionItem[] | null;
  case_id: string | null;
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

function NoteCard({
  note,
  onConvertToTask,
}: {
  note: ConferenceNote;
  onConvertToTask: (note: ConferenceNote, item: ActionItem) => void;
}) {
  const dateStr = format(parseISO(note.conference_date), 'yyyy年M月d日(E) HH:mm', {
    locale: ja,
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base">{note.title}</CardTitle>
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
            <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">
              要フォロー
            </Badge>
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

export function ConferencesContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [newNoteOpen, setNewNoteOpen] = useState(false);
  const [newActivityOpen, setNewActivityOpen] = useState(false);

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [conferenceDate, setConferenceDate] = useState('');
  const [participantsRaw, setParticipantsRaw] = useState('');
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
    queryKey: ['conference-notes', orgId],
    queryFn: async () => {
      const response = await fetch('/api/conference-notes?limit=20', {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('カンファレンスノートの取得に失敗しました');
      return response.json() as Promise<{ data: ConferenceNote[] }>;
    },
    enabled: !!orgId,
  });

  const activitiesQuery = useQuery({
    queryKey: ['community-activities', orgId],
    queryFn: async () => {
      const response = await fetch('/api/community-activities?limit=20', {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('地域活動の取得に失敗しました');
      return response.json() as Promise<{ data: CommunityActivity[] }>;
    },
    enabled: !!orgId,
  });

  const createNoteMutation = useMutation({
    mutationFn: async (payload: object) => {
      const response = await fetch('/api/conference-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error('作成に失敗しました');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conference-notes', orgId] });
      setNewNoteOpen(false);
      resetNoteForm();
      toast.success('カンファレンスノートを作成しました');
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
      await queryClient.invalidateQueries({ queryKey: ['tasks', orgId] });
      toast.success('アクションアイテムをタスク化しました');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function resetNoteForm() {
    setTitle('');
    setContent('');
    setConferenceDate('');
    setParticipantsRaw('');
    setActionItemsRaw('');
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
    if (!title.trim() || !content.trim() || !conferenceDate) {
      toast.error('タイトル・内容・日時は必須です');
      return;
    }

    const participants: Participant[] = participantsRaw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, role] = line.split('/').map((item) => item.trim());
        return { name: name ?? line, role: role ?? '' };
      });

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
      title,
      content,
      conference_date: new Date(conferenceDate).toISOString(),
      participants,
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
      (candidate) => candidate.title === item.title && candidate.assignee === item.assignee
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

  const notes = notesQuery.data?.data ?? [];
  const activities = activitiesQuery.data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <Card className="border-slate-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">多職種カンファレンス</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4 text-sm">
            <div>
              <p className="font-medium">{notes.length}件の記録</p>
              <p className="text-muted-foreground">医師・看護師・ケアマネとの情報共有を一元管理します。</p>
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
              <p className="text-muted-foreground">勉強会・地域連携・相談会の実績と紹介導線を記録します。</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setNewActivityOpen(true)}>
              <Plus className="mr-1.5 size-3.5" aria-hidden="true" />
              活動登録
            </Button>
          </CardContent>
        </Card>
      </div>

      {notesQuery.isLoading || activitiesQuery.isLoading ? (
        <div className="space-y-2">
          {[1, 2].map((item) => (
            <div key={item} className="h-32 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : null}

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">カンファレンス記録</h2>
          <p className="text-sm text-muted-foreground">{notes.length}件</p>
        </div>
        <div className="space-y-4">
          {notes.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              カンファレンス記録はまだありません
            </div>
          ) : (
            notes.map((note) => (
              <NoteCard key={note.id} note={note} onConvertToTask={handleConvertToTask} />
            ))
          )}
        </div>
      </section>

      <section className="space-y-4">
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
            activities.map((activity) => (
              <ActivityCard key={activity.id} activity={activity} />
            ))
          )}
        </div>
      </section>

      <Dialog open={newNoteOpen} onOpenChange={setNewNoteOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>カンファレンスノート新規作成</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
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
              <Label htmlFor="conf-participants">
                参加者
                <span className="ml-1 text-xs text-muted-foreground">（1行1人、名前/役割）</span>
              </Label>
              <Textarea
                id="conf-participants"
                value={participantsRaw}
                onChange={(event) => setParticipantsRaw(event.target.value)}
                placeholder={'鈴木薬剤師/薬剤師\n田中CM/ケアマネジャー'}
                rows={3}
              />
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
            <DialogClose render={<Button variant="outline" size="sm" onClick={resetActivityForm} />}>
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
    </div>
  );
}
