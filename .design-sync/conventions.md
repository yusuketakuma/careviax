# PH-OS Design System — build conventions

A medical/pharmacy (在宅訪問薬局) component set. Deep-navy primary, white surfaces,
high-contrast, Japanese UI. Components are React, styled with Tailwind 4 utilities
backed by CSS-variable design tokens. Build with the real components below.

## Setup / wrapping

No global provider or ThemeProvider is required — components are self-contained and
read their look from CSS-variable tokens shipped in `styles.css`. Just import a
component and render it. (Tokens resolve from `:root`; dark mode via a `.dark` ancestor.)

## Styling idiom

Tailwind 4 utility classes whose colors come from the DS tokens. Every component
accepts `className` (merged). Use these token utilities for your own layout/glue —
do NOT invent raw hex colors:

- Surfaces & text: `bg-background` / `text-foreground`, `bg-card` / `text-card-foreground`,
  `text-muted-foreground`, `bg-muted`, `border-border`.
- Brand & accents: `bg-primary` / `text-primary-foreground` (deep navy), `bg-secondary`,
  `bg-accent`.
- Destructive: `bg-destructive`, `text-destructive`.
- Workflow state colors (status semantics): `bg-state-done` / `bg-state-confirm` /
  `bg-state-waiting` / `bg-state-blocked` / `bg-state-readonly` (and `text-state-*`,
  often as `/10` tints), plus tag colors `text-tag-hazard` / `text-tag-info`.
- Radius: `rounded-lg` (DS radius ≈ 0.375rem).

## Component API (use these props — don't invent variant names)

- `Button` — `variant`: `default | secondary | outline | ghost | destructive | link`;
  `size`: `default | xs | sm | lg | icon | icon-xs | icon-sm | icon-lg`.
- `Badge` — `variant` (6, incl. `outline`, `ghost`, `link`).
- `Alert` — `variant`: `default | destructive`; compose `AlertTitle` + `AlertDescription`.
- `StateBadge` / `StatusDot` — `role`: `blocked | done | confirm | waiting | readonly`
  (StatusDot also `hazard | info`); the role supplies the Japanese label automatically.
- `LoadingButton` — pass `loading` for a spinner + `loadingLabel`.
- `Card` — compose `CardHeader` / `CardTitle` / `CardContent` / `CardFooter` / `CardAction`.
  Note: `CardDescription` (and `DialogDescription`, `SheetDescription`) render a help
  "?" popover, NOT an inline subtitle — put visible subtitles in `CardContent`.
- Overlays (`Dialog`, `AlertDialog`, `Sheet`, `DropdownMenu`, `Select`) are base-ui
  primitives: control with `open` / `defaultOpen` and compose their `*Trigger` / `*Content`
  sub-parts.

## Where the truth lives

Read `styles.css` (and its `@import "./_ds_bundle.css"`) for the full token set, and
each component's `<Name>.d.ts` (`<Name>Props` contract) + `<Name>.prompt.md` (usage)
before composing.

## Idiomatic snippet

```tsx
import { Card, CardHeader, CardTitle, CardContent, Button, StateBadge } from '<pkg>';

export function PatientRow() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>田中 一郎</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-2">
        <StateBadge role="done" />
        <Button size="sm">訪問記録を開く</Button>
      </CardContent>
    </Card>
  );
}
```
