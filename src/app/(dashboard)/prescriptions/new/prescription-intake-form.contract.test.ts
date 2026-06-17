import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(new URL('./prescription-intake-form.tsx', import.meta.url), 'utf8');

describe('PrescriptionIntakeForm previous prescription safety contract', () => {
  it('does not auto-apply the latest previous prescription after it loads', () => {
    expect(SOURCE).not.toMatch(
      /useEffect\(\(\) => \{[\s\S]*if \(!latestPreviousIntake\) return;[\s\S]*setLines\(\(prev\) => hydrateLinesWithPrevious\(prev, latestPreviousIntake\)\);/,
    );
  });

  it('routes previous prescription replacement through an explicit confirmation dialog', () => {
    expect(SOURCE).toContain('previousPrescriptionConfirmOpen');
    expect(SOURCE).toContain('requestLatestPreviousPrescription');
    expect(SOURCE).toContain('前回処方で現在の明細を置き換えますか？');
    expect(SOURCE).toContain('前回処方で置き換える');
    expect(SOURCE).toContain('onConfirm={applyLatestPreviousPrescription}');
  });

  it('does not carry stale previous prescription date windows into the next prescription', () => {
    expect(SOURCE).toContain('服用開始日と終了日は今回処方で確認します。');
    expect(SOURCE).not.toContain('start_date: line.start_date || previous.start_date || undefined');
    expect(SOURCE).not.toContain('end_date: line.end_date || previous.end_date || undefined');
  });

  it('warns when previous prescription replacement may overwrite QR-derived data', () => {
    expect(SOURCE).toContain('QR下書きから取り込んだ明細を前回処方の内容で置き換えます。');
    expect(SOURCE).toContain('QR由来の用量、日数、包装指示、注射剤判定に関わる情報');
    expect(SOURCE).toContain("variant={initialQrDraftId ? 'destructive' : 'default'}");
  });

  it('detaches the QR draft submission when previous prescription replacement is confirmed', () => {
    expect(SOURCE).toContain('qrDraftSubmissionId');
    expect(SOURCE).toContain('setQrDraftSubmissionId(qrDraftData.id)');
    expect(SOURCE).toContain('qr_draft_id: qrDraftSubmissionId || undefined');
    expect(SOURCE).toContain("latestPreviousIntake.source_type === 'qr_scan'");
    expect(SOURCE).toContain("? 'paper'");
    expect(SOURCE).toMatch(
      /if \(qrDraftSubmissionId\) \{[\s\S]*setQrDraftSubmissionId\(''\);[\s\S]*setAppliedQrDraftId\(''\);/,
    );
  });

  it('carries previous prescription source revision metadata into replacement lines', () => {
    expect(SOURCE).toContain('source_intake_id?: string');
    expect(SOURCE).toContain('source_line_id?: string');
    expect(SOURCE).toContain('source_intake_updated_at_snapshot?: string');
    expect(SOURCE).toContain('source_line_updated_at_snapshot?: string');
    expect(SOURCE).toContain('function previousSourceFields');
    expect(SOURCE).toContain('source_intake_id: intake.id');
    expect(SOURCE).toContain('source_line_id: line.id');
    expect(SOURCE).toContain('source_intake_updated_at_snapshot: intake.updated_at');
    expect(SOURCE).toContain('source_line_updated_at_snapshot: line.updated_at');
    expect(SOURCE).toContain('source_intake_id: latestPreviousIntake.id');
    expect(SOURCE).toContain('source_intake_updated_at_snapshot: latestPreviousIntake.updated_at');
  });

  it('replaces QR-derived lines with previous prescription provenance when confirmed', () => {
    expect(SOURCE).toContain('qr_draft_id: qrDraftSubmissionId || undefined');
    expect(SOURCE).toContain("setQrDraftSubmissionId('')");
    expect(SOURCE).toContain('source_line_id: line.id');
    expect(SOURCE).toContain('...previousSourceFields(previous, previousIntake)');
  });

  it('scopes previous prescription reuse to the selected case', () => {
    expect(SOURCE).toContain(
      "queryKey: ['patient-prescriptions', orgId, selectedPatientId, selectedCaseId]",
    );
    expect(SOURCE).toContain("new URLSearchParams({ limit: '5', case_id: selectedCaseId })");
    expect(SOURCE).toContain('enabled: !!orgId && !!selectedPatientId && !!selectedCaseId');
  });

  it('submits facility batch patient identity snapshots without exposing residence addresses', () => {
    expect(SOURCE).toContain('type PatientIdentitySnapshot');
    expect(SOURCE).toContain('patient_identity_snapshot: PatientIdentitySnapshot');
    expect(SOURCE).toContain('patient_identity_snapshot: entry.patient_identity_snapshot');
    expect(SOURCE).toContain('selectedPatientNameKana');
    expect(SOURCE).toContain('selectedPatientBirthDate');
    expect(SOURCE).toContain('患者情報を読み込み直してから施設まとめ処方に追加してください');
    expect(SOURCE).toContain('facility_label: selectedCase?.patient?.residences?.[0]?.address');
    expect(SOURCE).toContain("? '施設確認済み'");
    expect(SOURCE).not.toContain('residence_label');
    expect(SOURCE).not.toContain(
      'facility_label: selectedCase?.patient?.residences?.[0]?.address ?? null',
    );
  });
});
