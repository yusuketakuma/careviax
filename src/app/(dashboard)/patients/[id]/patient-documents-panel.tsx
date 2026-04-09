'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { FileDown, FileQuestion } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Loading } from '@/components/ui/loading';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { ManagementPlanPanel } from './management-plan-panel';
import { ExternalShareContent } from './share/external-share-content';
import type { PatientDocumentsSnapshot, PatientOverview } from './patient-detail.types';

export function PatientDocumentsPanel({
  patientId,
  patientName,
  cases,
  enabled,
}: {
  patientId: string;
  patientName: string;
  cases: PatientOverview['cases'];
  enabled: boolean;
}) {
  const orgId = useOrgId();
  const documentsQuery = useQuery<PatientDocumentsSnapshot>({
    queryKey: ['patient-documents', patientId, orgId],
    enabled: Boolean(orgId && patientId && enabled),
    queryFn: async () => {
      const response = await fetch(`/api/patients/${patientId}/documents`, {
        headers: { 'x-org-id': orgId ?? '' },
      });
      if (!response.ok) {
        throw new Error('文書情報の取得に失敗しました');
      }
      return response.json();
    },
  });

  if (!orgId) {
    return <Loading label="文書情報を読み込み中..." />;
  }

  if (documentsQuery.isLoading) {
    return <Loading label="文書情報を読み込み中..." />;
  }

  if (documentsQuery.error instanceof Error || !documentsQuery.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">文書</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">
            {documentsQuery.error instanceof Error
              ? documentsQuery.error.message
              : '文書情報の取得に失敗しました'}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
      <ManagementPlanPanel
        patientId={patientId}
        patientName={patientName}
        cases={cases}
        orgId={orgId}
      />
      <ExternalShareContent patientId={patientId} />
      <div className="xl:col-span-2">
        <FirstVisitDocumentsPanel
          cases={cases}
          documents={documentsQuery.data.first_visit_documents}
        />
      </div>
    </div>
  );
}

function FirstVisitDocumentsPanel({
  cases,
  documents,
}: {
  cases: PatientOverview['cases'];
  documents: PatientDocumentsSnapshot['first_visit_documents'];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">初回訪問文書・交付記録</CardTitle>
      </CardHeader>
      <CardContent>
        {documents.length === 0 ? (
          <EmptyState
            icon={FileQuestion}
            title="初回訪問文書はまだありません"
            description="初回訪問の完了後に、緊急連絡先と交付記録を含む文書が自動作成されます。"
          />
        ) : (
          <div className="space-y-4">
            {documents.map((document) => {
              const careCase = cases.find((item) => item.id === document.case_id) ?? null;

              return (
                <div
                  key={document.id}
                  className="rounded-2xl border border-border/70 bg-muted/10 p-4"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-foreground">初回訪問文書</p>
                        <Badge variant="outline">
                          ケース {careCase ? careCase.status : document.case_id}
                        </Badge>
                        {document.delivered_at ? (
                          <Badge>交付記録あり</Badge>
                        ) : (
                          <Badge variant="secondary">交付未記録</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        作成日時{' '}
                        {format(new Date(document.created_at), 'yyyy/MM/dd HH:mm', { locale: ja })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        交付先 {document.delivered_to ?? '未記録'} / 交付日時{' '}
                        {document.delivered_at
                          ? format(new Date(document.delivered_at), 'yyyy/MM/dd HH:mm', {
                              locale: ja,
                            })
                          : '未記録'}
                      </p>
                    </div>

                    {document.document_url ? (
                      <Link
                        href={document.document_url}
                        target="_blank"
                        className={buttonVariants({ variant: 'outline', size: 'sm' })}
                      >
                        <FileDown className="mr-1.5 size-4" aria-hidden="true" />
                        PDF
                      </Link>
                    ) : null}
                  </div>

                  <div className="mt-4 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">緊急連絡先</p>
                    {document.emergency_contacts.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        緊急連絡先は文書作成時点で未登録でした。
                      </p>
                    ) : (
                      <div className="grid gap-2 md:grid-cols-2">
                        {document.emergency_contacts.map((contact) => (
                          <div
                            key={contact.id ?? `${document.id}-${contact.name}`}
                            className="rounded-xl border border-border/60 bg-background p-3"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium text-foreground">{contact.name}</p>
                              <Badge variant="outline">{contact.relation ?? '連絡先'}</Badge>
                              {contact.is_primary ? <Badge variant="secondary">主</Badge> : null}
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {contact.organization_name ?? '所属未登録'}
                              {contact.department ? ` / ${contact.department}` : ''}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {contact.phone ?? contact.email ?? contact.fax ?? '連絡先未登録'}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
