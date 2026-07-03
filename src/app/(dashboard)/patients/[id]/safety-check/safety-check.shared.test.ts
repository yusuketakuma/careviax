import { describe, expect, it } from 'vitest';
import {
  buildSafetyConcerns,
  deriveSafetySteps,
  isClosedIssue,
  isUnresolvedIssue,
  mapAlertToConcernCategory,
  mapIssueToConcernCategory,
  type SafetyCdsAlert,
  type SafetyIssueRecord,
} from './safety-check.shared';

function buildIssue(overrides: Partial<SafetyIssueRecord> = {}): SafetyIssueRecord {
  return {
    id: 'issue_1',
    title: 'NSAIDsと腎機能低下',
    description: 'ロキソプロフェン服用中で eGFR 38。継続可否を確認する。',
    status: 'open',
    priority: 'critical',
    category: 'interaction',
    identified_at: '2026-06-11T09:00:00.000Z',
    ...overrides,
  };
}

function buildAlert(overrides: Partial<SafetyCdsAlert> = {}): SafetyCdsAlert {
  return {
    type: 'interaction',
    severity: 'warning',
    message: '相互作用注意: ロキソプロフェン × エナラプリル',
    ...overrides,
  };
}

describe('isUnresolvedIssue / isClosedIssue', () => {
  it('open と in_progress を未解決として扱う', () => {
    expect(isUnresolvedIssue({ status: 'open' })).toBe(true);
    expect(isUnresolvedIssue({ status: 'in_progress' })).toBe(true);
    expect(isUnresolvedIssue({ status: 'resolved' })).toBe(false);
    expect(isUnresolvedIssue({ status: 'dismissed' })).toBe(false);
  });

  it('resolved と dismissed を完了として扱う', () => {
    expect(isClosedIssue({ status: 'resolved' })).toBe(true);
    expect(isClosedIssue({ status: 'dismissed' })).toBe(true);
    expect(isClosedIssue({ status: 'open' })).toBe(false);
    expect(isClosedIssue({ status: 'in_progress' })).toBe(false);
  });
});

describe('mapIssueToConcernCategory', () => {
  it('interaction / side_effect / duplicate をそれぞれの表示カテゴリへ写す', () => {
    expect(mapIssueToConcernCategory(buildIssue({ category: 'interaction' }))).toBe('interaction');
    expect(mapIssueToConcernCategory(buildIssue({ category: 'side_effect' }))).toBe('adverse');
    expect(mapIssueToConcernCategory(buildIssue({ category: 'duplicate' }))).toBe('duplicate');
  });

  it('other は用量系キーワードがあるときだけ dose になる', () => {
    expect(
      mapIssueToConcernCategory(
        buildIssue({ category: 'other', title: '高齢・eGFR 38', description: '用量確認が必要' }),
      ),
    ).toBe('dose');
    expect(
      mapIssueToConcernCategory(
        buildIssue({
          category: 'other',
          title: 'お薬カレンダー設置',
          description: '次回訪問で設置',
        }),
      ),
    ).toBeNull();
  });

  it('category 未設定でも説明文の腎機能キーワードで dose を拾う', () => {
    expect(
      mapIssueToConcernCategory(
        buildIssue({
          category: null,
          title: '確認事項',
          description: '腎機能低下のため減量を検討',
        }),
      ),
    ).toBe('dose');
  });

  it('adherence は 4 分類対象外として null を返す', () => {
    expect(mapIssueToConcernCategory(buildIssue({ category: 'adherence' }))).toBeNull();
  });
});

describe('mapAlertToConcernCategory', () => {
  it('CDS アラート種別を 4 分類へ写す', () => {
    expect(mapAlertToConcernCategory('interaction')).toBe('interaction');
    expect(mapAlertToConcernCategory('package_insert_contraindication')).toBe('interaction');
    expect(mapAlertToConcernCategory('renal_dose')).toBe('dose');
    expect(mapAlertToConcernCategory('pim_elderly')).toBe('dose');
    expect(mapAlertToConcernCategory('max_days')).toBe('dose');
    expect(mapAlertToConcernCategory('package_insert_adverse_effect')).toBe('adverse');
    expect(mapAlertToConcernCategory('allergy_cross')).toBe('adverse');
    expect(mapAlertToConcernCategory('monitoring')).toBe('adverse');
    expect(mapAlertToConcernCategory('duplicate')).toBe('duplicate');
  });

  it('X05: 添付文書 alert の切り捨て marker を対応する分類へ写す', () => {
    expect(mapAlertToConcernCategory('package_insert_contraindication_truncated')).toBe(
      'interaction',
    );
    expect(mapAlertToConcernCategory('package_insert_elderly_truncated')).toBe('dose');
    expect(mapAlertToConcernCategory('package_insert_adverse_effect_truncated')).toBe('adverse');
  });

  it('調剤運用系の種別は対象外として null を返す', () => {
    expect(mapAlertToConcernCategory('narcotic')).toBeNull();
    expect(mapAlertToConcernCategory('high_risk')).toBeNull();
    expect(mapAlertToConcernCategory('cds_data_quality')).toBeNull();
    expect(mapAlertToConcernCategory('transitional_expiry')).toBeNull();
  });
});

