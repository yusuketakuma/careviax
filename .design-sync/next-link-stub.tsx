// design-sync stub for `next/link`. The real next/link drags Next's compiled
// internals (gzip-size → fs/stream/zlib) into the browser bundle. In a Claude
// Design preview there is no Next router, so a plain anchor is the faithful
// render of a navigational Link.
import * as React from 'react';

type LinkProps = {
  href?: string | { pathname?: string };
  children?: React.ReactNode;
} & React.AnchorHTMLAttributes<HTMLAnchorElement>;

const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { href, children, ...rest },
  ref,
) {
  const resolved = typeof href === 'string' ? href : (href?.pathname ?? '#');
  return React.createElement('a', { ref, href: resolved, ...rest }, children);
});

export default Link;
