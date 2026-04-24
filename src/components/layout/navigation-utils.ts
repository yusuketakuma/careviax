import type { LayoutNavItem, TopWorkflowLink } from './navigation-config';

export function matchesPathPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isLayoutNavItemActive(pathname: string, item: LayoutNavItem) {
  const activePrefixes = item.activePrefixes ?? [item.href];
  const isExcluded =
    item.excludePrefixes?.some((prefix) => matchesPathPrefix(pathname, prefix)) ?? false;

  if (isExcluded) return false;

  return item.href === '/dashboard'
    ? pathname === '/dashboard'
    : activePrefixes.some((prefix) => matchesPathPrefix(pathname, prefix));
}

export function isTopWorkflowLinkActive(pathname: string, item: TopWorkflowLink) {
  const isExcluded =
    item.excludePrefixes?.some((prefix) => matchesPathPrefix(pathname, prefix)) ?? false;
  if (isExcluded) return false;

  return item.activePrefixes.some((prefix) => matchesPathPrefix(pathname, prefix));
}
