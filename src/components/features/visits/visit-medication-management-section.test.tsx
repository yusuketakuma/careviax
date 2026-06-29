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
        previousVisitStructuredReuse={{
          source_visit_record_id: 'record_prev',
          source_visit_record_version: 3,
          source_visit_record_updated_at: '2026-06-01T03:00:00.000Z',
          subjective: ['昼分の飲み忘れあり'],
          objective: ['残薬: アムロジピン錠 6錠 / 3日分過多', '副作用確認: 眠気'],
          assessment: ['残薬と眠気を次回も確認'],
          plan: ['医師へ: 眠気とふらつきを共有'],
          handoff: {
            next_check_items: ['眠気とふらつきの継続確認'],
            ongoing_monitoring: ['昼分の飲み忘れ'],
            decision_rationale: '前回残薬と副作用訴えあり',
          },
          carry_forward_items: [
            '眠気とふらつきの継続確認',
            '前回残薬: アムロジピン錠 6錠 / 3日分過多',
          ],
        }}
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
    expect(screen.getByText('前回から引き継ぐ確認')).toBeTruthy();
    expect(screen.getAllByText(/眠気とふらつきの継続確認/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/アムロジピン錠 6錠/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /前回確認をSへ/ }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        subjective: expect.objectContaining({
          free_text: expect.stringContaining('前回からの引き継ぎ確認'),
        }),
      }),
    );

    fireEvent.click(screen.getByRole('tab', { name: /他職種/ }));
    expect(screen.getAllByText('担当者会議').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/夜間の転倒リスクを家族が心配/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('tab', { name: /申し送り/ }));
    expect(screen.getByText(/眠気と便秘を本人に確認/)).toBeTruthy();
  });

  it('lists outside-med classification labels with drug names (§11-7)', () => {
    render(
      <VisitMedicationManagementSection
        structuredSoap={buildSoap()}
        outsideMeds={[
          {
            line_id: 'line_topical',
            drug_name: 'モーラステープ',
            outside_med_kind: 'topical',
            outside_med_label: '外用',
          },
          {
            line_id: 'line_prn',
            drug_name: 'ロキソプロフェン錠60mg',
            outside_med_kind: 'prn',
            outside_med_label: '頓服',
          },
        ]}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText('その他薬（セット外で持参）')).toBeTruthy();
    expect(screen.getByText('外用')).toBeTruthy();
    expect(screen.getByText('モーラステープ')).toBeTruthy();
    expect(screen.getByText('頓服')).toBeTruthy();
    expect(screen.getByText('ロキソプロフェン錠60mg')).toBeTruthy();
  });

  it('omits the outside-med block when there are no outside meds', () => {
    render(
      <VisitMedicationManagementSection
        structuredSoap={buildSoap()}
        outsideMeds={[]}
        onChange={vi.fn()}
      />,
    );

    expect(screen.queryByText('その他薬（セット外で持参）')).toBeNull();
  });
});
