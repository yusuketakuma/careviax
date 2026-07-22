import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { LoadingButton } from '@/components/ui/loading-button';

export interface DuplicatePatient {
  id: string;
  name: string;
  name_kana: string | null;
  birth_date: string;
  gender: string;
}

export function PatientFormActions({
  activeDuplicates,
  duplicateConfirmed,
  onOpenDuplicate,
  onConfirmDuplicate,
  currentStepIndex,
  stepCount,
  nextStepLabel,
  onPreviousStep,
  onNextStep,
  onCancel,
  isSubmitting,
  patientId,
  revisionAuthorityAvailable,
}: {
  activeDuplicates: DuplicatePatient[];
  duplicateConfirmed: boolean;
  onOpenDuplicate: (patientId: string) => void;
  onConfirmDuplicate: () => void;
  currentStepIndex: number;
  stepCount: number;
  nextStepLabel?: string;
  onPreviousStep: () => void;
  onNextStep: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
  patientId?: string;
  revisionAuthorityAvailable: boolean;
}) {
  return (
    <>
      {activeDuplicates.length > 0 && !duplicateConfirmed && (
        <Alert
          variant="default"
          className="border-state-confirm/40 bg-state-confirm/5 text-state-confirm"
        >
          <AlertTriangle className="h-4 w-4 text-state-confirm" />
          <AlertDescription className="space-y-2">
            <p className="font-medium">同名の患者が存在します:</p>
            <ul className="list-disc pl-5 text-sm">
              {activeDuplicates.map((d) => {
                const birth = new Date(d.birth_date);
                const birthStr = `${birth.getFullYear()}年${birth.getMonth() + 1}月${birth.getDate()}日生`;
                const genderLabel =
                  d.gender === 'male' ? '男性' : d.gender === 'female' ? '女性' : 'その他';
                return (
                  <li key={d.id} className="flex flex-wrap items-center gap-2">
                    <span>
                      {d.name}（{birthStr}・{genderLabel}）
                    </span>
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-state-confirm underline-offset-2"
                      onClick={() => onOpenDuplicate(d.id)}
                    >
                      既存患者を開く
                    </Button>
                  </li>
                );
              })}
            </ul>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 border-state-confirm/50 text-state-confirm hover:bg-state-confirm/10"
              onClick={onConfirmDuplicate}
            >
              それでも登録する
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* 段階ナビ: 任意ステップを順に進む。登録ボタンは常時表示(Step1 のみで登録可)。 */}
      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onPreviousStep}
          disabled={currentStepIndex === 0 || isSubmitting}
        >
          ← 戻る
        </Button>
        {currentStepIndex < stepCount - 1 ? (
          <Button type="button" variant="outline" size="sm" onClick={onNextStep}>
            次へ: {nextStepLabel} →
          </Button>
        ) : (
          <span />
        )}
      </div>

      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          キャンセル
        </Button>
        <LoadingButton
          type="submit"
          loading={isSubmitting}
          loadingLabel={patientId ? '保存中...' : '登録中...'}
          aria-describedby={
            patientId && !revisionAuthorityAvailable ? 'patient-revision-unavailable' : undefined
          }
          disabled={
            (activeDuplicates.length > 0 && !duplicateConfirmed) ||
            Boolean(patientId && !revisionAuthorityAvailable)
          }
        >
          {patientId ? '保存する' : '登録する'}
        </LoadingButton>
      </div>
    </>
  );
}
