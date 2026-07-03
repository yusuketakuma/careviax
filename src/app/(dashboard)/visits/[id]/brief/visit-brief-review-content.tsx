'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { Button, buttonVariants } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/loading';
import { Textarea } from '@/components/ui/textarea';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { cn } from '@/lib/utils';
import { messageFromError } from '@/lib/utils/error-message';
import type { VisitBrief } from '@/types/visit-brief';
import {
  buildNeedsEditFeedbackInput,
  composeBriefParagraph,
  CORRECTED_SUMMARY_MAX_LENGTH,
  formatBriefGeneratedAt,
  mapConfirmChoiceToFeedback,
  PHARMACIST_CONFIRM_CHOICES,
  pickVisitPatientId,
  resolveEvidenceLinks,
  selectBriefSummary,
  validateCorrectedSummary,
  type BriefFeedbackInput,
  type PharmacistConfirmChoice,
} from './visit-brief-review.shared';

/**
 * p1_03「訪問前まとめを確認」: 根拠になる情報 / AIがまとめた訪問前メモ /
 * 次にやること の 3 カラム。患者は訪問予定(なければ訪問記録)から解決し、
 * 本文は患者 visit-brief の AI 要約(fallback 時はルール要約)を段落表示する。
 */

/** 選択中 3 択カードの強調(色のみに依存せずチェックアイコンを併記する)。 */
const SELECTED_CHOICE_CLASSES: Record<PharmacistConfirmChoice, string> = {
  correct: 'border-state-done/30 bg-state-done/10 text-state-done',
  needs_edit: 'border-state-confirm/30 bg-state-confirm/10 text-state-confirm',
  do_not_use: 'border-state-readonly/30 bg-state-readonly/10 text-state-readonly',
};

