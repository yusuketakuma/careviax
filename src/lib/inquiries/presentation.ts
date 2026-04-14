export type InquiryPresentationInput = {
  inquiryContent?: string | null;
  changeDetail?: string | null;
  proposalOrigin?: 'post_inquiry' | 'pre_issuance' | null;
  residualAdjustment?: boolean | null;
};

export function getInquiryProposalOriginLabel(
  proposalOrigin?: 'post_inquiry' | 'pre_issuance' | null,
) {
  return proposalOrigin === 'pre_issuance' ? '事前提案反映' : '照会後変更';
}

export function getInquiryPresentationBadges(
  input: Pick<InquiryPresentationInput, 'proposalOrigin' | 'residualAdjustment'>,
) {
  const badges = [getInquiryProposalOriginLabel(input.proposalOrigin)];
  if (input.residualAdjustment) badges.push('残薬調整');
  return badges;
}

export function getInquiryPrimaryDetail(input: InquiryPresentationInput) {
  return input.changeDetail?.trim() || input.inquiryContent?.trim() || null;
}

export function getInquiryStructuredMetaFromLegacy(args: {
  proposalOrigin?: 'post_inquiry' | 'pre_issuance' | null;
  residualAdjustment?: boolean | null;
  reason?: string | null;
  changeDetail?: string | null;
}) {
  const detail = args.changeDetail ?? '';
  return {
    proposalOrigin:
      args.proposalOrigin ??
      (detail.includes('proposal_origin:pre_issuance') ? 'pre_issuance' : 'post_inquiry'),
    residualAdjustment:
      args.residualAdjustment ??
      ((args.reason ?? '').includes('残薬') ||
        detail.toLowerCase().includes('residual_adjustment:true')),
  } as const;
}
