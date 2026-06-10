export function omitProposalRejectReason<T extends object>(proposal: T): Omit<T, 'reject_reason'> {
  const safeProposal = { ...proposal } as Record<string, unknown>;
  delete safeProposal.reject_reason;
  return safeProposal as Omit<T, 'reject_reason'>;
}

export function omitProposalRejectReasons<T extends object>(
  proposals: T[],
): Array<Omit<T, 'reject_reason'>> {
  return proposals.map(omitProposalRejectReason);
}
