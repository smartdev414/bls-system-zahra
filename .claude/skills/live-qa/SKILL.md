---
name: live-qa
description: QA a live web platform in a real browser, either one feature at a time or the whole site. Walk each flow as every role on desktop and phone, find bugs and anything hard to use or hard to understand, fix it in the codebase on your own judgment, and verify the fix. Use this whenever the user asks to test, QA, check, audit, review or "make sure X works" on the live/production site or on a feature; when they ask to improve the UI/UX or make a feature easier or clearer; when they give an app URL plus logins; or right after building a BLS feature, to check it as a teacher and as a student. Use it even if they don't say "QA", e.g. "go through the new handouts feature and make it easier", "check classroom.tms.webcam works on phones", "is the test bank clear for teachers?".
---

# Live QA: find, improve, verify

The goal is that every feature **works, is easy to use, and is easy to understand**, for a non-technical person, on a phone as well as a desktop. You are both the tester and the developer. Find problems in the live browser, trace each one to the code, fix it, prove the fix, and report back plainly.

For the BLS platform, the users are sign-language teachers and students. Judge every screen through their eyes. Could someone do the job without thinking, without help, on a 390px-wide phone, with a finger? Would they understand what each word means?

If there are notes for this app in `references/` (`references/bls-system.md` for classroom.tms.webcam), read them first. They hold the accounts, routes, feature map, local test setup and deploy rules.

## 0. Inputs and ground rules

**Logins.** For BLS, the QA accounts are already saved in `~/.config/bls-qa/accounts.env` (see the notes for which role each one has), so don't ask for them. For any other app, ask once for the URL, the logins and each account's role, in one short message. Keep passwords out of every file you write, and out of commits, reports, screenshot names and chat. `scripts/qa-lib.mjs` reads the accounts file itself. `sweep.mjs` takes `QA_EMAIL`/`QA_PASSWORD` from the environment: `set -a; . ~/.config/bls-qa/accounts.env; set +a; QA_EMAIL=$QA_A_EMAIL QA_PASSWORD=$QA_A_PASSWORD node …`.

**The live site holds real users' data.** Breaking production or messaging real people is far worse than missing a bug. On the live site:

- Freely browse, open, filter and search, and fill in forms *without submitting*.
- Don't submit anything that changes real data or reaches other people: deleting, editing real courses or students, sending messages, invites or emails, approving sign-ups, starting live classes or recordings, payments.
- Test write paths locally against the test database (see the notes). If a write path can only be tested live, create clearly named data (`QA test – delete me`) under the QA account only, and remove it afterwards. Ask first if you're unsure.
- Be gentle with the server. Log in once per account (`qa-lib.mjs` caches the session) and load pages one at a time. Never poll the site in a loop.
- Never change production settings, schema or env vars as part of QA.

## 1. Pick the scope

- **One feature** (the usual case: the user names one, or you just built one) → section 2.
- **Whole platform** ("full QA", "check everything", "mobile pass") → run the sweep in section 3 first, then walk the main features one by one with section 2. Start with the ones real users touch most.

## 2. Feature walk-through

### a. Understand the feature before judging it
Find the code: grep the feature's visible words and routes, read its pages and components, and check `git log` and the notes' feature map. Then write down, in a few lines:
- **Who uses it** (each role) and **what each of them is trying to get done**, in their words. For example: "a teacher wants to give the class a handout that appears after Tuesday's lesson".
- **Every way in**: nav items, dashboard cards, buttons on other pages, emails and notifications that link here.
- **The states**: empty (nothing yet), normal, lots of items, done/expired, no permission.

### b. Walk it like a first-time user
For each role and each job, do the job in the live browser at **phone (390×844) and desktop (1366×768)** with a small Playwright script built on `scripts/qa-lib.mjs`:

```js
import { openAs, shot, done } from "<skill>/scripts/qa-lib.mjs"
const { page } = await openAs("B", { phone: true, out: "<scratchpad>/qa/<feature>" })
await page.goto("/student/dictionary")
await shot(page, "1-list")                 // Read the printed path to look at it
await page.getByRole("button", { name: /next/i }).click()
await shot(page, "2-after-next")
await done()                               // prints console errors, failed requests
```

Start where a real user would start (the dashboard or nav, not a deep URL), and click your way through, taking a screenshot at each step. **Look at every screenshot** (the Read tool shows images). That look is the real test. Stop before any final submit that would write real data (see section 0), and do that step locally instead.

At each screen, ask the **clarity questions**:
1. Within five seconds, would a first-time user know what this screen is for?
2. Is the next step obvious? Is there one main button, and does it say what will happen?
3. Is every word one the user would use? Look for jargon, internal names, codes or IDs.
4. Does anything contradict anything else? Watch for empty-state text next to real data, counts that don't match, and a status that disagrees with the page.
5. After acting, can they tell it worked, and what happens next?
6. If they make a mistake, is the error next to the field, in plain words, and can they get back or undo?
7. On the phone: does everything fit, and is it big enough to tap and readable without zooming?