describe('buildSafetyConcerns', () => {
  const fourCategoryIssues: SafetyIssueRecord[] = [
    buildIssue({
      id: 'issue_interaction',
      category: 'interaction',
      priority: 'critical',
      title: 'NSAIDsと腎機能低下',
    }),
    buildIssue({
      id: 'issue_dose',
      category: 'other',
      priority: 'high',
      status: 'in_progress',
      title: '高齢・eGFR 38',
      description: '腎排泄型薬剤の用量確認が必要。',
    }),
    buildIssue({
      id: 'issue_adverse',
      category: 'side_effect',
      priority: 'medium',
      title: 'ふらつきあり',
    }),
    buildIssue({
      id: 'issue_duplicate',
      category: 'duplicate',
      priority: 'medium',
      title: '睡眠薬の重なり',
    }),
  ];

  it('カテゴリ固定順(飲み合わせ→用量確認→副作用疑い→重複)で 4 枚を組み立てる', () => {
    const concerns = buildSafetyConcerns(fourCategoryIssues, []);

    expect(concerns.map((concern) => concern.category)).toEqual([
      'interaction',
      'dose',
      'adverse',
      'duplicate',
    ]);
    expect(concerns.map((concern) => concern.label)).toEqual([
      '飲み合わせ',
      '用量確認',
      '副作用疑い',
      '重複',
    ]);
    expect(concerns.map((concern) => concern.subLabel)).toEqual([
      'NSAIDsと腎機能低下',
      '高齢・eGFR 38',
      'ふらつきあり',
      '睡眠薬の重なり',
    ]);
  });

  it('critical 課題を含むカテゴリだけ赤見出しになる', () => {
    const concerns = buildSafetyConcerns(fourCategoryIssues, []);

    expect(concerns.find((c) => c.category === 'interaction')?.critical).toBe(true);
    expect(concerns.find((c) => c.category === 'dose')?.critical).toBe(false);
    expect(concerns.find((c) => c.category === 'adverse')?.critical).toBe(false);
    expect(concerns.find((c) => c.category === 'duplicate')?.critical).toBe(false);
  });

  it('解決済み課題はカードに出さない', () => {
    const concerns = buildSafetyConcerns(
      [
        buildIssue({ id: 'resolved_issue', status: 'resolved' }),
        buildIssue({ id: 'dismissed_issue', status: 'dismissed', category: 'duplicate' }),
      ],
      [],
    );

    expect(concerns).toEqual([]);
  });

  it('同一カテゴリ内は priority 順 → identified_at 順で代表課題を選ぶ', () => {
    const concerns = buildSafetyConcerns(
      [
        buildIssue({
          id: 'later_medium',
          priority: 'medium',
          title: '軽微な相互作用',
          identified_at: '2026-06-10T09:00:00.000Z',
        }),
        buildIssue({
          id: 'earlier_critical',
          priority: 'critical',
          title: 'NSAIDsと腎機能低下',
          identified_at: '2026-06-11T09:00:00.000Z',
        }),
      ],
      [],
    );

    expect(concerns).toHaveLength(1);
    expect(concerns[0]?.issueId).toBe('earlier_critical');
    expect(concerns[0]?.subLabel).toBe('NSAIDsと腎機能低下');
    expect(concerns[0]?.itemCount).toBe(2);
  });

  it('課題が無いカテゴリは CDS アラートからカードを作る(issueId は null)', () => {
    const concerns = buildSafetyConcerns(
      [],
      [buildAlert({ type: 'renal_dose', severity: 'critical', message: 'eGFR 38: 減量を検討' })],
    );

    expect(concerns).toHaveLength(1);
    expect(concerns[0]).toMatchObject({
      category: 'dose',
      subLabel: 'eGFR 38: 減量を検討',
      critical: true,
      issueId: null,
      itemCount: 1,
    });
  });

  it('critical な CDS アラートを含むカテゴリは課題が warning でも赤見出しになる', () => {
    const concerns = buildSafetyConcerns(
      [buildIssue({ priority: 'medium' })],
      [buildAlert({ severity: 'critical' })],
    );

    expect(concerns[0]?.critical).toBe(true);
    expect(concerns[0]?.subLabel).toBe('NSAIDsと腎機能低下');
  });

  it('対象カテゴリの無い課題・アラートだけなら空配列を返す', () => {
    const concerns = buildSafetyConcerns(
      [buildIssue({ category: 'adherence' })],
      [buildAlert({ type: 'narcotic' })],
    );

    expect(concerns).toEqual([]);
  });
});

describe('deriveSafetySteps', () => {
  it('課題ゼロ件では全ステップ未実施', () => {
    const steps = deriveSafetySteps([]);

    expect(steps).toHaveLength(4);
    expect(steps.map((step) => step.stepNumber)).toEqual([1, 2, 3, 4]);
    expect(steps.map((step) => step.label)).toEqual([
      '薬歴・検査値を確認',
      '処方医へ相談',
      '処方変更の結果を記録',
      '報告書へ反映',
    ]);
    expect(steps.every((step) => !step.done)).toBe(true);
  });

  it('open のみ: ステップ 1 だけ済', () => {
    const steps = deriveSafetySteps([{ status: 'open' }]);

    expect(steps.map((step) => step.done)).toEqual([true, false, false, false]);
  });

  it('in_progress を含む: ステップ 1・2 が済(撮影シナリオ)', () => {
    const steps = deriveSafetySteps([
      { status: 'open' },
      { status: 'in_progress' },
      { status: 'open' },
      { status: 'open' },
    ]);

    expect(steps.map((step) => step.done)).toEqual([true, true, false, false]);
  });

  it('resolved を含む: ステップ 3 まで済', () => {
    const steps = deriveSafetySteps([{ status: 'open' }, { status: 'resolved' }]);

    expect(steps.map((step) => step.done)).toEqual([true, true, true, false]);
  });

  it('全件 resolved/dismissed: 4 ステップすべて済', () => {
    const steps = deriveSafetySteps([{ status: 'resolved' }, { status: 'dismissed' }]);

    expect(steps.map((step) => step.done)).toEqual([true, true, true, true]);
  });
});
