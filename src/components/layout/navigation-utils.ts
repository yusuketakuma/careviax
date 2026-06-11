import type { LayoutNavItem } from './navigation-config';

export function matchesPathPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isLayoutNavItemActive(pathname: string, item: LayoutNavItem) {
  const activePrefixes = item.activePrefixes ?? [item.href];
  const isExcluded =
    (item.excludePrefixes?.some((prefix) => matchesPathPrefix(pathname, prefix)) ?? false) ||
    (item.excludeExact?.some((path) => pathname === path) ?? false);

  if (isExcluded) return false;

  if (item.exact) {
    return activePrefixes.some((path) => pathname === path);
  }

  return activePrefixes.some((prefix) => matchesPathPrefix(pathname, prefix));
}
