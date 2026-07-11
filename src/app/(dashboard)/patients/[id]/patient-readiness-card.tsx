'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ClipboardCheck } from 'lucide-react';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/loading';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import type { PatientReadinessSnapshot } from './patient-detail.types';

const readinessItemKeySchema = z.enum([
  'patient_profile',
  'primary_residence',
  'insurance',
  'visit_preferences',
  'care_team_recipients',
  'visit_consent',
  'emergency_contact',
  'primary_physician',
  'management_plan',
  'prescription_intake',
  'first_visit_document',
]);

const patientActionHrefSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine(
    (href) => href.startsWith('/patients/') && !href.startsWith('//') && !/[\r\n\\]/.test(href),
  );

const readinessItemSchema = z
  .object({
    key: readinessItemKeySchema,
    label: z.string().min(1),
    completed: z.boolean(),
    description: z.string().min(1),
    action_href: patientActionHrefSchema,
    action_label: z.string().min(1),
    severity: z.enum(['normal', 'high']),
  })
  .strict();

const patientReadinessSnapshotSchema = z
  .object({
    applicable: z.boolean(),
    overall_status: z.enum(['ready', 'action_required', 'not_started']),
    completed_count: z.number().int().nonnegative(),
    total_count: z.number().int().nonnegative(),
    current_case: z
      .object({
        id: z.string().min(1),
        status: z.string().min(1),
      })
      .strict()
      .nullable(),
    items: z.array(readinessItemSchema),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const completedItems = snapshot.items.filter((item) => item.completed).length;
    if (snapshot.total_count !== snapshot.items.length) {
      context.addIssue({ code: 'custom', path: ['total_count'], message: 'total mismatch' });
    }
    if (snapshot.completed_count !== completedItems) {
      context.addIssue({
        code: 'custom',
        path: ['completed_count'],
        message: 'completed mismatch',
      });
    }
    if (!snapshot.applicable) {
      if (
        snapshot.overall_status !== 'not_started' ||
        snapshot.current_case !== null ||
        snapshot.total_count !== 0
      ) {
        context.addIssue({ code: 'custom', path: ['applicable'], message: 'inactive mismatch' });
      }
      return;
    }
    if (snapshot.current_case === null || snapshot.overall_status === 'not_started') {
      context.addIssue({ code: 'custom', path: ['current_case'], message: 'active case required' });
    }
    if (
      (snapshot.overall_status === 'ready' && snapshot.completed_count !== snapshot.total_count) ||
      (snapshot.overall_status === 'action_required' &&
        snapshot.completed_count === snapshot.total_count)
    ) {
      context.addIssue({ code: 'custom', path: ['overall_status'], message: 'status mismatch' });
    }
  });

const patientReadinessResponseSchema = z.object({ data: patientReadinessSnapshotSchema }).strict();

function ReadinessHeading() {
  return (
    <h2 className="font-heading text-base leading-snug font-medium">
      患者情報・訪問開始 readiness
    </h2>
  );
}

function PatientReadinessLoadingCard() {
  return (
    <Card>
      <CardHeader>
        <ReadinessHeading />
      </CardHeader>
      <CardContent
        className="space-y-3"
        role="status"
        aria-label="患者情報・訪問開始 readiness を読み込み中"
      >
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="rounded-lg border border-border/70 bg-background p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-5/6" />
              </div>
              <Skeleton className="h-8 w-20 rounded-md" />
            </div>
          </div>
        ))}
        <span className="sr-only">患者情報・訪問開始 readiness を読み込んでいます。</span>
      </CardContent>
    </Card>
  );
}

export function PatientReadinessCard({ patientId }: { patientId: string }) {
  const orgId = useOrgId();
  const readinessQuery = useQuery<PatientReadinessSnapshot>({
    queryKey: ['patient-readiness', patientId, orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const response = await fetch(buildPatientApiPath(patientId, '/readiness'), {
        headers: buildOrgHeaders(orgId ?? ''),
      });
      const payload = await readApiJson<{ data: PatientReadinessSnapshot }>(response, {
        fallbackMessage: 'オンボーディング状況の取得に失敗しました',
        schema: patientReadinessResponseSchema,
      });
      return payload.data;
    },
  });

  if (!orgId) {
    return <PatientReadinessLoadingCard />;
  }

  if (readinessQuery.isLoading) {
    return <PatientReadinessLoadingCard />;
  }

  if (readinessQuery.error instanceof Error) {
    return (
      <Card>
        <CardHeader>
          <ReadinessHeading />
        </CardHeader>
        <CardContent>
          <p role="status" aria-live="polite" className="text-sm text-destructive">
            患者の準備状況の取得に失敗しました。再試行してください。
          </p>
        </CardContent>
      </Card>
    );
  }

  const readiness = readinessQuery.data;
  if (!readiness || !readiness.applicable) {
    return (
      <Card>
        <CardHeader>
          <ReadinessHeading />
          <CardDescription>患者情報と初回訪問前の前提条件を確認します。</CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={ClipboardCheck}
            title="対象ケースがありません"
            description="紹介受領、アセスメント、稼働中のケースが作成されると readiness を表示します。"
          />
        </CardContent>
      </Card>
    );
  }

  const remainingCount = readiness.total_count - readiness.completed_count;

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <ReadinessHeading />
            <CardDescription className="mt-1">
              訪問時、報告書、他職種連携に必要な患者情報と前提条件を確認できます。
            </CardDescription>
          </div>
          <Badge variant={readiness.overall_status === 'ready' ? 'default' : 'secondary'}>
            {readiness.completed_count}/{readiness.total_count}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="outline">完了 {readiness.completed_count}</Badge>
          <Badge variant="outline">未完了 {remainingCount}</Badge>
          {readiness.current_case ? (
            <Badge variant="outline">ケース {readiness.current_case.status}</Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {readiness.items.map((item) => (
          <div
            key={item.key}
            className={`rounded-xl border p-3 ${
              item.completed
                ? 'border-l-4 border-border/70 border-l-state-done bg-card'
                : item.severity === 'high'
                  ? 'border-l-4 border-border/70 border-l-state-confirm bg-card'
                  : 'border-border/70 bg-muted/10'
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  {item.completed ? (
                    <CheckCircle2 className="size-4 text-state-done" aria-hidden="true" />
                  ) : (
                    <AlertTriangle className="size-4 text-state-confirm" aria-hidden="true" />
                  )}
                  <p className="text-sm font-medium text-foreground">{item.label}</p>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">{item.description}</p>
              </div>
              <Button asChild size="sm" variant={item.completed ? 'outline' : 'default'}>
                <Link href={item.action_href}>{item.action_label}</Link>
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
