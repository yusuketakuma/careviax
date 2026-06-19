'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Trash2 } from 'lucide-react';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Loading } from '@/components/ui/loading';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { LoadingButton } from '@/components/ui/loading-button';
import { cn } from '@/lib/utils';
import { buildQrDraftShortcutLinks, QR_DRAFT_CONFIRM_SUCCESS_HREF } from './page.helpers';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { JahisSupplementalRecordsCard } from '@/components/features/prescriptions/jahis-supplemental-records-card';
import {
  normalizeJahisSupplementalRecords,
  type JahisSupplementalRecordDbView,
  type JahisSupplementalRecordView,
} from '@/lib/pharmacy/jahis-supplemental-records-view';
import {
  formatPrescriptionSubmitError,
  parsePrescriptionSubmitError,
} from '../../new/prescription-intake-submit';

// ── Types ──

interface JahisQRLine {
  drugName?: string;
  drugCode?: string;
  dosageForm?: string;
  dose?: string;
  frequency?: string;
  days?: number;
  quantity?: number;
  unit?: string;
  isGeneric?: boolean;
  packagingMethod?: string;
  packagingInstructions?: string;
  packagingInstructionTags?: string[];
  route?: string;
  dispensingMethod?: string;
  startDate?: string;
  endDate?: string;
  notes?: string;
}

interface JahisQRData {
  patientName?: string;
  patientNameKana?: string;
  patientBirthdate?: string;
  patientGender?: string;
  prescriptionDate?: string;
  prescriptionIssueDate?: string | null;
  prescriptionExpirationDate?: string | null;
  prescriberName?: string;
  prescriberInstitution?: string;
  prescriberInstitutionId?: string | null;
  prescriberInstitutionCode?: string;
  prescriptionInsurance?: {
    insurerNumber?: string;
    symbol?: string;
    number?: string;
    branchNumber?: string;
    patientCopayRatio?: number;
    publicSubsidies?: Array<{
      rank: number;
      payerNumber: string;
      recipientNumber?: string;
    }>;
  } | null;
  dispensingInstitution?: { name?: string; institutionCode?: string };
  remarks?: string[];
  patientNotes?: string[];
  splitInfo?: { dataId: string; splitCount: number; sequenceNumber: number } | null;
  parseWarnings?: Array<{ recordType?: string; field?: string; message: string }>;
  rawRecords?: Array<{ recordType: string; lineNumber: number; fields?: string[] }>;
  lines?: JahisQRLine[];
  supplementalRecords?: JahisSupplementalRecordView[];
}

interface AutoCompletedField {
  field: string;
  lineIndex?: number;
}

interface QrScanDraft {
  id: string;
  org_id: string;
  site_id: string;
  patient_id: string | null;
  scanned_by: string;
  session_id: string;
  status: string;
  parsed_data: JahisQRData;
  parse_errors: Array<{ field?: string; message: string }> | null;
  auto_completed: AutoCompletedField[] | null;
  expected_qr_count: number | null;
  jahis_supplemental_records?: JahisSupplementalRecordDbView[];
  created_at: string;
}

interface DraftLine {
  drug_name: string;
  drug_code: string;
  dosage_form: string;
  dose: string;
  frequency: string;
  days: number | '';
  quantity: number | '';
  unit: string;
  packaging_method: string;
  packaging_instructions: string;
  packaging_instruction_tags: string[];
  route: string;
  dispensing_method: string;
  start_date: string;
  end_date: string;
  notes: string;
  _autoCompleted: string[];
  _parseError: string;
}

interface CaseOption {
  id: string;
  status: string;
}

type DraftFormState = {
  draftId: string | null;
  lines: DraftLine[] | null;
  caseId: string | null;
  prescriberName: string | null;
  prescriberInstitution: string | null;
  prescribedDate: string | null;
};

// ── Helpers ──

const mobileDenseInputClassName = 'min-h-[44px] text-sm sm:h-8 sm:min-h-0';
const mobileDenseButtonClassName = 'min-h-[44px] sm:min-h-0';

