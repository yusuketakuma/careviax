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
});
