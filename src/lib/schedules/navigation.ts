type BuildProposalHrefArgs = {
  date?: string | null;
  status?: string | null;
  focus?: string | null;
  action?: string | null;
};

export function buildProposalHref(args: BuildProposalHrefArgs = {}) {
  const params = new URLSearchParams();

  if (args.date) params.set('date', args.date);
  if (args.status) params.set('status', args.status);
  if (args.focus) params.set('focus', args.focus);
  if (args.action) params.set('action', args.action);

  const query = params.toString();
  return query.length > 0 ? `/schedules/proposals?${query}` : '/schedules/proposals';
}
