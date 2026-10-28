# UX checklist

Use this when looking at screenshots and driving flows. The bar: **a non-technical person can do the job on a phone without help.**

## Simplicity
- One obvious main action per screen; secondary actions look secondary.
- The control lives where the thing is (an edit/lock/delete button on the item, not in a distant settings page).
- Sensible defaults instead of required choices. Any dialog with more than ~3 inputs, or options most people never change, is a candidate to simplify.
- Plain words, no internal jargon or IDs. Buttons say what happens ("Save lesson", not "Submit").
- After every action there's visible feedback (toast, updated list, navigation), and it's clear what to do next.

## Mobile (390px wide)
- No horizontal page scroll. Wide tables scroll inside their own box or become stacked cards.
- Tap targets ≥ 40px tall and not crammed together; icon-only buttons have a padded hit area.
- Text ≥ 14px for body, ≥ 16px in inputs (smaller makes iOS zoom in on focus).
- Dialogs and sheets fit the screen, scroll internally, and have a visible close; the main button isn't hidden under the keyboard or off-screen.
- Nav menu reaches every section and closes after choosing.
- Row layouts (label + value + buttons) stack sensibly; nothing is cut off or overlapping. Long names/emails wrap or truncate with an ellipsis.
- Videos and images scale to the width; sticky headers/footers don't cover content.

## Forms
- Every input has a visible label (placeholder alone isn't enough).
- Errors appear next to the field, in plain language, and say how to fix it.
- Submit buttons show a loading state and can't be double-submitted.
- Right keyboard on phones (`type="email"`, `inputMode="numeric"`).
- Entered data survives a validation error.

## States
- Loading: skeleton or spinner, not a blank screen or layout jump.
- Empty: explains what will appear here and how to add the first item.
- Error: a human message and a way forward (retry, go back), never a raw stack trace, `undefined`, `NaN`, `Invalid Date` or `[object Object]`.
- Permissions: a role that can't do something doesn't see a button that fails.

## Consistency and accessibility
- Same thing, same name and same look everywhere (buttons, badges, dates).
- Dates and times in a friendly local format.
- Enough contrast; focus is visible when tabbing; icon buttons have `aria-label`.
- Dark mode (if supported) has no invisible text or white boxes.