Also try the edges: an empty submit, wrong input, a very long name, the empty state, and every dialog, menu, tab and dropdown on the phone (does it fit, scroll and close?). Then check `references/ux-checklist.md` for anything you didn't cover.

Note each issue as you go: where (URL, role, viewport), the steps, what happened, what a user would expect, and the screenshot path.

## 3. Whole-site sweep (automated, read-only)

```bash
QA_EMAIL=… QA_PASSWORD=… node <skill>/scripts/sweep.mjs \
  --url <base> --out <scratchpad>/qa/<role> [--routes <file>] [--max-pages 80]
```

Run it once per account, plus once with no credentials for the public pages. It only navigates and never clicks. It skips logout links, token links and live-room URLs. Build a `--routes` file from the codebase's route list (the notes show how) so pages missing from the nav get visited too.

It writes `summary.md`, `report.json` and `screens/*.jpg`. It flags JS exceptions, console errors, 4xx/5xx and failed requests, horizontal scrolling on phones (and the element causing it), small tap targets, unnamed buttons, unlabelled inputs, tiny text, broken images, slow pages and error-looking text (`undefined`, `NaN`, `Invalid Date`). Treat these as leads, not verdicts, and look at the screenshots yourself.

## 4. Triage

Group duplicates (one broken component can show up on 20 pages) and rank them:

1. **Broken**: crashes, errors, data not loading, failing actions, dead links, a page you can't use on a phone.
2. **Confusing or hard to use**: unclear words, contradictions, a hidden or unobvious next step, too many options or steps, missing feedback, cramped or overflowing mobile layouts, tiny tap targets.
3. **Polish**: alignment, spacing, inconsistent wording.

Fix group 1 first, then group 2. Group 2 is where most of the value is, so don't stop at "no errors".

## 5. Improve: what you decide, and what you ask about

Make UX improvements **on your own judgment**. The user asked for this, so don't stop to ask about each one. You may, without asking:
- Rewrite labels, headings, help text, empty states and error messages in plain words.
- Fix contradictions and wrong or stale text.
- Make the main action obvious, demote or tidy secondary ones, and put a control where the thing it acts on is.
- Remove needless steps, clicks or fields, and replace required choices with sensible defaults.
- Add missing feedback (a toast, loading state, success message or "what's next" hint).
- Fix mobile layout, tap targets, overflow and dialogs that don't fit.

Ask first (list these in the report with your recommendation) when a change would:
- Remove a feature or change what a role is allowed to do or see.
- Change the database schema or production data.
- Need content only the user has (legal text, prices, policy).
- Redesign a whole flow in a way that changes how teachers work.

How to fix:
- Find the cause in the code before changing anything.
- Make the smallest change that fixes the cause, in the style of the surrounding code. If the problem is in a shared component, fix it there once.
- Mobile-first, using the project's existing responsive approach (Tailwind `sm:`/`md:`). Stack rows on phones, let tables scroll in their own box or turn into cards, and make tap targets ≥ 40px.
- Make things simpler, not more configurable. Never add a setting, mode or extra dialog to solve a usability problem.

## 6. Verify

A fix isn't done until you've seen it work:
1. Run `npx tsc --noEmit` and `npx eslint <changed files>`.
2. Run the app locally (see the notes), repeat the exact walk-through steps at both viewports, and **look at the after screenshots** next to the before ones. Write paths you skipped on live get tested here, end to end.
3. If it can't be reproduced locally (it depends on production data), say so rather than claiming it's fixed.

## 7. Ship and re-check

Commit in small, clearly described commits (one per issue or shared component). Pushing or releasing deploys to production, so ask before the first push or release in a session unless the user has already said to deploy. After it's live, walk the affected screens once more on the live site (one pass, no polling) and confirm.

## 8. Report

Keep it short, so the user can read it in a minute:

```
## QA – <feature or "whole platform"> – <date>
Checked as: <roles>, desktop + phone. Jobs walked: <list>.

### Improved (<n>)
| What was wrong (as a user saw it) | Where | What I changed | Verified |
|---|---|---|---|
| Dashboard said "not on a course yet" next to the next class | student dashboard | … | local, phone+desktop |

### Needs your decision (<n>)
- <issue> – <why it's a decision> – I'd suggest <x>.

### Not tested (<n>)
- <flow> – <why, e.g. it would send real emails; tested locally instead / not at all>.
```

Lead with what changed for users, not implementation detail. Name anything you skipped, so the user never assumes something was tested when it wasn't.
