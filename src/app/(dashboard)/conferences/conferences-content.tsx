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

// --- Types ---

type Participant = {
  name: string;
  role: string;
};

type ActionItem = {
  title: string;
  assignee?: string;
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

// --- Sample data ---

const SAMPLE_NOTES: ConferenceNote[] = [
  {
    id: '1',
    title: '山田太郎様 定期カンファレンス',
    content: '服薬アドヒアランスの改善について検討。介護士から「朝の服薬を忘れることが多い」との報告あり。一包化の検討を提案。',
    participants: [
      { name: '鈴木薬剤師', role: '薬剤師' },
      { name: '田中CM', role: 'ケアマネジャー' },
      { name: '佐藤看護師', role: '訪問看護師' },
    ],
    conference_date: '2026-03-20T14:00:00Z',
    action_items: [
      { title: '一包化の処方変更を主治医に相談', assignee: '鈴木薬剤師' },
      { title: '服薬カレンダーを作成して居室に設置', assignee: '佐藤看護師' },
    ],
    case_id: 'case_001',
    created_at: '2026-03-20T15:30:00Z',
  },
  {
    id: '2',
    title: '鈴木花子様 退院時カンファレンス',
    content: '退院後の在宅療養計画について。新規処方薬の確認と持参薬の整理を行った。',
    participants: [
      { name: '田中薬剤師', role: '薬剤師' },
      { name: '病院薬剤師 山本', role: '病院薬剤師' },
      { name: '山田MSW', role: '医療ソーシャルワーカー' },
    ],
    conference_date: '2026-03-18T10:00:00Z',
    action_items: [
      { title: '処方内容の照合レポート作成', assignee: '田中薬剤師' },
    ],
    case_id: 'case_002',
    created_at: '2026-03-18T11:00:00Z',
  },
];

// --- Components ---

function NoteCard({
  note,
  onConvertToTask,
}: {
  note: ConferenceNote;
  onConvertToTask: (note: ConferenceNote, item: ActionItem) => void;
}) {
  const dateStr = format(parseISO(note.conference_date), 'yyyy年M月d日(E) HH:mm', { locale: ja });

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
            {note.participants.map((p) => p.name).join('、')}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-foreground whitespace-pre-line">{note.content}</p>

        {note.participants.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {note.participants.map((p, i) => (
              <Badge key={i} variant="outline" className="text-xs">
                {p.name}（{p.role}）
              </Badge>
            ))}
          </div>
        )}

        {note.action_items && note.action_items.length > 0 && (
          <div className="space-y-1.5">
            <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <ListChecks className="size-3.5" aria-hidden="true" />
              アクションアイテム
            </p>
            <ul className="space-y-1.5" role="list">
              {note.action_items.map((item, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-1.5"
                >
                  <div className="min-w-0">
                    <span className="text-sm">{item.title}</span>
                    {item.assignee && (
                      <span className="ml-2 text-xs text-muted-foreground">担当: {item.assignee}</span>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 shrink-0 px-2 text-xs text-blue-700 hover:bg-blue-50"
                    onClick={() => onConvertToTask(note, item)}
                  >
                    <ArrowRight className="mr-1 size-3" aria-hidden="true" />
                    タスク化
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- Main ---

export function ConferencesContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [newNoteOpen, setNewNoteOpen] = useState(false);

  // Form state
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [conferenceDate, setConferenceDate] = useState('');
  const [participantsRaw, setParticipantsRaw] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['conference-notes', orgId],
    queryFn: async () => {
      const res = await fetch('/api/conference-notes?limit=20', {
        headers: { 'x-org-id': orgId },
      });
      if (res.status === 404) return { data: SAMPLE_NOTES };
      if (!res.ok) throw new Error('カンファレンスノートの取得に失敗しました');
      return res.json() as Promise<{ data: ConferenceNote[] }>;
    },
    enabled: !!orgId,
  });

  const createMutation = useMutation({
    mutationFn: async (payload: object) => {
      const res = await fetch('/api/conference-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('作成に失敗しました');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conference-notes', orgId] });
      setNewNoteOpen(false);
      resetForm();
      toast.success('カンファレンスノートを作成しました');
    },
    onError: () => toast.error('作成に失敗しました'),
  });

  function resetForm() {
    setTitle('');
    setContent('');
    setConferenceDate('');
    setParticipantsRaw('');
  }

  function handleCreate() {
    if (!title.trim() || !content.trim() || !conferenceDate) {
      toast.error('タイトル・内容・日時は必須です');
      return;
    }

    const participants: Participant[] = participantsRaw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, role] = line.split('/').map((s) => s.trim());
        return { name: name ?? line, role: role ?? '' };
      });

    createMutation.mutate({
      title,
      content,
      conference_date: new Date(conferenceDate).toISOString(),
      participants,
    });
  }

  function handleConvertToTask(note: ConferenceNote, item: ActionItem) {
    toast.success(`「${item.title}」をタスクに変換しました（Phase 2 実装予定）`);
  }

  const notes = data?.data ?? SAMPLE_NOTES;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{notes.length}件</p>
        <Button size="sm" onClick={() => setNewNoteOpen(true)}>
          <Plus className="mr-1.5 size-3.5" aria-hidden="true" />
          新規作成
        </Button>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      )}

      <div className="space-y-4">
        {notes.map((note) => (
          <NoteCard
            key={note.id}
            note={note}
            onConvertToTask={handleConvertToTask}
          />
        ))}
      </div>

      {/* New note dialog */}
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
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例: 山田太郎様 定期カンファレンス"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="conf-date">開催日時</Label>
              <Input
                id="conf-date"
                type="datetime-local"
                value={conferenceDate}
                onChange={(e) => setConferenceDate(e.target.value)}
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
                onChange={(e) => setParticipantsRaw(e.target.value)}
                placeholder={'鈴木薬剤師/薬剤師\n田中CM/ケアマネジャー'}
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="conf-content">内容</Label>
              <Textarea
                id="conf-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="カンファレンスの内容・決定事項を記録"
                rows={5}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" size="sm" onClick={resetForm} />}>
              キャンセル
            </DialogClose>
            <Button size="sm" onClick={handleCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? '作成中...' : '作成'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
