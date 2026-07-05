'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { readApiJson } from '@/lib/api/client-json';
import { buildDocumentTemplateApiPath } from '@/lib/document-templates/api-paths';
import { buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { cn } from '@/lib/utils';
import { messageFromError } from '@/lib/utils/error-message';

/**
 * p1_10「報告テンプレート編集」: テンプレートを選び、{差し込み項目} 入りの
 * 文面を編集して保存する3カラムエディタ。文面は content.body_text に保存し、
 * 差し込みチップはカーソル位置へ {項目名} を挿入する。
 */

export const MERGE_FIELDS = [
  '服薬状況',
  '残薬',
  '副作用',
  '薬剤師評価',
  'お願いしたいこと',
  '次回確認',
] as const;

export const DEFAULT_BODY_TEXT =
  '本日の訪問では、{服薬状況} を確認しました。{薬剤師評価}。必要に応じて、{お願いしたいこと} をお願いします。';

export function readTemplateBodyText(content: Record<string, unknown> | null | undefined): string {
  if (!content) return '';
  return typeof content.body_text === 'string' ? content.body_text : '';
}

export function insertMergeField(
  text: string,
  cursor: number | null,
  label: string,
): { nextText: string; nextCursor: number } {
  const token = `{${label}}`;
  const at = cursor === null || cursor < 0 || cursor > text.length ? text.length : cursor;
  return {
    nextText: `${text.slice(0, at)}${token}${text.slice(at)}`,
    nextCursor: at + token.length,
  };
}

export function summarizeMergeFieldUsage(text: string): {
  usedCount: number;
  totalCount: number;
  missingFields: string[];
} {
  const missingFields = MERGE_FIELDS.filter((field) => !text.includes(`{${field}}`));
  return {
    usedCount: MERGE_FIELDS.length - missingFields.length,
    totalCount: MERGE_FIELDS.length,
    missingFields,
  };
}

type TemplateBodyEditorTemplate = {
  id: string;
  name: string;
  content: Record<string, unknown>;
};

export function TemplateBodyEditor({ templates }: { templates: TemplateBodyEditorTemplate[] }) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [bodyText, setBodyText] = React.useState('');

  const selected = templates.find((template) => template.id === selectedId) ?? templates[0] ?? null;

  // テンプレ切替時に文面を読み直す(未保存編集は破棄しない: id が変わった時のみ)
  const [hydratedId, setHydratedId] = React.useState<string | null>(null);
  if (selected && hydratedId !== selected.id) {
    setHydratedId(selected.id);
    setBodyText(readTemplateBodyText(selected.content) || DEFAULT_BODY_TEXT);
  }
  const mergeUsage = summarizeMergeFieldUsage(bodyText);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error('テンプレートを選択してください');
      const res = await fetch(buildDocumentTemplateApiPath(selected.id), {
        method: 'PATCH',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({ content: { ...selected.content, body_text: bodyText } }),
      });
      return readApiJson<unknown>(res, '文面の保存に失敗しました');
    },
    onSuccess: () => {
      toast.success('文面を保存しました');
      void queryClient.invalidateQueries({ queryKey: ['document-templates'] });
    },
    onError: (error) => toast.error(messageFromError(error, '文面の保存に失敗しました')),
  });

  function handleInsertField(label: string) {
    const element = textareaRef.current;
    const cursor = element ? element.selectionStart : null;
    const { nextText, nextCursor } = insertMergeField(bodyText, cursor, label);
    setBodyText(nextText);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(nextCursor, nextCursor);
    });
  }

  if (templates.length === 0) return null;

  return (
    <section
      data-testid="template-body-editor"
      aria-labelledby="template-body-editor-heading"
      className="rounded-lg border border-border/70 bg-card p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="template-body-editor-heading" className="text-base font-bold text-foreground">
            報告文面を編集
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {selected?.name ?? 'テンプレート未選択'} / 差し込み {mergeUsage.usedCount}/
            {mergeUsage.totalCount} 項目
          </p>
        </div>
        <div className="rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-right">
          <p className="text-xs text-muted-foreground">保存対象</p>
          <p className="mt-0.5 text-sm font-bold text-foreground">
            {selected ? '本文だけ更新' : '未選択'}
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-md border border-border/70 bg-muted/20 p-3">
        <p className="text-sm font-medium text-foreground">
          宛先別テンプレートの本文に、必要な差し込み項目を入れてから保存します。
        </p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          未使用: {mergeUsage.missingFields.length ? mergeUsage.missingFields.join('、') : 'なし'}
        </p>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)_240px]">
        <div className="rounded-lg border border-border/70 bg-background p-4">
          <h3 className="text-sm font-bold text-foreground">テンプレート</h3>
          <ul className="mt-3 space-y-2.5" role="list">
            {templates.map((template) => {
              const active = template.id === selected?.id;
              return (
                <li key={template.id}>
                  <button
                    type="button"
                    data-testid="template-body-editor-item"
                    aria-pressed={active}
                    onClick={() => setSelectedId(template.id)}
                    className={cn(
                      'min-h-11 w-full rounded-lg border px-4 py-2.5 text-left text-sm font-medium',
                      active
                        ? 'border-primary/40 bg-primary/5 text-foreground'
                        : 'border-border bg-background text-foreground hover:bg-muted/40',
                    )}
                  >
                    {template.name}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="rounded-lg border border-border/70 bg-background p-4">
          <h3 className="text-sm font-bold text-foreground">文面を編集</h3>
          <Textarea
            ref={textareaRef}
            value={bodyText}
            onChange={(event) => setBodyText(event.target.value)}
            aria-label="テンプレート文面"
            className="mt-3 min-h-[320px] leading-7"
          />
        </div>

        <div className="rounded-lg border border-border/70 bg-background p-4">
          <h3 className="text-sm font-bold text-foreground">差し込み項目</h3>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {MERGE_FIELDS.map((field) => (
              <button
                key={field}
                type="button"
                data-testid="merge-field-chip"
                onClick={() => handleInsertField(field)}
                className="min-h-9 rounded-full border border-primary/30 bg-primary/5 px-2 py-1.5 text-xs font-medium text-primary hover:bg-primary/10"
              >
                {field}
              </button>
            ))}
          </div>
          <Button
            type="button"
            className="mt-6 min-h-11 w-full"
            disabled={saveMutation.isPending || !selected}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? '保存中...' : '本文を保存する'}
          </Button>
        </div>
      </div>
    </section>
  );
}
