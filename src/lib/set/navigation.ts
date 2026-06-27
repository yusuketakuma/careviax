export function buildSetPlanHref(planId: string) {
  return `/set?planId=${encodeURIComponent(planId)}`;
}
