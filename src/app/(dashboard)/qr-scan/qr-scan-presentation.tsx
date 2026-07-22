import { Camera, CheckCircle, RotateCcw, ScanLine } from 'lucide-react';
import { getQrScanShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { Button } from '@/components/ui/button';
import { PageSection } from '@/components/layout/page-section';
import { ActionRail } from '@/components/ui/action-rail';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { JahisQRData } from '@/lib/pharmacy/jahis-qr';

export interface QrScanPatientMatch {
  id: string;
  name: string;
  name_kana: string;
  birth_date: string;
  gender: string;
}

interface QrScanPageIntroProps {
  canReset: boolean;
  onReset: () => void;
}

export function QrScanPageIntro({ canReset, onReset }: QrScanPageIntroProps) {
  return (
    <WorkflowPageIntro
      backHref="/prescriptions"
      backLabel="処方受付へ戻る"
      title="お薬手帳 QR スキャン"
      description="読取後は QR 下書き一覧、処方受付、ワークフローへ横移動できます。"
      supportingContent={
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">操作の流れ</p>
          <p className="text-sm text-muted-foreground">
            スキャン、確認、下書き化、患者登録または受付導線への移動を順に行います。
          </p>
        </div>
      }
      className="mb-0"
      shortcuts={getQrScanShortcutLinks()}
      mainWorkflowSteps={['prescriptions']}
      mainWorkflowDescription="QR スキャンは処方登録の前段支援として扱い、受付確定へ戻る位置を明示しています。"
      actions={
        canReset ? (
          <Button variant="outline" size="sm" onClick={onReset}>
            <RotateCcw className="mr-1.5 h-4 w-4" />
            やり直す
          </Button>
        ) : null
      }
    />
  );
}

interface QrScanContinuationProps {
  progressLabel: string;
  totalQrCount: number | null;
  onContinue: () => void;
  onComplete: () => void;
}

export function QrScanContinuation({
  progressLabel,
  totalQrCount,
  onContinue,
  onComplete,
}: QrScanContinuationProps) {
  return (
    <PageSection
      title={progressLabel}
      description={
        totalQrCount != null
          ? `このお薬手帳はQRコードが${totalQrCount}枚あります。残りをスキャンするか、この内容で送信してください。`
          : '続けて別のQRコードをスキャンするか、この内容で送信してください。'
      }
      actions={<ScanLine className="h-5 w-5 text-primary" aria-hidden="true" />}
      contentClassName="space-y-3"
    >
      <ActionRail align="between">
        <Button className="flex-1" variant="outline" onClick={onContinue}>
          <Camera className="mr-1.5 h-4 w-4" />
          次のQRをスキャン
        </Button>
        <Button className="flex-1" onClick={onComplete}>
          <CheckCircle className="mr-1.5 h-4 w-4" />
          スキャン完了
        </Button>
      </ActionRail>
    </PageSection>
  );
}

export function QrScanMedicationList({ data }: { data: JahisQRData }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        薬剤 ({data.medications.length}件)
      </h3>
      {data.medications.length === 0 ? (
        <p className="text-sm text-muted-foreground">薬剤情報が読み取れませんでした</p>
      ) : (
        <ul className="space-y-2">
          {data.medications.map((med, index) => (
            <li
              key={index}
              className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm"
            >
              <p className="font-medium">{med.drugName}</p>
              <div className="mt-0.5 flex flex-wrap gap-2 text-xs text-muted-foreground">
                {med.dose && (
                  <span>
                    {med.dose}
                    {med.unit || ''}
                  </span>
                )}
                {med.usage && <span>{med.usage}</span>}
                {med.daysOrTimes && <span>{med.daysOrTimes}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface QrScanPatientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patients: QrScanPatientMatch[];
  selectedPatientId: string | undefined;
  qrBirthDate: string | undefined;
  onSelect: (patient: QrScanPatientMatch) => void;
}

export function QrScanPatientDialog({
  open,
  onOpenChange,
  patients,
  selectedPatientId,
  qrBirthDate,
  onSelect,
}: QrScanPatientDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>患者を選択</DialogTitle>
          <DialogDescription>
            QR コードの患者情報に一致する候補が複数あります。正しい患者を選択してください。
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-60 space-y-2 overflow-y-auto">
          {patients.map((patient) => (
            <button
              key={patient.id}
              type="button"
              className={cn(
                'flex w-full items-center justify-between rounded-md border p-3 text-left transition-colors',
                'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'min-h-[44px]',
                selectedPatientId === patient.id && 'border-primary bg-primary/5',
              )}
              onClick={() => onSelect(patient)}
            >
              <div>
                <p className="text-sm font-medium">{patient.name}</p>
                <p className="text-xs text-muted-foreground">
                  {patient.name_kana} / {patient.birth_date}
                </p>
              </div>
              {qrBirthDate && patient.birth_date?.startsWith(qrBirthDate) && (
                <Badge variant="secondary">生年月日一致</Badge>
              )}
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            閉じる
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