function genderLabel(g?: string) {
  if (g === 'M' || g === '1') return '男性';
  if (g === 'F' || g === '2') return '女性';
  return g ?? '—';
}

function formatBirthdate(s?: string) {
  if (!s) return '—';
  // Handle YYYYMMDD or YYYY-MM-DD
  const cleaned = s.replace(/-/g, '');
  if (cleaned.length === 8) {
    const y = cleaned.slice(0, 4);
    const m = cleaned.slice(4, 6);
    const d = cleaned.slice(6, 8);
    return `${y}年${m}月${d}日`;
  }
  return s;
}

function buildInitialLines(
  qrLines: JahisQRLine[],
  autoCompleted: AutoCompletedField[] | null,
): DraftLine[] {
  return qrLines.map((line, idx) => {
    const autoFields = (autoCompleted ?? [])
      .filter((a) => a.lineIndex === idx || a.lineIndex == null)
      .map((a) => a.field);

    return {
      drug_name: line.drugName ?? '',
      drug_code: line.drugCode ?? '',
      dosage_form: line.dosageForm ?? '',
      dose: line.dose ?? '',
      frequency: line.frequency ?? '',
      days: line.days ?? '',
      quantity: line.quantity ?? '',
      unit: line.unit ?? '',
      packaging_method: line.packagingMethod ?? '',
      packaging_instructions: line.packagingInstructions ?? '',
      packaging_instruction_tags: line.packagingInstructionTags ?? [],
      route: line.route ?? '',
      dispensing_method: line.dispensingMethod ?? '',
      start_date: line.startDate ?? '',
      end_date: line.endDate ?? '',
      notes: line.notes ?? '',
      _autoCompleted: autoFields,
      _parseError: '',
    };
  });
}

// ── Sub-components ──

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value || '—'}</span>
    </div>
  );
}

function AutoBadge() {
  return (
    <Badge
      variant="outline"
      className="border-transparent bg-tag-info/10 text-[10px] text-tag-info py-0 px-1"
    >
      自動補完
    </Badge>
  );
}

function RequiredMarker() {
  return (
    <span className="ml-1 rounded bg-state-confirm/10 px-1 text-[10px] font-medium text-state-confirm">
      要入力
    </span>
  );
}

// ── Main Page ──

