'use client';

import * as React from 'react';
import { Button as ButtonPrimitive } from '@base-ui/react/button';

import { cn } from '@/lib/utils';
import { buttonVariants, type ButtonVariantsProps } from '@/components/ui/button-variants';

type ButtonProps = ButtonPrimitive.Props &
  ButtonVariantsProps & {
    asChild?: boolean;
  };

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  children,
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size, className }));

  if (asChild) {
    const child = React.Children.only(children);
    if (!React.isValidElement<{ className?: string }>(child)) {
      return null;
    }

    return React.cloneElement(child, {
      ...props,
      'data-slot': 'button',
      className: cn(classes, child.props.className),
    } as Record<string, unknown>);
  }

  return (
    <ButtonPrimitive data-slot="button" className={classes} {...props}>
      {children}
    </ButtonPrimitive>
  );
}

export { Button, buttonVariants };
