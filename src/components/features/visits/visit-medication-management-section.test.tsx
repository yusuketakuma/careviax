// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import type { StructuredSoap } from '@/types/structured-soap';
import { VisitMedicationManagementSection } from './visit-medication-management-section';

setupDomTestEnv();

function buildSoap(): StructuredSoap {
  return {
    subjective: { symptom_checks: [], free_text: '眠気あり' },
    objective: {
      medication_status: 'free_text_only',
      adherence_score: 3,
      side_effect_checks: [],
    },
    assessment: { problem_checks: [] },
    plan: { intervention_checks: [] },
  };
}

describe('VisitMedicationManagementSection', () => {
  it('surfaces previous visit and cross-professional context as an onsite listening brief', () => {
    const onChange = vi.fn();

    render(
      <VisitMedicationManagementSection
        structuredSoap={buildSoap()}
        medicationPeriod={{
          schedule_start_date: '2026-06-15',
          schedule_end_date: '2026-06-28',
          prescription_start_date: null,
          prescription_end_date: null,
        }}
        prescriptionChanges={{
          current_prescribed_date: '2026-06-15',
          previous_prescribed_date: '2026-06-01',
          source_type: 'fax',
          added: ['酸化マグネシウム錠'],
          changed: [{ drug_name: 'アムロジピン錠', reasons: ['夕食後へ変更'] }],
          removed: [],
        }}
        previousVisitSummary="前回はふらつきと昼分の飲み忘れを確認。"
        conferenceContext={[
          {
            id: 'conf_1',
            note_type: 'service_manager',
            title: '担当者会議',
            conference_date: '2026-06-14T09:00:00.000Z',
            participants: [{ name: '田中ケアマネ', role: 'care_manager' }],
            highlights: ['夜間の転倒リスクを家族が心配'],
            action_items: ['眠気と便秘を本人に確認'],
          },
        ]}
        onChange={onChange}
      />,
    );

    expect(screen.getByText('今日の聞き取りブリーフ')).toBeTruthy();
    expect(screen.getByText('情報ソース別')).toBeTruthy();
    expect(screen.getByRole('tab', { name: /処方内容/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /前回記録/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /他職種/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /申し送り/ })).toBeTruthy();
    expect(screen.getAllByText('次に聞く').length).toBeGreaterThan(0);
    expect(screen.getAllByText('追加 1 / 変更 1').length).toBeGreaterThan(0);
    expect(screen.getByText(/アムロジピン錠: 夕食後へ変更/)).toBeTruthy();
    expect(screen.getByText('変更理解をSへ')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /変更理解をSへ/ }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        subjective: expect.objectContaining({
          free_text: expect.stringContaining('処方変更の理解'),
        }),
      }),
    );

    fireEvent.click(screen.getByRole('tab', { name: /前回記録/ }));
    expect(screen.getByText('前回はふらつきと昼分の飲み忘れを確認。')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /他職種/ }));
    expect(screen.getAllByText('担当者会議').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/夜間の転倒リスクを家族が心配/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('tab', { name: /申し送り/ }));
    expect(screen.getByText(/眠気と便秘を本人に確認/)).toBeTruthy();
  });
});