export default function QrDraftReviewPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const orgId = useOrgId();
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const [formState, setFormState] = useState<DraftFormState>({
    draftId: null,
    lines: null,
    caseId: null,
    prescriberName: null,
    prescriberInstitution: null,
    prescribedDate: null,
  });

  // Fetch draft
  const { data: draft, isLoading } = useQuery({
    queryKey: ['qr-scan-draft', id, orgId],
    queryFn: async () => {
      const res = await fetch(`/api/qr-scan-drafts/${id}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('下書きの取得に失敗しました');
      return res.json() as Promise<QrScanDraft>;
    },
    enabled: !!orgId && !!id,
  });

  // Fetch patient cases (only when patient_id is resolved)
  const { data: casesData } = useQuery({
    queryKey: ['patient-cases', draft?.patient_id, orgId],
    queryFn: async () => {
      const res = await fetch(`/api/cases?patient_id=${draft!.patient_id}&status=active&limit=20`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('ケースの取得に失敗しました');
      return res.json() as Promise<{ data: CaseOption[] }>;
    },
    enabled: !!orgId && !!draft?.patient_id,
  });

  const initialLines = buildInitialLines(
    draft?.parsed_data.lines ?? [],
    draft?.auto_completed ?? null,
  );
  const isCurrentDraftState = draft != null && formState.draftId === draft.id;
  const lines = isCurrentDraftState && formState.lines ? formState.lines : initialLines;
  const autoSelectedCaseId = casesData?.data.length === 1 ? casesData.data[0].id : '';
  const caseId =
    isCurrentDraftState && formState.caseId !== null ? formState.caseId : autoSelectedCaseId;
  const prescriberName =
    isCurrentDraftState && formState.prescriberName !== null
      ? formState.prescriberName
      : (draft?.parsed_data.prescriberName ?? '');
  const prescriberInstitution =
    isCurrentDraftState && formState.prescriberInstitution !== null
      ? formState.prescriberInstitution
      : (draft?.parsed_data.prescriberInstitution ?? '');
  const prescribedDate =
    isCurrentDraftState && formState.prescribedDate !== null
      ? formState.prescribedDate
      : (draft?.parsed_data.prescriptionDate ?? '');

  // Confirm mutation
  const confirmMutation = useMutation({
    mutationFn: async () => {
      setConfirmError(null);
      const res = await fetch(`/api/qr-scan-drafts/${id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({
          patient_id: draft!.patient_id,
          case_id: caseId,
          prescribed_date: prescribedDate,
          prescriber_name: prescriberName || undefined,
          prescriber_institution_id: draft?.parsed_data.prescriberInstitutionId ?? undefined,
          prescriber_institution: prescriberInstitution || undefined,
          lines: lines.map((l) => ({
            drug_name: l.drug_name,
            drug_code: l.drug_code || undefined,
            dosage_form: l.dosage_form || undefined,
            dose: l.dose,
            frequency: l.frequency,
            days: typeof l.days === 'number' ? l.days : Number(l.days),
            quantity: l.quantity !== '' ? Number(l.quantity) : undefined,
            unit: l.unit || undefined,
            packaging_method: l.packaging_method || undefined,
            packaging_instructions: l.packaging_instructions || undefined,
            packaging_instruction_tags:
              l.packaging_instruction_tags.length > 0 ? l.packaging_instruction_tags : undefined,
            route: l.route || undefined,
            dispensing_method: l.dispensing_method || undefined,
            start_date: l.start_date || undefined,
            end_date: l.end_date || undefined,
            notes: l.notes || undefined,
          })),
        }),
      });
      if (!res.ok) {
        throw await parsePrescriptionSubmitError(res, '確定に失敗しました');
      }
      return res.json() as Promise<{ intake: { id: string }; cycle: { id: string } }>;
    },
    onSuccess: () => {
      toast.success('処方受付を確定しました');
      router.push(QR_DRAFT_CONFIRM_SUCCESS_HREF);
    },
    onError: (err: Error) => {
      const message = formatPrescriptionSubmitError(err, '確定に失敗しました');
      setConfirmError(message);
      toast.error('確定エラー', { description: message });
    },
  });

  // Discard mutation
  const discardMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/qr-scan-drafts/${id}`, {
        method: 'DELETE',
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('破棄に失敗しました');
    },
    onSuccess: () => {
      toast.success('下書きを破棄しました');
      router.push('/prescriptions/qr-drafts');
    },
    onError: (err: Error) => {
      toast.error('破棄エラー', { description: err.message });
    },
  });

  // Validation
  const allDaysFilled = lines.every((l) => l.days !== '' && l.days !== null && Number(l.days) > 0);
  const allRequiredFilled =
    allDaysFilled &&
    lines.every(
      (l) => l.drug_name.trim() !== '' && l.dose.trim() !== '' && l.frequency.trim() !== '',
    ) &&
    !!caseId &&
    !!draft?.patient_id &&
    !!prescribedDate;

  const updateLine = (idx: number, field: keyof DraftLine, value: string | number) => {
    setFormState((prev) => {
      const activeLines = prev.draftId === draft?.id && prev.lines ? prev.lines : initialLines;
      return {
        ...prev,
        draftId: draft?.id ?? prev.draftId,
        lines: activeLines.map((line, lineIndex) =>
          lineIndex === idx ? { ...line, [field]: value } : line,
        ),
      };
    });
  };

  if (!orgId || isLoading) return <Loading />;
  if (!draft) {
    return (
      <div className="p-6 text-sm text-muted-foreground">QRスキャン下書きが見つかりません</div>
    );
  }
  const registrationHref = `/prescriptions/new?qr_draft_id=${draft.id}${
    draft.patient_id ? `&patient_id=${draft.patient_id}` : ''
  }${caseId ? `&case_id=${caseId}` : ''}`;

  if (draft.status !== 'pending') {
    return (
      <PageScaffold>
        <p className="text-sm text-muted-foreground">
          この下書きはすでに{draft.status === 'confirmed' ? '確定済み' : '破棄済み'}です。
        </p>
        <Button
          variant="outline"
          size="sm"
          className={cn('mt-3', mobileDenseButtonClassName)}
          onClick={() => router.push('/prescriptions/qr-drafts')}
        >
          一覧へ戻る
        </Button>
      </PageScaffold>
    );
  }

  const pd = draft.parsed_data;
  const cases = casesData?.data ?? [];
  const hasParseErrors = (draft.parse_errors?.length ?? 0) > 0;
  const supplementalRecords = normalizeJahisSupplementalRecords(
    pd.supplementalRecords,
    draft.jahis_supplemental_records,
  );

  return (
    <div className="space-y-6 p-3 md:p-4 xl:p-5" data-testid="qr-draft-review-workspace">
      {/* Page header */}
      <WorkflowPageIntro
        backHref="/prescriptions/qr-drafts"
        backLabel="QR下書き一覧へ戻る"
        eyebrow="QR Draft Review"
        title="QR読取下書き確認"
        description={`スキャン日時: ${format(new Date(draft.created_at), 'yyyy年M月d日 HH:mm', { locale: ja })} / セッション: ${draft.session_id.slice(0, 8)}`}
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">確認の流れ</p>
            <p className="text-sm text-muted-foreground">
              解析エラー、患者情報、処方情報を確認し、受付確定へ進みます。
            </p>
          </div>
        }
        shortcuts={buildQrDraftShortcutLinks(draft.patient_id)}
        mainWorkflowSteps={['prescriptions']}
        mainWorkflowDescription="QR 読取下書きの確認画面でも、処方登録工程の一部として現在地を揃えています。"
        actions={
          hasParseErrors ? (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="size-3" />
              解析エラーあり
            </Badge>
          ) : null
        }
      />

      {/* Parse errors banner */}
      {hasParseErrors && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <p className="font-medium mb-1">
            QR解析時にエラーが検出されました。内容を確認してください。
          </p>
          <ul className="list-disc pl-4 space-y-0.5">
            {draft.parse_errors!.map((e, i) => (
              <li key={i} className="text-xs">
                {e.field ? `[${e.field}] ` : ''}
                {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {pd.parseWarnings?.length ? (
        <div className="rounded-lg border border-state-confirm/30 bg-state-confirm/10 px-4 py-3 text-sm text-state-confirm">
          <p className="mb-1 font-medium">QR解析時の確認事項</p>
          <ul className="list-disc space-y-0.5 pl-4">
            {pd.parseWarnings.map((warning, index) => (
              <li key={`${warning.recordType ?? 'warning'}-${index}`} className="text-xs">
                {warning.recordType ? `[${warning.recordType}] ` : ''}
                {warning.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <JahisSupplementalRecordsCard
        records={supplementalRecords}
        description="OTC薬、残薬、患者等記入、かかりつけ薬剤師など、訪問前後の確認に回す補足データです。"
        gridClassName="grid gap-3 md:grid-cols-2"
      />

      {(pd.prescriptionExpirationDate ||
        pd.prescriptionInsurance ||
        (pd.rawRecords?.length ?? 0) > 0) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">QR原文から保持した請求・期限情報</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm md:grid-cols-3">
            <InfoRow
              label="交付日"
              value={pd.prescriptionIssueDate ?? pd.prescriptionDate ?? '—'}
            />
            <InfoRow label="使用期限" value={pd.prescriptionExpirationDate ?? '—'} />
            <InfoRow
              label="原文レコード"
              value={
                pd.rawRecords?.length
                  ? `${pd.rawRecords.length}件 (${Array.from(
                      new Set(pd.rawRecords.map((record) => record.recordType)),
                    ).join(', ')})`
                  : '—'
              }
            />
            {pd.prescriptionInsurance ? (
              <>
                <InfoRow
                  label="保険"
                  value={
                    [
                      pd.prescriptionInsurance.insurerNumber,
                      pd.prescriptionInsurance.symbol,
                      pd.prescriptionInsurance.number,
                      pd.prescriptionInsurance.branchNumber,
                    ]
                      .filter(Boolean)
                      .join(' / ') || 'QR記録あり'
                  }
                />
                <InfoRow
                  label="負担割合"
                  value={
                    typeof pd.prescriptionInsurance.patientCopayRatio === 'number'
                      ? `${pd.prescriptionInsurance.patientCopayRatio}%`
                      : '—'
                  }
                />
                <InfoRow
                  label="公費"
                  value={
                    pd.prescriptionInsurance.publicSubsidies?.length
                      ? pd.prescriptionInsurance.publicSubsidies
                          .map((item) =>
                            [item.payerNumber, item.recipientNumber].filter(Boolean).join(' / '),
                          )
                          .join('、')
                      : '—'
                  }
                />
              </>
            ) : null}
            {pd.dispensingInstitution?.name ? (
              <InfoRow
                label="調剤機関"
                value={[pd.dispensingInstitution.name, pd.dispensingInstitution.institutionCode]
                  .filter(Boolean)
                  .join(' / ')}
              />
            ) : null}
            {pd.splitInfo ? (
              <InfoRow
                label="分割QR"
                value={`${pd.splitInfo.sequenceNumber}/${pd.splitInfo.splitCount} (${pd.splitInfo.dataId})`}
              />
            ) : null}
            {pd.remarks?.length ? <InfoRow label="QR備考" value={pd.remarks.join(' / ')} /> : null}
            {pd.patientNotes?.length ? (
              <InfoRow label="患者特記" value={pd.patientNotes.join(' / ')} />
            ) : null}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Patient info */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">患者情報</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <InfoRow label="氏名" value={pd.patientName ?? ''} />
            <InfoRow label="カナ" value={pd.patientNameKana ?? ''} />
            <InfoRow label="生年月日" value={formatBirthdate(pd.patientBirthdate)} />
            <InfoRow label="性別" value={genderLabel(pd.patientGender)} />
          </CardContent>
        </Card>

        {/* Prescriber info */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">処方箋情報</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="qr-draft-prescribed-date" className="text-xs">
                処方日 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="qr-draft-prescribed-date"
                type="date"
                value={prescribedDate}
                onChange={(e) =>
                  setFormState((prev) => ({
                    ...prev,
                    draftId: draft.id,
                    prescribedDate: e.target.value,
                  }))
                }
                className={mobileDenseInputClassName}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="qr-draft-prescriber-name" className="text-xs">
                処方医師名
              </Label>
              <Input
                id="qr-draft-prescriber-name"
                value={prescriberName}
                onChange={(e) =>
                  setFormState((prev) => ({
                    ...prev,
                    draftId: draft.id,
                    prescriberName: e.target.value,
                  }))
                }
                className={mobileDenseInputClassName}
                placeholder="例: 田中 太郎"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="qr-draft-prescriber-institution" className="text-xs">
                処方医療機関
              </Label>
              <Input
                id="qr-draft-prescriber-institution"
                value={prescriberInstitution}
                onChange={(e) =>
                  setFormState((prev) => ({
                    ...prev,
                    draftId: draft.id,
                    prescriberInstitution: e.target.value,
                  }))
                }
                className={mobileDenseInputClassName}
                placeholder="例: ○○クリニック"
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Case selector */}
      {draft.patient_id && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">
              ケース選択 <span className="text-destructive">*</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {cases.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                この患者に紐付くアクティブなケースが見つかりません。
              </p>
            ) : (
              <Select
                value={caseId}
                onValueChange={(value) =>
                  setFormState((prev) => ({
                    ...prev,
                    draftId: draft.id,
                    caseId: value,
                  }))
                }
              >
                <SelectTrigger
                  aria-label="QR下書きのケース選択"
                  className={mobileDenseInputClassName}
                >
                  <SelectValue placeholder="ケースを選択してください" />
                </SelectTrigger>
                <SelectContent>
                  {cases.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.id.slice(0, 8)}… ({c.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </CardContent>
        </Card>
      )}

      {!draft.patient_id && (
        <div className="rounded-lg border border-state-confirm/30 bg-state-confirm/10 px-4 py-3 text-sm text-state-confirm">
          <p className="font-medium">患者が未紐付けです</p>
          <p className="text-xs mt-1">
            患者IDが解決されていないため確定できません。QRスキャン一覧から患者を紐付けてください。
          </p>
        </div>
      )}

      {/* Medication lines editor */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">処方明細</CardTitle>
          <p className="text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 mr-3">
              <Badge
                variant="outline"
                className="border-transparent bg-tag-info/10 text-[10px] text-tag-info py-0 px-1"
              >
                自動補完
              </Badge>
              QRから自動入力されたフィールド
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="rounded bg-state-confirm/10 px-1 text-[10px] font-medium text-state-confirm">
                要入力
              </span>
              入力が必要なフィールド
            </span>
          </p>
        </CardHeader>
        <CardContent>
          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              処方明細が見つかりません
            </p>
          ) : (
            <div className="space-y-4">
              {lines.map((line, idx) => {
                const isAutoName = line._autoCompleted.includes('drug_name');
                const isAutoDose = line._autoCompleted.includes('dose');
                const isAutoFreq = line._autoCompleted.includes('frequency');
                const isAutoDays = line._autoCompleted.includes('days');
                const isDaysMissing =
                  line.days === '' || line.days === null || Number(line.days) <= 0;
                const isDrugMissing = line.drug_name.trim() === '';
                const isDoseMissing = line.dose.trim() === '';
                const isFreqMissing = line.frequency.trim() === '';

                return (
                  <div
                    key={idx}
                    className={cn(
                      'rounded-lg border p-4 space-y-3',
                      line._parseError ? 'border-destructive/40 bg-destructive/5' : 'border-border',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-medium">
                        {idx + 1}
                      </span>
                      {line._parseError && (
                        <span className="text-xs text-destructive">{line._parseError}</span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {/* Drug name */}
                      <div className="space-y-1 lg:col-span-2">
                        <div className="flex items-center gap-1">
                          <Label htmlFor={`qr-draft-line-${idx}-drug-name`} className="text-xs">
                            薬剤名 <span className="text-destructive">*</span>
                          </Label>
                          {isAutoName && <AutoBadge />}
                          {isDrugMissing && <RequiredMarker />}
                        </div>
                        <Input
                          id={`qr-draft-line-${idx}-drug-name`}
                          value={line.drug_name}
                          onChange={(e) => updateLine(idx, 'drug_name', e.target.value)}
                          className={cn(
                            mobileDenseInputClassName,
                            isDrugMissing &&
                              'border-state-confirm/50 bg-state-confirm/10 focus-visible:ring-state-confirm',
                          )}
                          placeholder="例: アムロジピン錠5mg"
                        />
                      </div>

                      {/* Drug code */}
                      <div className="space-y-1">
                        <Label htmlFor={`qr-draft-line-${idx}-drug-code`} className="text-xs">
                          薬剤コード (YJ)
                        </Label>
                        <Input
                          id={`qr-draft-line-${idx}-drug-code`}
                          value={line.drug_code}
                          onChange={(e) => updateLine(idx, 'drug_code', e.target.value)}
                          className={cn(mobileDenseInputClassName, 'font-mono')}
                          placeholder="例: 2171013F1028"
                        />
                      </div>

                      {/* Dose */}
                      <div className="space-y-1">
                        <div className="flex items-center gap-1">
                          <Label htmlFor={`qr-draft-line-${idx}-dose`} className="text-xs">
                            用量 <span className="text-destructive">*</span>
                          </Label>
                          {isAutoDose && <AutoBadge />}
                          {isDoseMissing && <RequiredMarker />}
                        </div>
                        <Input
                          id={`qr-draft-line-${idx}-dose`}
                          value={line.dose}
                          onChange={(e) => updateLine(idx, 'dose', e.target.value)}
                          className={cn(
                            mobileDenseInputClassName,
                            isDoseMissing &&
                              'border-state-confirm/50 bg-state-confirm/10 focus-visible:ring-state-confirm',
                          )}
                          placeholder="例: 1錠"
                        />
                      </div>

                      {/* Frequency */}
                      <div className="space-y-1">
                        <div className="flex items-center gap-1">
                          <Label htmlFor={`qr-draft-line-${idx}-frequency`} className="text-xs">
                            用法 <span className="text-destructive">*</span>
                          </Label>
                          {isAutoFreq && <AutoBadge />}
                          {isFreqMissing && <RequiredMarker />}
                        </div>
                        <Input
                          id={`qr-draft-line-${idx}-frequency`}
                          value={line.frequency}
                          onChange={(e) => updateLine(idx, 'frequency', e.target.value)}
                          className={cn(
                            mobileDenseInputClassName,
                            isFreqMissing &&
                              'border-state-confirm/50 bg-state-confirm/10 focus-visible:ring-state-confirm',
                          )}
                          placeholder="例: 1日1回朝食後"
                        />
                      </div>

                      {/* Days */}
                      <div className="space-y-1">
                        <div className="flex items-center gap-1">
                          <Label htmlFor={`qr-draft-line-${idx}-days`} className="text-xs">
                            日数 <span className="text-destructive">*</span>
                          </Label>
                          {isAutoDays && <AutoBadge />}
                          {isDaysMissing && <RequiredMarker />}
                        </div>
                        <Input
                          id={`qr-draft-line-${idx}-days`}
                          type="number"
                          min={1}
                          value={line.days === '' ? '' : line.days}
                          onChange={(e) => {
                            const v = e.target.value;
                            updateLine(idx, 'days', v === '' ? '' : Number(v));
                          }}
                          className={cn(
                            mobileDenseInputClassName,
                            isDaysMissing &&
                              'border-state-confirm/50 bg-state-confirm/10 focus-visible:ring-state-confirm',
                          )}
                          placeholder="例: 28"
                        />
                      </div>

                      {/* Quantity + unit */}
                      <div className="space-y-1">
                        <span className="block text-xs font-medium">数量 / 単位</span>
                        <div className="flex gap-2">
                          <Input
                            aria-label={`処方明細${idx + 1}件目の数量`}
                            type="number"
                            min={0}
                            step={0.1}
                            value={line.quantity === '' ? '' : line.quantity}
                            onChange={(e) => {
                              const v = e.target.value;
                              updateLine(idx, 'quantity', v === '' ? '' : Number(v));
                            }}
                            className={cn(mobileDenseInputClassName, 'w-20')}
                            placeholder="数量"
                          />
                          <Input
                            aria-label={`処方明細${idx + 1}件目の単位`}
                            value={line.unit}
                            onChange={(e) => updateLine(idx, 'unit', e.target.value)}
                            className={cn(mobileDenseInputClassName, 'w-20')}
                            placeholder="単位"
                          />
                        </div>
                      </div>

                      {/* Dosage form */}
                      <div className="space-y-1">
                        <Label htmlFor={`qr-draft-line-${idx}-dosage-form`} className="text-xs">
                          剤形
                        </Label>
                        <Input
                          id={`qr-draft-line-${idx}-dosage-form`}
                          value={line.dosage_form}
                          onChange={(e) => updateLine(idx, 'dosage_form', e.target.value)}
                          className={mobileDenseInputClassName}
                          placeholder="例: 錠"
                        />
                      </div>

                      {/* Start date */}
                      <div className="space-y-1">
                        <Label htmlFor={`qr-draft-line-${idx}-start-date`} className="text-xs">
                          開始日
                        </Label>
                        <Input
                          id={`qr-draft-line-${idx}-start-date`}
                          type="date"
                          value={line.start_date}
                          onChange={(e) => updateLine(idx, 'start_date', e.target.value)}
                          className={mobileDenseInputClassName}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`qr-draft-line-${idx}-end-date`} className="text-xs">
                          終了日
                        </Label>
                        <Input
                          id={`qr-draft-line-${idx}-end-date`}
                          type="date"
                          value={line.end_date}
                          onChange={(e) => updateLine(idx, 'end_date', e.target.value)}
                          className={mobileDenseInputClassName}
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <Label
                        htmlFor={`qr-draft-line-${idx}-packaging-instructions`}
                        className="text-xs"
                      >
                        包装指示
                      </Label>
                      <Input
                        id={`qr-draft-line-${idx}-packaging-instructions`}
                        value={line.packaging_instructions}
                        onChange={(e) => updateLine(idx, 'packaging_instructions', e.target.value)}
                        className={mobileDenseInputClassName}
                        placeholder="例: 一包化 / 粉砕 / 別包"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor={`qr-draft-line-${idx}-notes`} className="text-xs">
                        備考
                      </Label>
                      <Input
                        id={`qr-draft-line-${idx}-notes`}
                        value={line.notes}
                        onChange={(e) => updateLine(idx, 'notes', e.target.value)}
                        className={mobileDenseInputClassName}
                        placeholder="例: 冷所保管"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {confirmError ? (
        <div
          role="alert"
          className="whitespace-pre-line rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {confirmError}
        </div>
      ) : null}

      {/* Validation summary */}
      {!allRequiredFilled && (
        <div className="rounded-lg border border-state-confirm/30 bg-state-confirm/10 px-4 py-3 text-sm text-state-confirm">
          <p className="font-medium">確定するには以下を入力してください</p>
          <ul className="mt-1 list-disc pl-4 text-xs space-y-0.5">
            {!prescribedDate && <li>処方日</li>}
            {!draft.patient_id && <li>患者の紐付け</li>}
            {!caseId && draft.patient_id && <li>ケースの選択</li>}
            {lines.some((l) => l.drug_name.trim() === '') && <li>薬剤名（すべての行）</li>}
            {lines.some((l) => l.dose.trim() === '') && <li>用量（すべての行）</li>}
            {lines.some((l) => l.frequency.trim() === '') && <li>用法（すべての行）</li>}
            {!allDaysFilled && <li>日数（すべての行）</li>}
          </ul>
        </div>
      )}

      {/* Actions */}
      <Separator />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  'gap-1.5 text-destructive hover:text-destructive',
                  mobileDenseButtonClassName,
                )}
                disabled={discardMutation.isPending || confirmMutation.isPending}
              />
            }
          >
            <Trash2 className="size-4" />
            破棄
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>下書きを破棄しますか？</AlertDialogTitle>
              <AlertDialogDescription>
                この操作は取り消せません。QRスキャン下書きを破棄します。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className={mobileDenseButtonClassName}>
                キャンセル
              </AlertDialogCancel>
              <AlertDialogAction
                className={cn(
                  'bg-destructive text-destructive-foreground hover:bg-destructive/90',
                  mobileDenseButtonClassName,
                )}
                onClick={() => discardMutation.mutate()}
              >
                破棄する
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link
            href={registrationHref}
            className={cn(
              'inline-flex h-10 min-h-[44px] items-center justify-center rounded-lg border border-input bg-background px-4 text-sm font-medium hover:bg-accent sm:min-h-0',
            )}
          >
            処方登録画面で編集
          </Link>
          <Button
            variant="outline"
            className={mobileDenseButtonClassName}
            onClick={() => router.push('/prescriptions/qr-drafts')}
            disabled={confirmMutation.isPending || discardMutation.isPending}
          >
            キャンセル
          </Button>
          <LoadingButton
            loading={confirmMutation.isPending}
            loadingLabel="確定中..."
            className={mobileDenseButtonClassName}
            disabled={!allRequiredFilled}
            onClick={() => confirmMutation.mutate()}
          >
            <CheckCircle2 className="mr-1.5 size-4" />
            確定
          </LoadingButton>
        </div>
      </div>
    </div>
  );
}
