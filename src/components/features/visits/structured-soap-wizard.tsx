'use client';

import { useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { StructuredSoap, SoapSubjective, SoapObjective, SoapAssessment, SoapPlan, ResidualMedicationEntry } from '@/types/structured-soap';
import { SubjectiveStep } from './soap-steps/subjective-step';
import { ObjectiveBasicStep } from './soap-steps/objective-basic-step';
import { FunctionalAssessmentStep } from './soap-steps/functional-assessment-step';
import { AssessmentStep } from './soap-steps/assessment-step';
import { PlanStep } from './soap-steps/plan-step';

export interface StructuredSoapWizardProps {
  initialData?: Partial<StructuredSoap>;
  onComplete: (data: StructuredSoap) => void;
  onCancel: () => void;
}

const DEFAULT_SUBJECTIVE: SoapSubjective = {
  symptom_checks: [],
  free_text: undefined,
};

const DEFAULT_OBJECTIVE: SoapObjective = {
  vitals: {},
  lab_values: undefined,
  medication_status: 'full_compliance',
  adherence_score: 5,
  self_management_ability: undefined,
  medication_calendar_used: undefined,
  side_effect_checks: [],
  functional_assessment: undefined,
  adverse_events: undefined,
  free_text: undefined,
};

const DEFAULT_ASSESSMENT: SoapAssessment = {
  problem_checks: [],
  severity: undefined,
  drug_related_problems: undefined,
  free_text: undefined,
};

const DEFAULT_PLAN: SoapPlan = {
  intervention_checks: [],
  next_visit_date: undefined,
  prescription_proposal: undefined,
  physician_report_items: undefined,
  care_manager_report_items: undefined,
  care_service_coordination: undefined,
  free_text: undefined,
};

const STEP_LABELS = [
  'S（主観）',
  'O-基本',
  'O-機能',
  'A（評価）',
  'P（計画）',
] as const;

const TOTAL_STEPS = STEP_LABELS.length;

export function StructuredSoapWizard({
  initialData,
  onComplete,
  onCancel,
}: StructuredSoapWizardProps) {
  const [step, setStep] = useState(0);
  const [subjective, setSubjective] = useState<SoapSubjective>(
    initialData?.subjective ?? DEFAULT_SUBJECTIVE
  );
  const [objective, setObjective] = useState<SoapObjective>(
    initialData?.objective ?? DEFAULT_OBJECTIVE
  );
  const [assessment, setAssessment] = useState<SoapAssessment>(
    initialData?.assessment ?? DEFAULT_ASSESSMENT
  );
  const [plan, setPlan] = useState<SoapPlan>(initialData?.plan ?? DEFAULT_PLAN);
  const [residualMedications, setResidualMedications] = useState<ResidualMedicationEntry[]>(
    initialData?.residual_medications ?? []
  );

  function handleNext() {
    if (step < TOTAL_STEPS - 1) {
      setStep((prev) => prev + 1);
    } else {
      handleComplete();
    }
  }

  function handleBack() {
    if (step > 0) {
      setStep((prev) => prev - 1);
    } else {
      onCancel();
    }
  }

  function handleComplete() {
    const data: StructuredSoap = {
      subjective,
      objective,
      assessment,
      plan,
      residual_medications: residualMedications.length > 0 ? residualMedications : undefined,
    };
    onComplete(data);
  }

  const isLastStep = step === TOTAL_STEPS - 1;

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b border-border px-4 pt-4 pb-3">
        <div className="flex items-center gap-3 mb-3">
          <button
            type="button"
            onClick={handleBack}
            className="flex items-center justify-center size-10 rounded-full hover:bg-accent"
            aria-label="前に戻る"
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </button>
          <h2 className="text-base font-semibold text-foreground flex-1">
            {STEP_LABELS[step]}
          </h2>
          <span className="text-xs text-muted-foreground">
            {step + 1} / {TOTAL_STEPS}
          </span>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center justify-center gap-2" role="progressbar" aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={TOTAL_STEPS}>
          {STEP_LABELS.map((label, index) => (
            <div
              key={label}
              className={`rounded-full transition-all ${
                index === step
                  ? 'size-2.5 bg-primary'
                  : index < step
                  ? 'size-2 bg-primary/50'
                  : 'size-2 bg-muted'
              }`}
              aria-label={`${label}${index < step ? '（完了）' : index === step ? '（現在）' : ''}`}
            />
          ))}
        </div>
      </div>

      {/* Step Content */}
      <div className="flex-1 overflow-y-auto px-4 py-5 pb-28">
        {step === 0 && (
          <SubjectiveStep
            data={subjective}
            onChange={setSubjective}
          />
        )}
        {step === 1 && (
          <ObjectiveBasicStep
            data={objective}
            onChange={setObjective}
          />
        )}
        {step === 2 && (
          <FunctionalAssessmentStep
            data={objective}
            residualMedications={residualMedications}
            onChange={setObjective}
            onResidualMedicationsChange={setResidualMedications}
          />
        )}
        {step === 3 && (
          <AssessmentStep
            data={assessment}
            onChange={setAssessment}
          />
        )}
        {step === 4 && (
          <PlanStep
            data={plan}
            onChange={setPlan}
          />
        )}
      </div>

      {/* Bottom Fixed Navigation */}
      <div className="fixed bottom-0 left-0 right-0 z-10 bg-background border-t border-border px-4 pt-3 pb-safe">
        <div className="pb-3 flex gap-3">
          {step > 0 && (
            <Button
              type="button"
              variant="outline"
              className="h-12 flex-1"
              onClick={handleBack}
            >
              戻る
            </Button>
          )}
          {step === 0 && (
            <Button
              type="button"
              variant="ghost"
              className="h-12 flex-1 text-muted-foreground"
              onClick={onCancel}
            >
              キャンセル
            </Button>
          )}
          <Button
            type="button"
            className="h-12 flex-1"
            onClick={handleNext}
          >
            {isLastStep ? '完了' : '次へ'}
          </Button>
        </div>
      </div>
    </div>
  );
}
