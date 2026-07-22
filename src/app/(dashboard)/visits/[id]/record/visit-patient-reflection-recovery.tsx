'use client';

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import { toast } from 'sonner';
import type { ScheduleDetail, PendingPatientReflectionSubmission } from './visit-record-form-model';
import {
  clearPatientReflectionContinuation,
  patchPatientReflection,
  loadPatientReflectionContinuation,
  persistPatientReflectionContinuation,
  requiresPatientReflectionCareCaseTarget,
} from './visit-patient-reflection';

type HeaderAuthority = {
  patientId: string;
  patientUpdatedAt: string;
  intakeEditTarget: { careCaseId: string; expectedCareCaseVersion: number } | null;
};

type RefetchResult<T> = { data: T | undefined; isSuccess: boolean };
export type PatientReflectionHydrationState = 'pending' | 'error' | 'ready';
type PatientReflectionHydrationResult = {
  scope: string;
  state: Exclude<PatientReflectionHydrationState, 'pending'>;
};

export function usePatientReflectionRecovery({
  scheduleId,
  orgId,
  pending,
  setPending,
  alertRef,
  refetchSchedule,
  refetchHeader,
  onResolved,
}: {
  scheduleId: string;
  orgId: string;
  pending: PendingPatientReflectionSubmission | null;
  setPending: Dispatch<SetStateAction<PendingPatientReflectionSubmission | null>>;
  alertRef: RefObject<HTMLDivElement | null>;
  refetchSchedule: () => Promise<RefetchResult<ScheduleDetail>>;
  refetchHeader: () => Promise<RefetchResult<HeaderAuthority>>;
  onResolved: (pending: PendingPatientReflectionSubmission) => Promise<void>;
}) {
  const hydrationRequestGenerationRef = useRef(0);
  const unavailableRecordRef = useRef<string | null>(null);
  const persistenceFailureNotifiedRef = useRef(false);
  const persistenceChainRef = useRef<Promise<void>>(Promise.resolve());
  const actionInFlightRef = useRef(false);
  const [actionInFlight, setActionInFlight] = useState(false);
  const [hydrationResult, setHydrationResult] = useState<PatientReflectionHydrationResult | null>(
    null,
  );
  const [hydrationAttempt, setHydrationAttempt] = useState(0);
  const hydrationScope = `${orgId}\u0000${scheduleId}\u0000${hydrationAttempt}`;
  const hydrationState: PatientReflectionHydrationState =
    hydrationResult?.scope === hydrationScope ? hydrationResult.state : 'pending';

  function beginAction() {
    if (actionInFlightRef.current) return false;
    actionInFlightRef.current = true;
    setActionInFlight(true);
    return true;
  }

  function endAction() {
    actionInFlightRef.current = false;
    setActionInFlight(false);
  }

  useEffect(() => {
    if (!orgId) return;
    const requestGeneration = ++hydrationRequestGenerationRef.current;
    const isCurrentRequest = () => hydrationRequestGenerationRef.current === requestGeneration;
    void loadPatientReflectionContinuation(orgId, scheduleId)
      .then((result) => {
        if (!isCurrentRequest()) return;
        if (!result) {
          setHydrationResult({ scope: hydrationScope, state: 'ready' });
          return;
        }
        if (result.kind === 'loaded') {
          setPending((current) =>
            current
              ? current
              : {
                  ...result.continuation,
                  attachmentWarning: null,
                  reconfirmed: false,
                },
          );
          setHydrationResult({ scope: hydrationScope, state: 'ready' });
          return;
        }
        unavailableRecordRef.current = result.recordId;
        setPending((current) =>
          current
            ? current
            : {
                reflection: {
                  patientId: '',
                  sourceVisitRecordId: result.recordId,
                  intake: {},
                  expectedUpdatedAt: '',
                  careCaseId: null,
                  expectedCareCaseVersion: null,
                },
                record: { id: result.recordId, version: 1, patient_id: '' },
                attachmentWarning: null,
                status: 'failed',
                reconfirmed: false,
              },
        );
        toast.error(
          '保存済みの患者反映情報を復号できません。再試行せず、今回の反映をスキップしてください',
        );
        setHydrationResult({ scope: hydrationScope, state: 'ready' });
      })
      .catch(() => {
        if (isCurrentRequest()) setHydrationResult({ scope: hydrationScope, state: 'error' });
      });
    return () => {
      if (isCurrentRequest()) hydrationRequestGenerationRef.current += 1;
    };
  }, [hydrationScope, orgId, scheduleId, setPending]);

  useEffect(() => {
    if (!pending) return;
    if (actionInFlightRef.current) return;
    if (unavailableRecordRef.current !== pending.record.id) {
      const persist = () =>
        persistPatientReflectionContinuation(orgId, {
          scheduleId,
          reflection: pending.reflection,
          record: pending.record,
          status: pending.status === 'stale' ? 'stale' : 'failed',
        });
      const task = persistenceChainRef.current.catch(() => undefined).then(persist);
      persistenceChainRef.current = task;
      void task
        .then(() => {
          persistenceFailureNotifiedRef.current = false;
        })
        .catch(() => {
          if (persistenceFailureNotifiedRef.current) return;
          persistenceFailureNotifiedRef.current = true;
          toast.error('患者詳細への未完了反映を安全に保存できません。この画面で解決してください');
        });
    }
    alertRef.current?.focus();
  }, [alertRef, orgId, pending, scheduleId]);

  async function refreshAuthority() {
    if (!pending || !beginAction()) return;
    try {
      const [scheduleResult, headerResult] = await Promise.all([
        refetchSchedule(),
        refetchHeader(),
      ]);
      const nextSchedule = scheduleResult.data;
      const nextHeader = headerResult.data;
      const requiresTarget = requiresPatientReflectionCareCaseTarget(pending.reflection.intake);
      const target = nextHeader?.intakeEditTarget ?? null;
      if (
        !scheduleResult.isSuccess ||
        !headerResult.isSuccess ||
        !nextSchedule ||
        !nextHeader?.patientUpdatedAt ||
        nextSchedule.id !== scheduleId ||
        nextSchedule.patient_id !== pending.reflection.patientId ||
        nextHeader.patientId !== pending.reflection.patientId ||
        (requiresTarget && !target)
      ) {
        setPending((current) => (current ? { ...current, status: 'failed' } : current));
        return;
      }
      setPending((current) =>
        current
          ? {
              ...current,
              status: 'ready',
              reconfirmed: false,
              reflection: {
                ...current.reflection,
                expectedUpdatedAt: nextHeader.patientUpdatedAt,
                careCaseId: target?.careCaseId ?? null,
                expectedCareCaseVersion: target?.expectedCareCaseVersion ?? null,
              },
            }
          : current,
      );
    } finally {
      endAction();
    }
  }

  async function retryOnly() {
    if (!pending || pending.status !== 'ready' || !pending.reconfirmed || !beginAction()) return;
    try {
      const result = await patchPatientReflection(pending.reflection, orgId);
      if (!result.ok) {
        setPending((current) => (current ? { ...current, status: result.reason } : current));
        return;
      }
      await persistenceChainRef.current.catch(() => undefined);
      await clearPatientReflectionContinuation(orgId, scheduleId, pending.record.id);
      setPending(null);
      toast.success('患者詳細への反映が完了しました');
      await onResolved(pending);
    } catch {
      toast.error('患者詳細への反映結果または未完了情報を確定できませんでした');
    } finally {
      endAction();
    }
  }

  async function skip() {
    if (!pending || !beginAction()) return;
    try {
      await persistenceChainRef.current.catch(() => undefined);
      await clearPatientReflectionContinuation(orgId, scheduleId, pending.record.id);
      setPending(null);
      await onResolved(pending);
    } catch {
      toast.error('未完了の患者反映情報を消去できませんでした');
    } finally {
      endAction();
    }
  }

  return {
    refreshAuthority,
    retryOnly,
    skip,
    actionInFlight,
    hydrationState,
    retryHydration: () => setHydrationAttempt((current) => current + 1),
  };
}
