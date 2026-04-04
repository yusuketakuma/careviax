'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import {
  MessageSquare,
  Eye,
  Brain,
  ClipboardList,
  User,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { LoadingButton } from '@/components/ui/loading-button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ResidualMedicationForm } from '@/components/features/visits/residual-medication-form';
import { SoapVoiceFieldToggle } from '@/components/features/visits/soap-voice-field-toggle';
import type { SoapVoiceField } from '@/lib/voice-recognition';

const STEPS = [
  { key: 'S', label: '主観', icon: MessageSquare, color: 'text-blue-500' },
  { key: 'O', label: '客観', icon: Eye, color: 'text-green-500' },
  { key: 'A', label: '評価', icon: Brain, color: 'text-purple-500' },
  { key: 'P', label: '計画', icon: ClipboardList, color: 'text-orange-500' },
] as const;

const relationOptions = [
  { value: 'self', label: '本人' },
  { value: 'spouse', label: '配偶者' },
  { value: 'child', label: '子' },
  { value: 'parent', label: '親' },
  { value: 'sibling', label: '兄弟姉妹' },
  { value: 'other_family', label: 'その他家族' },
  { value: 'caregiver', label: '介護者' },
  { value: 'facility_staff', label: '施設職員' },
  { value: 'other', label: 'その他' },
];

interface SoapStepWizardProps {
  isPending: boolean;
  recurrenceRule?: string | null;
  attachmentsContent?: ReactNode;
  voiceInput: {
    activeField: SoapVoiceField | null;
    error: string | null;
    interimTranscript: string;
    isOffline: boolean;
    isSupported: boolean;
    onToggle: (field: SoapVoiceField) => void;
  };
}

