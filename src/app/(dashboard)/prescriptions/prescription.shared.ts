import { CYCLE_STATUS_LABELS } from '@/lib/prescription/cycle-workspace';
import { MEDICATION_CYCLE_STATUS_ROLE } from '@/lib/constants/status-labels';
import { STATUS_TOKENS } from '@/lib/constants/status-tokens';

// ---------------------------------------------------------------------------
// Cycle status config — 6 軸セマンティック（MEDICATION_CYCLE_STATUS_ROLE）が正本。
// 線形工程=info(青) / 完了=done(緑) / 保留・疑義=confirm(橙) / 取消=blocked(赤)。
// 旧 CLAUDE.md「待ち=青/進行中=緑/差戻し=赤/完了=灰」は不採用（docs/state-color-migration-map.md）。
// ---------------------------------------------------------------------------

type CycleStatusConfig = {
  label: string;
  variant: 'default' | 'secondary' | 'outline' | 'destructive';
  className?: string;
};

export type PrescriptionLine = {
  id: string;
  line_number: number;
  drug_name: string;
  drug_code: string | null;
  dosage_form: string | null;
  dose: string;
  frequency: string;
  days: number;
  route: string | null;
  dispensing_method: string | null;
  is_generic: boolean;
  is_generic_name_prescription: boolean | null;
  packaging_instructions: string | null;
  notes: string | null;
};

export type InquiryRecord = {
  id: string;
  reason: string;
  inquiry_to_physician: string;
  inquiry_content: string;
  result: string | null;
  proposal_origin: 'post_inquiry' | 'pre_issuance' | null;
  residual_adjustment: boolean | null;
  change_detail: string | null;
  inquired_at: string;
  resolved_at: string | null;
};

export const CYCLE_STATUS_CONFIG: Record<string, CycleStatusConfig> = Object.fromEntries(
  Object.entries(MEDICATION_CYCLE_STATUS_ROLE).map(([status, role]) => {
    const label = CYCLE_STATUS_LABELS[status] ?? status;
    if (role === 'neutral') {
      return [status, { label, variant: 'secondary' as const }];
    }
    return [
      status,
      { label, variant: 'outline' as const, className: STATUS_TOKENS[role].badgeClassName },
    ];
  }),
);
