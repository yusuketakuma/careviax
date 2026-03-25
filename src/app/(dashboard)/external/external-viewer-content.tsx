'use client';

import { Eye, Lock, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// --- Sample data (placeholder) ---

const SAMPLE_PATIENTS = [
  {
    id: 'p_001',
    name: '山田 太郎',
    name_kana: 'ヤマダ タロウ',
    medications: ['アムロジピン錠5mg 1錠 朝', 'メトホルミン錠250mg 1錠 昼'],
    nextVisit: '2026-03-28',
  },
  {
    id: 'p_002',
    name: '鈴木 花子',
    name_kana: 'スズキ ハナコ',
    medications: ['ロスバスタチン錠2.5mg 1錠 朝', 'ゾルピデム錠5mg 0.5錠 眠前'],
    nextVisit: '2026-03-30',
  },
];

export function ExternalViewerContent() {
  return (
    <div className="space-y-4">
      {/* Role notice */}
      <div className="flex items-start gap-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-medium">外部連携者モード</p>
          <p className="mt-0.5 text-blue-700">
            このビューは閲覧専用です。患者情報の編集はできません。
            アクセス権限のある患者情報のみ表示されます。
          </p>
        </div>
      </div>

      {/* Permission indicator */}
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="flex items-center gap-1 text-xs text-gray-700">
          <Eye className="size-3" aria-hidden="true" />
          閲覧のみ
        </Badge>
        <Badge variant="outline" className="flex items-center gap-1 text-xs text-gray-500">
          <Lock className="size-3" aria-hidden="true" />
          編集不可
        </Badge>
      </div>

      {/* Patient list (read-only) */}
      <div className="space-y-3">
        {SAMPLE_PATIENTS.map((patient) => (
          <Card key={patient.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {patient.name}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {patient.name_kana}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">現在の服薬</p>
                <ul className="space-y-0.5">
                  {patient.medications.map((med, i) => (
                    <li key={i} className="text-sm">{med}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  次回訪問予定: <span className="font-medium text-foreground">{patient.nextVisit}</span>
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Phase 2 notice */}
      <div className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
        外部連携者向けの詳細機能（同意書確認、報告書閲覧等）は Phase 2 フル実装予定です。
      </div>
    </div>
  );
}
