'use client';

import { useRef, useState, type KeyboardEvent } from 'react';

export type RovingFocusOrientation = 'horizontal' | 'vertical' | 'both';

export type RovingFocusOptions = {
  itemCount: number;
  orientation?: RovingFocusOrientation;
  loop?: boolean;
  initialIndex?: number;
};

export type RovingFocusItemProps<T extends HTMLElement = HTMLElement> = {
  ref: (node: T | null) => void;
  tabIndex: number;
  onFocus: () => void;
  onKeyDown: (event: KeyboardEvent<T>) => void;
};

function clampIndex(index: number, itemCount: number) {
  if (itemCount <= 0) return 0;
  return Math.min(Math.max(index, 0), itemCount - 1);
}

export function getRovingFocusTargetIndex(args: {
  currentIndex: number;
  itemCount: number;
  key: string;
  orientation?: RovingFocusOrientation;
  loop?: boolean;
}) {
  const { currentIndex, itemCount, key, orientation = 'both', loop = true } = args;
  if (itemCount <= 0) return currentIndex;

  const allowHorizontal = orientation === 'horizontal' || orientation === 'both';
  const allowVertical = orientation === 'vertical' || orientation === 'both';
  let delta = 0;

  if (allowHorizontal && key === 'ArrowRight') delta = 1;
  if (allowHorizontal && key === 'ArrowLeft') delta = -1;
  if (allowVertical && key === 'ArrowDown') delta = 1;
  if (allowVertical && key === 'ArrowUp') delta = -1;
  if (key === 'Home') return 0;
  if (key === 'End') return itemCount - 1;
  if (delta === 0) return currentIndex;

  const nextIndex = currentIndex + delta;
  if (loop) return (nextIndex + itemCount) % itemCount;
  return clampIndex(nextIndex, itemCount);
}

export function useRovingFocus<T extends HTMLElement = HTMLElement>({
  itemCount,
  orientation = 'both',
  loop = true,
  initialIndex = 0,
}: RovingFocusOptions) {
  const [activeIndex, setActiveIndex] = useState(() => clampIndex(initialIndex, itemCount));
  const safeActiveIndex = clampIndex(activeIndex, itemCount);
  const itemRefs = useRef<Array<T | null>>([]);

  function focusItem(index: number) {
    const safeIndex = clampIndex(index, itemCount);
    setActiveIndex(safeIndex);
    window.requestAnimationFrame(() => {
      itemRefs.current[safeIndex]?.focus();
    });
  }

  function getItemProps(index: number): RovingFocusItemProps<T> {
    return {
      ref: (node) => {
        itemRefs.current[index] = node;
      },
      tabIndex: index === safeActiveIndex ? 0 : -1,
      onFocus: () => {
        setActiveIndex(index);
      },
      onKeyDown: (event) => {
        const nextIndex = getRovingFocusTargetIndex({
          currentIndex: index,
          itemCount,
          key: event.key,
          orientation,
          loop,
        });

        if (nextIndex === index) return;

        event.preventDefault();
        event.stopPropagation();
        focusItem(nextIndex);
      },
    };
  }

  return { activeIndex: safeActiveIndex, getItemProps };
}
