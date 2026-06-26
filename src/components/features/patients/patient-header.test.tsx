// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PatientHeader } from '@/components/features/patients/patient-header';

setupDomTestEnv();

const NOW = new Date(2026, 5, 26); // ローカル暦日（TZ非依存にするため UTC 文字列は使わない）

describe('PatientHeader', () => {
  it('renders the identity tier with TZ-safe age, gender and care level', () => {
    render(
      <PatientHeader
        name="山田 太郎"
        kana="ヤマダ タロウ"
        birthDate="1950-06-26"
        genderLabel="男性"
        careLevelLabel="要介護3"
        homeStatusLabel="在宅"
        now={NOW}
      />,
    );
    expect(screen.getByText('山田 太郎 様')).toBeTruthy();
    expect(screen.getByText('ヤマダ タロウ')).toBeTruthy();
    expect(screen.getByText('76歳・男性')).toBeTruthy();
    expect(screen.getByText('要介護3')).toBeTruthy();
    expect(screen.getByText('在宅')).toBeTruthy();
  });

  it('renders the 4-person care team (主/副 薬剤師・スタッフ), omitting unset roles', () => {
    const { rerender } = render(
      <PatientHeader
        name="A"
        careTeam={{
          primaryPharmacist: '佐藤 花子',
          backupPharmacist: '鈴木 一郎',
          primaryStaff: '田中 美咲',
          backupStaff: '高橋 健',
        }}
        now={NOW}
      />,
    );
    expect(screen.getByText('主 佐藤 花子 / 副 鈴木 一郎')).toBeTruthy();
    expect(screen.getByText('主 田中 美咲 / 副 高橋 健')).toBeTruthy();
    // 副が未設定なら主だけを出す（false-empty 回避）
    rerender(<PatientHeader name="A" careTeam={{ primaryPharmacist: '佐藤 花子' }} now={NOW} />);
    expect(screen.getByText('主 佐藤 花子')).toBeTruthy();
  });

  it('keeps age stable across timezones for date-only birth strings', () => {
    // YYYY-MM-DD はローカル暦日として扱うので負オフセット TZ でも前日にずれない
    render(<PatientHeader name="A" birthDate="2000-01-01" now={new Date(2026, 0, 1)} />);
    expect(screen.getByText('26歳')).toBeTruthy();
  });

  it('renders the clinical tier: diagnosis, residence, intervention day count, prescription/visit cadence', () => {
    render(
      <PatientHeader
        name="A"
        primaryDiagnosis="2型糖尿病"
        residenceLabel="施設 / 201号室"
        interventionStartDate="2026-06-20"
        lastPrescriptionLabel="6/1"
        nextPrescriptionLabel="6/29"
        lastVisitLabel="6/12"
        nextVisitLabel="6/26 14:00"
        firstVisitLabel="4/3"
        now={NOW}
      />,
    );
    expect(screen.getByText('2型糖尿病')).toBeTruthy();
    expect(screen.getByText('施設 / 201号室')).toBeTruthy();
    // 6/20 開始, 基準 6/26 → 7日目
    expect(screen.getByText('7日目（2026/6/20〜）')).toBeTruthy();
    expect(screen.getByText('6/1 → 6/29')).toBeTruthy();
    expect(screen.getByText('6/12 → 6/26 14:00')).toBeTruthy();
    expect(screen.getByText('4/3')).toBeTruthy();
  });

  it('renders the safety tier: allergy emphasised, handling tags via shared helper, renal/swallowing/cautions', () => {
    render(
      <PatientHeader
        name="A"
        safety={{
          allergy: 'セフェム系(2019)',
          renal: 'eGFR 38(6/1)',
          handlingTags: ['narcotic', 'cold_storage'],
          swallowing: '錠剤OK・大きい錠は半割',
          cautions: ['ふらつき(6/5〜経過観察)'],
        }}
        safetyCheckHref="/patients/p1/safety-check"
        now={NOW}
      />,
    );
    const safety = screen.getByTestId('patient-header-safety');
    const allergy = within(safety).getByText('セフェム系(2019)');
    expect(allergy.className).toContain('text-state-blocked');
    expect(within(safety).getByText('麻薬')).toBeTruthy();
    expect(within(safety).getByText('冷所')).toBeTruthy();
    expect(within(safety).getByText('eGFR 38(6/1)')).toBeTruthy();
    expect(within(safety).getByText('錠剤OK・大きい錠は半割')).toBeTruthy();
    expect(within(safety).getByText('ふらつき(6/5〜経過観察)')).toBeTruthy();
    expect(
      within(safety).getByTestId('patient-header-safety-check-link').getAttribute('href'),
    ).toBe('/patients/p1/safety-check');
  });

  it('omits empty tiers instead of showing false-empty bands', () => {
    render(<PatientHeader name="A" now={NOW} />);
    // no safety data -> no safety tier
    expect(screen.queryByTestId('patient-header-safety')).toBeNull();
    // no clinical data -> the clinical dl is not rendered at all (no empty bordered band)
    expect(screen.getByTestId('patient-header').querySelector('dl')).toBeNull();
  });

  it('renders the clinical tier as soon as any single clinical field is present', () => {
    render(<PatientHeader name="A" primaryDiagnosis="2型糖尿病" now={NOW} />);
    const dl = screen.getByTestId('patient-header').querySelector('dl');
    expect(dl).toBeTruthy();
    expect(dl?.querySelectorAll('dt').length).toBe(1);
  });

  it('is sticky by default and can opt out', () => {
    const { rerender } = render(<PatientHeader name="A" now={NOW} />);
    expect(screen.getByTestId('patient-header').className).toContain('sticky');
    rerender(<PatientHeader name="A" sticky={false} now={NOW} />);
    expect(screen.getByTestId('patient-header').className).not.toContain('sticky');
  });
});