export function VisitBriefReviewContent({ visitId }: { visitId: string }) {
  const orgId = useOrgId();
  const [confirmChoice, setConfirmChoice] = useState<PharmacistConfirmChoice | null>(null);
  const [showSource, setShowSource] = useState(false);
  // 「一部修正する」の編集状態(エディタの開閉・本文・入力エラー)。
  const [isEditingSummary, setIsEditingSummary] = useState(false);
  const [editorValue, setEditorValue] = useState('');
  const [editorError, setEditorError] = useState<string | null>(null);

  // 訪問予定 ID(訪問前の標準導線)→ 見つからなければ訪問記録 ID として患者を解決する。
  const patientQuery = useQuery<{ patientId: string }>({
    queryKey: ['visit-brief-review-patient', visitId, orgId],
    queryFn: async () => {
      const headers = buildOrgHeaders(orgId);
      const scheduleRes = await fetch(`/api/visit-schedules/${visitId}`, { headers });
      if (scheduleRes.ok) {
        const patientId = pickVisitPatientId(await scheduleRes.json());
        if (patientId) return { patientId };
      }
      const recordRes = await fetch(`/api/visit-records/${visitId}`, { headers });
      if (recordRes.ok) {
        const patientId = pickVisitPatientId(await recordRes.json());
        if (patientId) return { patientId };
      }
      throw new Error('訪問に紐づく患者を解決できませんでした');
    },
    enabled: !!orgId && !!visitId,
  });
  const patientId = patientQuery.data?.patientId ?? null;

  const briefQuery = useQuery<{ data: VisitBrief }>({
    queryKey: ['patient-visit-brief', patientId, orgId],
    queryFn: async () => {
      if (!patientId) throw new Error('患者IDが未解決です');
      const res = await fetch(buildPatientApiPath(patientId, '/visit-brief'), {
        headers: buildOrgHeaders(orgId),
      });
      if (!res.ok) throw new Error('訪問前まとめの取得に失敗しました');
      return res.json();
    },
    enabled: !!orgId && !!patientId,
  });
  const brief = briefQuery.data?.data ?? null;

  const feedbackMutation = useMutation({
    mutationFn: async ({
      feedback,
    }: {
      choice: PharmacistConfirmChoice;
      feedback: BriefFeedbackInput;
    }) => {
      if (!brief) throw new Error('訪問前まとめが未取得です');
      const summary = selectBriefSummary(brief);
      const res = await fetch('/api/visit-brief-feedback', {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({
          patient_id: brief.patient.id,
          context: brief.context,
          generation_id: summary.generationId,
          summary_kind: summary.kind,
          rating: feedback.rating,
          ...(feedback.comment ? { comment: feedback.comment } : {}),
          ...(feedback.corrected_summary ? { corrected_summary: feedback.corrected_summary } : {}),
          provider: summary.kind === 'ai' ? brief.ai_summary.provider : 'rule',
          requested_provider: summary.kind === 'ai' ? brief.ai_summary.requested_provider : 'rule',
          model: summary.kind === 'ai' ? brief.ai_summary.model : null,
          is_fallback: summary.kind === 'ai' ? brief.ai_summary.is_fallback : false,
        }),
      });
      if (!res.ok) throw new Error('確認結果の送信に失敗しました');
    },
    onSuccess: (_data, { choice, feedback }) => {
      setConfirmChoice(choice);
      if (feedback.corrected_summary) {
        setIsEditingSummary(false);
        setEditorError(null);
        toast.success('修正したまとめを記録しました');
      } else {
        toast.success('薬剤師の確認を記録しました');
      }
    },
    onError: (error) => {
      toast.error(messageFromError(error, '確認結果の送信に失敗しました'));
    },
  });

  if (!orgId || patientQuery.isPending || (patientQuery.isSuccess && briefQuery.isPending)) {
    return (
      <div
        className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)_280px]"
        role="status"
        aria-label="訪問前まとめを読み込み中"
      >
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-72 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (patientQuery.isError || briefQuery.isError || !brief) {
    return (
      <div className="rounded-lg border border-border/70 bg-card p-4">
        <ErrorState
          variant="server"
          title="訪問前まとめを表示できません"
          description="訪問前まとめの取得に失敗しました。再試行してください。"
          onRetry={() => {
            void patientQuery.refetch();
            void briefQuery.refetch();
          }}
        />
      </div>
    );
  }

  const summary = selectBriefSummary(brief);
  const paragraph = composeBriefParagraph(summary);
  const evidenceLinks = resolveEvidenceLinks(patientId);

  // 3 択カードの押下。「一部修正する」は編集エディタを開く(本文を現在の段落で初期化する)。
  // それ以外は従来どおり即時に確認結果を送信する。
  const handleChoiceClick = (choice: PharmacistConfirmChoice) => {
    if (choice === 'needs_edit') {
      setEditorValue(paragraph);
      setEditorError(null);
      setIsEditingSummary(true);
      return;
    }
    setIsEditingSummary(false);
    setEditorError(null);
    feedbackMutation.mutate({ choice, feedback: mapConfirmChoiceToFeedback(choice) });
  };

  // 「一部修正する」エディタの保存。空・上限超過を弾いてから訂正後本文つきで送信する。
  const handleSaveCorrectedSummary = () => {
    const { value, error } = validateCorrectedSummary(editorValue);
    if (error) {
      setEditorError(error);
      return;
    }
    setEditorError(null);
    feedbackMutation.mutate({
      choice: 'needs_edit',
      feedback: buildNeedsEditFeedbackInput(value),
    });
  };

  return (
    <div
      className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)_280px]"
      data-testid="visit-brief-review-page"
    >
      {/* 左カラム: 根拠になる情報 */}
      <section
        aria-labelledby="visit-brief-evidence-heading"
        className="h-fit rounded-lg border border-border/70 bg-card p-4"
      >
        <h2 id="visit-brief-evidence-heading" className="text-base font-bold text-foreground">
          根拠になる情報
        </h2>
        <ul className="mt-3 space-y-2.5" role="list">
          {evidenceLinks.map((item) => (
            <li key={item.key}>
              {item.href ? (
                <Link
                  href={item.href}
                  data-testid="visit-brief-evidence-card"
                  className="group flex min-h-12 items-center justify-between gap-2 rounded-lg border border-border/70 bg-background px-4 py-3 transition-colors hover:border-primary/50 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <span>
                    <span className="block text-sm font-semibold text-foreground">
                      {item.label}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {item.description}
                    </span>
                  </span>
                  <ChevronRight
                    className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
                    aria-hidden="true"
                  />
                </Link>
              ) : (
                <div
                  data-testid="visit-brief-evidence-card"
                  className="min-h-12 rounded-lg border border-border/70 bg-background px-4 py-3"
                >
                  <span className="block text-sm font-semibold text-foreground">{item.label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {item.description}
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* 中央カラム: AIがまとめた訪問前メモ + 薬剤師の確認 */}
      <section
        aria-labelledby="visit-brief-summary-heading"
        className="rounded-lg border border-border/70 bg-card p-4 sm:p-5"
      >
        <h2 id="visit-brief-summary-heading" className="text-base font-bold text-foreground">
          AIがまとめた訪問前メモ
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {brief.patient.name} 様 / 生成 {formatBriefGeneratedAt(brief.generated_at)}
        </p>

        {paragraph ? (
          <p className="mt-4 text-sm leading-7 text-foreground" data-testid="visit-brief-paragraph">
            {paragraph}
          </p>
        ) : (
          <p className="mt-4 text-sm leading-7 text-muted-foreground">
            表示できる要約がありません。原文(ルールベース要約)を確認してください。
          </p>
        )}
        {summary.kind === 'rule' ? (
          <p className="mt-2 text-xs text-muted-foreground">
            AI生成が利用できないため、ルールベース要約を本文として表示しています。
          </p>
        ) : null}

        <h3 id="pharmacist-confirm-heading" className="mt-8 text-sm font-bold text-foreground">
          薬剤師の確認
        </h3>
        <div role="group" aria-labelledby="pharmacist-confirm-heading" className="mt-3 space-y-2.5">
          {PHARMACIST_CONFIRM_CHOICES.map((choice) => {
            const selected = confirmChoice === choice.value;
            const isEditChoice = choice.value === 'needs_edit';
            const expanded = isEditChoice && isEditingSummary;
            return (
              <button
                key={choice.value}
                type="button"
                data-testid="pharmacist-confirm-choice"
                aria-pressed={selected}
                aria-expanded={isEditChoice ? expanded : undefined}
                aria-controls={isEditChoice ? 'visit-brief-correction-editor' : undefined}
                disabled={feedbackMutation.isPending}
                onClick={() => handleChoiceClick(choice.value)}
                className={cn(
                  'flex min-h-12 w-full items-center justify-between gap-2 rounded-lg border px-4 py-3 text-left text-sm font-semibold transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  'disabled:pointer-events-none disabled:opacity-50',
                  selected
                    ? SELECTED_CHOICE_CLASSES[choice.value]
                    : 'border-border/70 bg-background text-foreground hover:bg-muted/40',
                )}
              >
                {choice.label}
                {selected ? <Check className="size-4 shrink-0" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>

        {/* 「一部修正する」選択時の編集エディタ。本文を編集して保存できるようにする。 */}
        {isEditingSummary ? (
          <div
            id="visit-brief-correction-editor"
            data-testid="visit-brief-correction-editor"
            className="mt-3 rounded-lg border border-state-confirm/30 bg-state-confirm/10 p-4"
          >
            <label
              htmlFor="visit-brief-correction-textarea"
              className="block text-sm font-bold text-foreground"
            >
              まとめを修正
            </label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              修正したまとめは確認記録として保存されます(元のAI要約は残ります)。
            </p>
            <Textarea
              id="visit-brief-correction-textarea"
              data-testid="visit-brief-correction-textarea"
              value={editorValue}
              maxLength={CORRECTED_SUMMARY_MAX_LENGTH}
              onChange={(event) => {
                setEditorValue(event.target.value);
                if (editorError) setEditorError(null);
              }}
              disabled={feedbackMutation.isPending}
              aria-invalid={editorError ? true : undefined}
              aria-describedby={editorError ? 'visit-brief-correction-error' : undefined}
              className="mt-3 min-h-32 bg-background text-sm leading-7"
              placeholder="修正後のまとめを入力してください"
            />
            {editorError ? (
              <p
                id="visit-brief-correction-error"
                role="alert"
                className="mt-1.5 text-xs font-medium text-destructive"
              >
                {editorError}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                data-testid="visit-brief-correction-save"
                disabled={feedbackMutation.isPending}
                onClick={handleSaveCorrectedSummary}
                className="min-h-11"
              >
                修正を保存
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={feedbackMutation.isPending}
                onClick={() => {
                  setIsEditingSummary(false);
                  setEditorError(null);
                }}
                className="min-h-11"
              >
                キャンセル
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      {/* 右カラム: 次にやること */}
      <aside
        aria-label="次にやること"
        className="h-fit rounded-lg border border-border/70 bg-card p-4"
      >
        <h2 className="text-base font-bold text-foreground">次にやること</h2>
        <div className="mt-3 space-y-2.5">
          <Link
            href={`/visits/${visitId}/record`}
            className={cn(buttonVariants({ variant: 'default' }), 'min-h-11 w-full')}
          >
            訪問モードへ
          </Link>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full text-primary"
            aria-expanded={showSource}
            aria-controls="visit-brief-source-text"
            onClick={() => setShowSource((value) => !value)}
          >
            原文を確認
          </Button>
          {showSource ? (
            <div
              id="visit-brief-source-text"
              data-testid="visit-brief-source-text"
              className="rounded-lg border border-border/70 bg-muted/30 p-3"
            >
              <p className="text-xs font-medium text-muted-foreground">原文(ルールベース要約)</p>
              <p className="mt-1.5 text-sm font-medium leading-6 text-foreground">
                {brief.rule_summary.headline}
              </p>
              {brief.rule_summary.bullets.length > 0 ? (
                <ul className="mt-1.5 space-y-1 text-sm leading-6 text-foreground" role="list">
                  {brief.rule_summary.bullets.map((item) => (
                    <li key={item}>・{item}</li>
                  ))}
                </ul>
              ) : null}
              {brief.rule_summary.source_refs.length > 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  根拠: {brief.rule_summary.source_refs.join(' / ')}
                </p>
              ) : null}
              <p className="mt-2 text-xs text-muted-foreground">
                生成 {formatBriefGeneratedAt(brief.rule_summary.generated_at)}
              </p>
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
