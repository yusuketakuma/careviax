'use client';

import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loading } from '@/components/ui/loading';
import { EmptyState } from '@/components/ui/empty-state';
import { CasesTab } from './cases-tab';
import { PrescriptionHistoryContent } from './prescriptions/prescription-history-content';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { FileQuestion } from 'lucide-react';

type Patient = {
  id: string;
  name: string;
  name_kana: string;
  birth_date: string;
  gender: string;
  phone: string | null;
  medical_insurance_number: string | null;
  care_insurance_number: string | null;
  residences: Array<{
    id: string;
    address: string;
    is_primary: boolean;
  }>;
  cases: Array<{
    id: string;
    status: string;
    referral_source: string | null;
    referral_date: string | null;
    start_date: string | null;
    end_date: string | null;
    notes: string | null;
    created_at: string;
    updated_at: string;
    care_team_links: Array<{
      id: string;
      role: string;
      name: string;
      organization_name: string | null;
      phone: string | null;
    }>;
  }>;
};

const genderLabel: Record<string, string> = {
  male: '男性',
  female: '女性',
  other: 'その他',
};

interface PatientDetailTabsProps {
  patientId: string;
}

export function PatientDetailTabs({ patientId }: PatientDetailTabsProps) {
  const orgId = useOrgId();

  const { data: patient, isLoading, error } = useQuery<Patient>({
    queryKey: ['patient', patientId, orgId],
    queryFn: async () => {
      const res = await fetch(`/api/patients/${patientId}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('患者情報の取得に失敗しました');
      return res.json();
    },
    enabled: !!orgId,
  });

  if (isLoading) return <Loading />;
  if (error || !patient) {
    return (
      <EmptyState
        icon={FileQuestion}
        title="患者が見つかりません"
        description="指定された患者情報を取得できませんでした"
      />
    );
  }

  const primaryResidence = patient.residences.find((r) => r.is_primary);

  return (
    <div>
      {/* Patient header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {patient.name}
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{patient.name_kana}</p>
      </div>

      <Tabs defaultValue="basic">
        <TabsList variant="line" className="mb-4 w-full overflow-x-auto">
          <TabsTrigger value="basic">基本情報</TabsTrigger>
          <TabsTrigger value="cases">ケース</TabsTrigger>
          <TabsTrigger value="prescriptions">処方履歴</TabsTrigger>
          <TabsTrigger value="medications">薬剤</TabsTrigger>
          <TabsTrigger value="visits">訪問</TabsTrigger>
          <TabsTrigger value="communications">連携</TabsTrigger>
          <TabsTrigger value="documents">文書</TabsTrigger>
          <TabsTrigger value="timeline">タイムライン</TabsTrigger>
        </TabsList>

        {/* 基本情報タブ */}
        <TabsContent value="basic">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">患者情報</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-3 text-sm">
                  <InfoRow label="氏名" value={patient.name} />
                  <InfoRow label="フリガナ" value={patient.name_kana} />
                  <InfoRow
                    label="生年月日"
                    value={format(parseISO(patient.birth_date), 'yyyy年M月d日', { locale: ja })}
                  />
                  <InfoRow label="性別" value={genderLabel[patient.gender] ?? patient.gender} />
                  <InfoRow label="電話番号" value={patient.phone ?? '—'} />
                  <InfoRow label="住所" value={primaryResidence?.address ?? '—'} />
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">保険情報</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-3 text-sm">
                  <InfoRow
                    label="医療保険番号"
                    value={patient.medical_insurance_number ?? '—'}
                  />
                  <InfoRow
                    label="介護保険番号"
                    value={patient.care_insurance_number ?? '—'}
                  />
                </dl>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ケースタブ */}
        <TabsContent value="cases">
          <CasesTab patient={patient} orgId={orgId} />
        </TabsContent>

        {/* 処方履歴タブ */}
        <TabsContent value="prescriptions">
          <PrescriptionHistoryContent />
        </TabsContent>

        {/* プレースホルダータブ群 */}
        <TabsContent value="medications">
          <PlaceholderTab title="薬剤情報" description="薬剤プロファイル機能は今後実装予定です" />
        </TabsContent>
        <TabsContent value="visits">
          <PlaceholderTab title="訪問履歴" description="訪問記録機能は今後実装予定です" />
        </TabsContent>
        <TabsContent value="communications">
          <PlaceholderTab title="多職種連携" description="コミュニケーション機能は今後実装予定です" />
        </TabsContent>
        <TabsContent value="documents">
          <PlaceholderTab title="文書管理" description="同意書・計画書管理機能は今後実装予定です" />
        </TabsContent>
        <TabsContent value="timeline">
          <PlaceholderTab title="タイムライン" description="全イベント統合タイムラインは今後実装予定です" />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-4">
      <dt className="w-32 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}

function PlaceholderTab({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-[200px] items-center justify-center rounded-lg border border-dashed border-border bg-muted/20">
      <div className="text-center">
        <p className="font-medium text-foreground">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
