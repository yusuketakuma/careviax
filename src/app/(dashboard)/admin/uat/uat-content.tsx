'use client';

import { useState } from 'react';
import { CheckSquare, Square, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

type CheckItem = {
  id: string;
  label: string;
};

type CheckSection = {
  title: string;
  items: CheckItem[];
};

const UAT_CHECKLIST: CheckSection[] = [
  {
    title: '基本フロー',
    items: [
      {
        id: 'flow_patient_to_report',
        label:
          '患者登録 → 訪問予定作成 → 訪問 → 記録 → 報告の一連フローが完遂できる',
      },
      {
        id: 'flow_prescription_cycle',
        label:
          '処方箋応需 → 調剤 → 鑑査 → 訪問の完全サイクルが滞りなく回せる',
      },
    ],
  },
  {
    title: '照会・連携フロー',
    items: [
      {
        id: 'flow_inquiry',
        label: '疑義照会の起票・送付・結果反映が一貫して行える',
      },
      {
        id: 'flow_tracing_report',
        label:
          'トレーシングレポートの作成・送付・受領確認が問題なく行える',
      },
    ],
  },
  {
    title: 'セット管理',
    items: [
      {
        id: 'flow_set_audit',
        label:
          'セットプラン作成 → セット鑑査（承認/部分承認/差戻し）→ 持参品目への反映が正しく行える',
      },
    ],
  },
  {
    title: 'データ整合性・表示',
    items: [
      {
        id: 'check_data_consistency',
        label:
          '各画面で表示されるデータが実際の操作と一致している（入力と表示の乖離がない）',
      },
      {
        id: 'check_error_handling',
        label:
          'エラー時に適切なメッセージが表示され、操作を継続できる',
      },
      {
        id: 'check_mobile',
        label:
          'モバイル端末（スマートフォン/タブレット）で主要画面が正常に操作できる',
      },
    ],
  },
];

const PRIORITY_OPTIONS = [
  { value: 'critical', label: '重大（即対応）' },
  { value: 'high', label: '高（早期対応）' },
  { value: 'medium', label: '中（次スプリント）' },
  { value: 'low', label: '低（要望）' },
];

export function UatContent() {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState('');
  const [priority, setPriority] = useState('medium');
  const [isSending, setIsSending] = useState(false);

  const totalItems = UAT_CHECKLIST.reduce(
    (acc, s) => acc + s.items.length,
    0
  );
  const checkedCount = checked.size;

  function toggleItem(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleSubmitFeedback() {
    if (!feedback.trim()) {
      toast.error('フィードバック内容を入力してください');
      return;
    }
    setIsSending(true);
    try {
      // MVP: log to console and show toast (backend endpoint is Phase 2)
      console.info('[UAT Feedback]', {
        priority,
        feedback,
        checklist_progress: `${checkedCount}/${totalItems}`,
        submitted_at: new Date().toISOString(),
      });
      toast.success('フィードバックを送信しました（開発チームへ通知）');
      setFeedback('');
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Progress */}
      <div className="flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{
              width: `${totalItems > 0 ? (checkedCount / totalItems) * 100 : 0}%`,
            }}
          />
        </div>
        <span className="text-sm tabular-nums text-muted-foreground">
          {checkedCount} / {totalItems} 完了
        </span>
      </div>

      {/* Checklist */}
      <div className="space-y-6">
        {UAT_CHECKLIST.map((section) => (
          <Card key={section.title} size="sm">
            <CardHeader>
              <CardTitle className="text-sm font-semibold">
                {section.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {section.items.map((item) => {
                  const isChecked = checked.has(item.id);
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => toggleItem(item.id)}
                        className="flex w-full items-start gap-3 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-pressed={isChecked}
                      >
                        {isChecked ? (
                          <CheckSquare
                            className="mt-0.5 size-5 shrink-0 text-primary"
                            aria-hidden="true"
                          />
                        ) : (
                          <Square
                            className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                        )}
                        <span
                          className={`text-sm leading-relaxed ${
                            isChecked
                              ? 'text-muted-foreground line-through'
                              : 'text-foreground'
                          }`}
                        >
                          {item.label}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>

      <Separator />

      {/* Feedback form */}
      <div className="space-y-4">
        <h2 className="text-base font-semibold text-foreground">
          フィードバック送信
        </h2>

        <div className="space-y-1">
          <Label htmlFor="feedback_priority">優先度</Label>
          <Select value={priority} onValueChange={(v) => v && setPriority(v)}>
            <SelectTrigger id="feedback_priority" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="feedback_text">フィードバック内容</Label>
          <Textarea
            id="feedback_text"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={5}
            placeholder="問題の内容・再現手順・改善提案などを記入してください"
            className="resize-none"
          />
        </div>

        <Button
          onClick={handleSubmitFeedback}
          disabled={isSending || !feedback.trim()}
        >
          <Send className="mr-2 size-4" aria-hidden="true" />
          {isSending ? '送信中...' : 'フィードバックを送信'}
        </Button>
      </div>
    </div>
  );
}