export function SoapStepWizard({
  isPending,
  recurrenceRule,
  attachmentsContent,
  voiceInput,
}: SoapStepWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const form = useFormContext();

  const visitDate =
    useWatch({ control: form.control, name: 'visit_date' }) ??
    new Date().toISOString().slice(0, 10);
  const receiptPersonRelation =
    useWatch({ control: form.control, name: 'receipt_person_relation' }) ?? '';
  const receiptAt =
    useWatch({ control: form.control, name: 'receipt_at' }) ?? `${visitDate}T00:00`;

  const isLastStep = currentStep === STEPS.length - 1;

  function handleNext() {
    if (!isLastStep) {
      setCurrentStep((prev) => prev + 1);
    }
  }

  function handleBack() {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setCurrentStep((prev) => Math.min(prev + 1, STEPS.length - 1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setCurrentStep((prev) => Math.max(prev - 1, 0));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const StepIcon = STEPS[currentStep].icon;

  return (
    <div className="flex min-h-0 flex-col">
      {/* Step indicator */}
      <div className="mb-4 flex flex-col items-center gap-2">
        <div className="flex items-center gap-3" role="progressbar" aria-valuenow={currentStep + 1} aria-valuemin={1} aria-valuemax={STEPS.length}>
          {STEPS.map((step, index) => (
            <div key={step.key} className="flex flex-col items-center gap-1">
              <div
                className={`flex size-8 items-center justify-center rounded-full text-xs font-bold transition-all ${
                  index === currentStep
                    ? 'bg-blue-600 text-white ring-2 ring-blue-600/30'
                    : index < currentStep
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-muted text-muted-foreground'
                }`}
                aria-label={`${step.key} ${step.label}${
                  index < currentStep ? '（完了）' : index === currentStep ? '（現在）' : ''
                }`}
              >
                {step.key}
              </div>
              <span
                className={`text-[10px] leading-none ${
                  index === currentStep ? 'font-semibold text-foreground' : 'text-muted-foreground'
                }`}
              >
                {step.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Step header */}
      <div className="mb-3 flex items-center gap-2">
        <StepIcon className={`size-5 ${STEPS[currentStep].color}`} aria-hidden="true" />
        <h3 className="text-sm font-semibold">
          {STEPS[currentStep].key} -- {STEPS[currentStep].label}
        </h3>
      </div>

      {/* Step content */}
      <div className="flex-1 space-y-4">
        {currentStep === 0 && (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="soap_subjective_mobile">
                患者の訴え・服薬状況
              </Label>
              <SoapVoiceFieldToggle
                field="soap_subjective"
                activeField={voiceInput.activeField}
                disabled={isPending}
                error={voiceInput.error}
                interimTranscript={voiceInput.interimTranscript}
                isOffline={voiceInput.isOffline}
                isSupported={voiceInput.isSupported}
                onToggle={voiceInput.onToggle}
              />
            </div>
            <Textarea
              id="soap_subjective_mobile"
              placeholder="患者・家族からの訴え、服薬状況の自己申告など"
              rows={8}
              aria-label="主観情報"
              {...form.register('soap_subjective')}
            />
          </div>
        )}

        {currentStep === 1 && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="soap_objective_mobile">
                  観察・計測所見
                </Label>
                <SoapVoiceFieldToggle
                  field="soap_objective"
                  activeField={voiceInput.activeField}
                  disabled={isPending}
                  error={voiceInput.error}
                  interimTranscript={voiceInput.interimTranscript}
                  isOffline={voiceInput.isOffline}
                  isSupported={voiceInput.isSupported}
                  onToggle={voiceInput.onToggle}
                />
              </div>
              <Textarea
                id="soap_objective_mobile"
                placeholder="残薬確認、保管状況、副作用観察、バイタル、介助者の様子など"
                rows={6}
                aria-label="客観情報"
                {...form.register('soap_objective')}
              />
            </div>
            <div className="rounded-lg border border-border p-3">
              <ResidualMedicationForm />
            </div>
          </div>
        )}

        {currentStep === 2 && (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="soap_assessment_mobile">
                薬学的評価
              </Label>
              <SoapVoiceFieldToggle
                field="soap_assessment"
                activeField={voiceInput.activeField}
                disabled={isPending}
                error={voiceInput.error}
                interimTranscript={voiceInput.interimTranscript}
                isOffline={voiceInput.isOffline}
                isSupported={voiceInput.isSupported}
                onToggle={voiceInput.onToggle}
              />
            </div>
            <Textarea
              id="soap_assessment_mobile"
              placeholder="処方の適正評価、相互作用、副作用リスク、アドヒアランス評価など"
              rows={8}
              aria-label="薬学的評価"
              {...form.register('soap_assessment')}
            />
          </div>
        )}

        {currentStep === 3 && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="soap_plan_mobile">
                  介入内容・次回対応
                </Label>
                <SoapVoiceFieldToggle
                  field="soap_plan"
                  activeField={voiceInput.activeField}
                  disabled={isPending}
                  error={voiceInput.error}
                  interimTranscript={voiceInput.interimTranscript}
                  isOffline={voiceInput.isOffline}
                  isSupported={voiceInput.isSupported}
                  onToggle={voiceInput.onToggle}
                />
              </div>
              <Textarea
                id="soap_plan_mobile"
                placeholder="介入内容、次回対応事項、多職種連携の要否、処方医への報告など"
                rows={6}
                aria-label="計画・介入"
                {...form.register('soap_plan')}
              />
            </div>

            {/* Next visit suggestion */}
            <div className="space-y-1.5">
              <Label htmlFor="next_visit_suggestion_date_mobile" className="flex items-center gap-1.5">
                <CalendarCheck className="size-3.5 text-muted-foreground" aria-hidden="true" />
                次回提案日
              </Label>
              <Input
                id="next_visit_suggestion_date_mobile"
                type="date"
                {...form.register('next_visit_suggestion_date')}
              />
              {recurrenceRule && (
                <p className="text-xs text-muted-foreground">
                  定期ルール: {recurrenceRule}
                </p>
              )}
            </div>

            {/* Receipt record */}
            <div className="space-y-3 rounded-lg border border-border p-3">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <User className="size-3.5 text-muted-foreground" aria-hidden="true" />
                受領記録
              </div>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="receipt_person_name_mobile">受領者名</Label>
                  <Input
                    id="receipt_person_name_mobile"
                    placeholder="例: 山田 花子"
                    {...form.register('receipt_person_name')}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="receipt_person_relation_mobile">続柄</Label>
                  <Select
                    value={receiptPersonRelation}
                    onValueChange={(v) => form.setValue('receipt_person_relation', v ?? undefined)}
                  >
                    <SelectTrigger id="receipt_person_relation_mobile" className="w-full">
                      <SelectValue placeholder="続柄を選択" />
                    </SelectTrigger>
                    <SelectContent>
                      {relationOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="receipt_at_mobile">受領日時</Label>
                  <Input
                    id="receipt_at_mobile"
                    type="datetime-local"
                    {...form.register('receipt_at')}
                    defaultValue={receiptAt}
                  />
                </div>
              </div>
            </div>

            {attachmentsContent ? (
              <div className="rounded-lg border border-border p-3">
                {attachmentsContent}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Bottom navigation */}
      <div className="mt-6 flex gap-3">
        {currentStep > 0 && (
          <Button
            type="button"
            variant="outline"
            className="h-12 flex-1 gap-1"
            onClick={handleBack}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            戻る
          </Button>
        )}

        {!isLastStep && (
          <Button
            type="button"
            className="h-12 flex-1 gap-1"
            onClick={handleNext}
          >
            次へ
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        )}

        {isLastStep && (
          <LoadingButton
            type="submit"
            className="h-12 w-full"
            loading={isPending}
            loadingLabel="保存中..."
          >
            保存
          </LoadingButton>
        )}
      </div>
    </div>
  );
}
