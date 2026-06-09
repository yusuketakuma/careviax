import { describe, expect, it } from 'vitest';
import {
  ActionPhase,
  BoardDensity,
  ButtonState,
  SAFETY_CRITICAL_TAGS,
  Tag,
  ViewPhase,
  VisitStep,
  type ClinicalSignal,
  type PharmacistBrief,
  type SupportBrief,
} from './phos_uiux_contracts';
import { PhosEmptyState, PhosToast } from './phos_uiux_copy_ja';
import { Radius, SeverityToken, Space, TypeScale } from './phos_uiux_design_tokens';

describe('PH-OS UIUX v1.1 entrypoints', () => {
  it('exposes the UI phase, button state, tag, and VisitMode contracts required by UI-PR0', () => {
    expect(ButtonState).toMatchObject({
      ACTIONABLE: 'ACTIONABLE',
      RESOLVABLE_BLOCK: 'RESOLVABLE_BLOCK',
      FOREIGN_BLOCK: 'FOREIGN_BLOCK',
      NO_PERMISSION: 'NO_PERMISSION',
      READONLY_CLOSED: 'READONLY_CLOSED',
      OFFLINE_BLOCKED: 'OFFLINE_BLOCKED',
    });
    expect(ViewPhase).toMatchObject({
      LOADING: 'LOADING',
      READY: 'READY',
      EMPTY: 'EMPTY',
      ERROR: 'ERROR',
      STALE: 'STALE',
    });
    expect(ActionPhase).toMatchObject({
      IDLE: 'IDLE',
      SUBMITTING: 'SUBMITTING',
      SUCCEEDED: 'SUCCEEDED',
      GUARD_FAILED: 'GUARD_FAILED',
      CONFLICT: 'CONFLICT',
      NET_ERROR: 'NET_ERROR',
    });
    expect(VisitStep.COMPLETE_CHECK).toBe('COMPLETE_CHECK');
    expect(BoardDensity).toMatchObject({
      COMFORTABLE: 'COMFORTABLE',
      COMPACT: 'COMPACT',
    });
    expect(SAFETY_CRITICAL_TAGS).toEqual([
      Tag.NARCOTIC,
      Tag.OPIOID,
      Tag.HIGH_RISK,
      Tag.COLD_CHAIN,
      Tag.INSULIN,
      Tag.ANTICOAGULANT,
      Tag.MULTI_PERSON_VISIT,
      Tag.DOCTOR_SIMULTANEOUS,
    ]);
  });

  it('exposes brief item types through the UIUX contract entrypoint', () => {
    const signal = {
      code: 'DOSE_INCREASE',
      severity: 'WARNING',
      title: 'A錠 5mg -> 10mg 増量',
      detail: '前回ふらつきあり。今回訪問で眠気・転倒を確認します。',
      source_refs: [{ kind: 'PRESCRIPTION', ref_id: 'src_1', label: '今回処方' }],
      recommended_action_code: 'CREATE_REPORT_DRAFT',
    } satisfies ClinicalSignal;
    const pharmacistBrief = {
      clinical_signals: [signal],
      decisions_required: [],
      communication_recommendations: [],
      claim_warnings: [],
      source_refs: signal.source_refs,
    } satisfies PharmacistBrief;
    const supportBrief = {
      support_tasks: [],
      missing_contacts: [],
      delivery_targets: [],
      schedule_candidates: [],
      missing_evidences: [],
      waiting_replies: [],
      pharmacist_review_reasons: [],
    } satisfies SupportBrief;

    expect(pharmacistBrief.clinical_signals[0]).toBe(signal);
    expect(supportBrief.support_tasks).toEqual([]);
  });

  it('exposes the UI copy and design token entrypoints required by UI-PR0', () => {
    expect(PhosEmptyState.EMPTY_TODAY_NONE).toBe('本日対応予定のカードはありません。');
    expect(PhosToast.PHOTO_QUEUED).toBeTruthy();
    expect(SeverityToken.WARNING.label).toBe('注意');
    expect(TypeScale).toEqual({ xs: 12, sm: 14, base: 16, lg: 18, xl: 20, h2: 24, h1: 30 });
    expect(Space).toEqual({ x1: 4, x2: 8, x3: 12, x4: 16, x5: 24, x6: 32 });
    expect(Radius).toEqual({ sm: 6, md: 10, lg: 14 });
  });
});
