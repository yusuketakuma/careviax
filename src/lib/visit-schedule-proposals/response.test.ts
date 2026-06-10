import { describe, expect, it } from 'vitest';
import { omitProposalRejectReason } from './response';

describe('omitProposalRejectReason', () => {
  it('removes the stored rejection free text from API response payloads', () => {
    const proposal = {
      id: 'proposal_1',
      proposal_status: 'rejected',
      reject_reason: '東京都港区2-2-2 090-1234-5678 アムロジピン 処方詳細',
      proposal_reason: '訪問周期に基づく候補',
    };

    const result = omitProposalRejectReason(proposal);
    const resultText = JSON.stringify(result);

    expect(result).toEqual({
      id: 'proposal_1',
      proposal_status: 'rejected',
      proposal_reason: '訪問周期に基づく候補',
    });
    expect(resultText).not.toContain('東京都港区2-2-2');
    expect(resultText).not.toContain('090-1234-5678');
    expect(resultText).not.toContain('アムロジピン');
    expect(resultText).not.toContain('処方詳細');
    expect(proposal.reject_reason).toBe('東京都港区2-2-2 090-1234-5678 アムロジピン 処方詳細');
  });
});
