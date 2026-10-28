---
name: live-qa
description: QA a live web platform end to end from a URL and login details, find bugs and UI/UX problems (including mobile responsiveness), then fix them in the codebase and verify the fixes. Use whenever the user gives an app URL plus credentials and asks to test, QA, check, audit or "make sure everything works" on the live/production site, or asks to find bugs or UX issues on a deployed app, even if they don't say "QA" — e.g. "here's the login, go through the platform and fix what's broken", "check classroom.tms.webcam works on phones".
---

# Live QA: find, fix and verify

The goal is a platform where every feature works and is **easy to use on a phone as well as a desktop**. You are acting as a careful tester who is also the developer: you find problems on the live site, trace each one to the code, fix it, prove the fix, and report back plainly.

The people using these apps are usually not technical (for the BLS platform: sign-language teachers and students). Judge the UX through their eyes: can someone do the job without thinking, on a 390px-wide phone, with a finger?

## 0. Inputs and ground rules

You need the app URL and at least one login. Ask for anything missing in one short message, and ask which roles the accounts are (e.g. student, tutor, admin). One account per role gives the best coverage.

**Credentials**: keep them out of every file you write, every commit, report and screenshot name. Pass them to scripts as environment variables (`QA_EMAIL`, `QA_PASSWORD`). The script saves nothing with the session cookie except in memory.

**Live site = real users' data.** Breaking production or messaging real people is far worse than missing a bug, so on the live site:

- Browse, open, filter, search, and fill in forms *without submitting* freely.
- Don't submit anything that changes real data or reaches other people: deleting, editing real courses/students, sending messages, invites, emails, approving sign-ups, starting live classes or recordings, payments.
- If a flow can only be tested by writing data, prefer reproducing it locally against a test database (see the project notes). If it must be done live, create clearly named data (`QA test – delete me`) under the QA account only, and remove it afterwards. Ask the user first if you're unsure.
- Never change production settings, schema or env vars as part of QA.

If the project has notes in `references/` for this app (e.g. `references/bls-system.md` for classroom.tms.webcam), read them before starting — they hold the routes, roles, local test setup and deploy rules.

## 1. Automated sweep (every role, desktop + phone)

Run the bundled read-only sweep once per account. It logs in, crawls every same-origin link it finds (plus any routes you give it), and checks each page at 1366×768 and 390×844:

```bash
QA_EMAIL='…' QA_PASSWORD='…' node <skill>/scripts/sweep.mjs \
  --url https://app.example.com --out <scratchpad>/qa/<role> \
  [--routes <file-of-paths>] [--max-pages 80]
```

Run it once with no credentials too, for the public pages (login, register, forgot password).

It only navigates, never clicks, and skips logout, token links and live-room URLs by default (`--skip` to change). Give it a `--routes` file built from the codebase's route list (e.g. every `app/**/page.tsx` for Next.js, with one real id filled in for dynamic segments, taken from links you saw while crawling) so pages that aren't linked from the nav still get visited.

Output: `summary.md` (findings per page and viewport), `report.json`, and `screens/*.jpg` full-page screenshots. It flags:
JS exceptions, console errors, failed or 4xx/5xx requests, horizontal scrolling on phones (and which element causes it), tap targets under 24px, unnamed buttons, unlabelled inputs, tiny text, broken images, slow pages, and error-looking text (`undefined`, `NaN`, `Invalid Date`, "Something went wrong").

Treat these as leads, not verdicts. A 404 on a prefetched link is a real broken link; a 16px checkbox inside a big clickable label is fine.

## 2. Look at it like a user

Automated checks miss most UX problems. **Open the screenshots** (the Read tool shows images) for every distinct page, at both widths, and judge them against `references/ux-checklist.md`. Then drive the important flows by hand with a Playwright script (write small throwaway scripts in the scratchpad, reusing the login approach in `sweep.mjs`):

- The main job of each role, start to finish (for a student: find a course → open a lesson → take a test; for a tutor: open a course → edit a lesson → view a student's results). Stop before the final submit when that would write real data.
- Every form: empty submit, wrong input, very long input. Is the error clear, next to the field, and in plain words?
- Every dialog, menu, dropdown and tab on the phone viewport: does it fit, scroll, and close?
- Empty states (a list with nothing in it), loading states, and what happens after an action (feedback? where does it go?).
- Navigation on the phone: can you reach every section from the menu, and get back?

Write down each issue as you go: where (URL + role + viewport), steps, what happened, what should happen, screenshot path.

## 3. Triage

Group duplicates (one broken component often shows up on 20 pages) and rank:

1. **Broken**: crashes, errors, data not loading, actions that fail, dead links, a page unusable on a phone.
2. **Hard to use**: confusing flows, unclear labels/errors, hidden actions, too many options, cramped or overflowing layouts on mobile, tiny tap targets.
3. **Polish**: alignment, spacing, inconsistent wording.

Fix group 1 first. Fixing is the point, but some issues are product decisions (removing a feature, changing what a role can do, writing legal text for a missing Terms page). For those, don't guess: list them for the user with a recommendation.

## 4. Fix

For each issue, find the cause in the code before changing anything (grep the visible text or the route to find the component). Then:

- Make the smallest change that fixes the cause, in the style of the surrounding code. If the bug is in a shared component, fix it there once and every page benefits.
- For mobile layout, use the project's existing responsive approach (e.g. Tailwind `sm:`/`md:` breakpoints, mobile-first) rather than one-off CSS; stack rows on phones, let tables scroll inside their own container or turn into cards, make tap targets ≥ 40px.
- Keep UX fixes simple: fewer steps, clearer words, sensible defaults. Don't add settings or modes to solve a usability problem.
- Don't touch database schema or production data to make a symptom go away. Schema changes need the user's go-ahead.

## 5. Verify

A fix isn't done until you've seen it work:

1. Typecheck and lint the changed files (`npx tsc --noEmit`, `npx eslint <files>`).
2. Run the app locally (see the project notes for the setup) and repeat the exact repro steps at the viewport where it failed, plus the other viewport to make sure you didn't break it. Re-run `sweep.mjs` against the local URL for the affected routes.
3. Take an after screenshot and look at it.

If something can't be reproduced locally (e.g. depends on production data), say so in the report rather than claiming it's fixed.

## 6. Ship and re-check

Commit fixes in small, clearly described commits (one per issue or per shared component). **Pushing usually deploys to production**, so ask the user before the first push in a session unless they've already told you to deploy. After the deploy finishes, re-run the sweep on the live site for the affected pages and confirm the issues are gone.

## 7. Report

Finish with a short report the user can read in a minute. Use this shape:

```
## Live QA – <app> – <date>
Covered: <roles>, <N> pages, desktop + phone. Flows tested: <list>.

### Fixed (<n>)
| Issue | Where | Fix | Verified |
|---|---|---|---|
| Privacy/Terms links 404 | footer, every page | … | local + live |

### Needs your decision (<n>)
- <issue> – <why it's a decision> – I'd suggest <x>.

### Not fixed / couldn't test (<n>)
- <issue or flow> – <reason, e.g. would send real invites>.
```

Lead with what changed for users, not with implementation detail. Mention anything you skipped and why, so the user never assumes something was tested when it wasn't.
