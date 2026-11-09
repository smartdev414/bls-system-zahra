# BLS platform (classroom.tms.webcam)

A Next.js app in `/opt/tae/bls-system`, live at https://classroom.tms.webcam ("Teach Me Sign"). It's a British Sign Language school: tutors teach live classes and build courses, and students take lessons, tests and leagues. The users are teachers and students, not engineers. The owner's standing rule is **easy to use and easy to understand, UX before clever workflow**: one obvious action, sensible defaults, the control on the thing itself, and no option-heavy dialogs.

## QA accounts
They're stored in `~/.config/bls-qa/accounts.env` (mode 600, outside git). `qa-lib.mjs` loads it automatically.

| Key | Role | Lands on |
|---|---|---|
| `A` | admin | `/admin` |
| `B` | student (Billy Johnson, booked into BSL Level 4 Mon evening classes) | `/student` |

There's no tutor account on live. Check tutor screens locally (`*@t.test` users), and through the admin views that show the same data. If a login fails, tell the user. Don't guess other passwords.

## Roles and routes
- **admin** → `/admin/*` (users, students, courses, tests, signs, leagues, sessions, settings, tickets, audit logs)
- **tutor** → `/tutor/*` (courses + lessons, sessions, tests, students, messages, reviews, leagues, handouts)
- **student** → `/student/*` (dashboard, courses, lessons, tests, dictionary + flashcards, leagues, messages, tickets, certifications, sign requests)
- **support** → `/support/*`
- Public: `/login`, `/register`, `/forgot-password`, `/it-requirements`

Route list for the sweep's `--routes`: `find app -name page.tsx | sed -E 's#^app##; s#/page.tsx$##; s#/\([^)]+\)##g'`. Keep the paths for the role being swept, and replace `[id]` segments with real ids seen while crawling.

## Feature map (where to start a walk-through)
Each line gives the feature, who uses it, and its main entry points. The user's memory notes have each feature's history.
- **Courses & lessons**: online vs face-to-face, private/public, student approval. Tutor builds them, student follows them. Student: Learning menu → My Courses.
- **Live classes**: sessions calendar, classroom (LiveKit), recordings with opt-out. Dashboard "Your next class", Classroom nav. *Never open the classroom room on live.*
- **Tests menu (test bank)**: vocab (both ways), written marks, self-marked, assessment (filmed answers), presentation, self-reflection. Student does them from homework / course; teacher marks.
- **Test reminders + student progress**: Students page shows last seen and per-test status.
- **Dictionary + flashcards**, **sign requests** (student asks, admin films and adds).
- **Fingerspelling leagues**, **trophies + class ranking**.
- **Class handouts**: tutor uploads per class with a release time.
- **Teacher access switches** (admin sets per-teacher view-only / no downloads).
- **Users page** (staff edit names, ⋯ row menu), **remembered list search** (lists keep filters when you go back).
- **Feedback button** (bottom right, every page) and **tickets**.

## Don't touch on live
- `/tutor/classroom/[id]` and `/student/classroom/[id]` join real LiveKit rooms, and recordings start from there.
- Messages, tickets, sign-request replies, invites, student approval, enrolments and test submissions all notify real people or change their records.
- Production runs on an OVH server (198.244.201.81, Docker + Postgres on the box). Its database isn't reachable from here, so there's nothing to touch. The local `.env` `DATABASE_URL` still points at the **old Neon database**: it's stale but holds real personal data, so never write to it or test against it.
- Schema changes go through `prisma/migrations` and are applied on release. Don't add one without the user's go-ahead.

## Local verification
- DB: the docker container `bls-test-db` on 127.0.0.1:55432 (user `postgres`, password `test`; `docker start bls-test-db`). Make a fresh copy for each run: `docker exec bls-test-db createdb -U postgres -T trophy_test qa_<date>`. `trophy_test` has the current schema plus seeded data: `admin@t.test`, `tutor@t.test`, `s1@rem.test`…, all `Passw0rd!`, open sign requests, reflection tests and trophies. Its quiz attempts were seeded without LessonProgress, so "0 of N lessons" next to passed tests is a data artifact there. Add any missing case with plain SQL into the copy, never into a shared one.
- A stale `next dev` from an old session holds the repo's dev lock. Run from a copy: `rsync -a --exclude node_modules --exclude .next --exclude .git --exclude '.env*' /opt/tae/bls-system/ <scratch>/app/`, symlink `node_modules`, then `DATABASE_URL=postgresql://postgres:test@127.0.0.1:55432/<db> NEXT_PUBLIC_PUSHER_KEY=dummy NEXT_PUBLIC_PUSHER_CLUSTER=eu npx next dev --webpack -p 4100` (Turbopack rejects the symlink). Re-run the rsync after each edit. Stop it with `pkill -f "next dev --webpack -p 4100"` in a command of its own, because pkill also kills the shell that runs it.
- Point `qa-lib.mjs` at it with `QA_URL=http://localhost:4100` and local keys, e.g. `QA_L_EMAIL=admin@t.test QA_L_PASSWORD='Passw0rd!'` → `openAs("L")`. Use keys other than A/B so the cached live sessions aren't mixed up.
- Checks: `npx tsc --noEmit`, `npx eslint <changed files>`. `app/(dashboard)/student/courses/page.tsx` already had one set-state-in-effect lint error before 2026-11-09.

## Deploy
Pushing to `main` on GitHub (`origin`) runs the "Deploy to OVH" GitHub Actions workflow (`.github/workflows/deploy-ovh.yml`), which builds the image and releases it on the server. It only runs while the repo variable `OVH_DEPLOY=on` is set. Ask before the first push in a session. After pushing, wait a few minutes, then check the live site once (don't poll). The mobile app (`/opt/tae/bls-system-mobile`) is separate and doesn't get these fixes.

## Known issues (to check they're still there before reporting)
- The footer links `/privacy` and `/terms` (`components/layout/footer.tsx`) return 404. Writing those pages needs real policy text from the user. Seen 2026-10-28 and still there 2026-11-09.
- 2026-11-09 QA of the previous week's features (commits 6f914e0..ace050d): fixed the student dashboard's "not on a course" contradiction, Users "Edit"→"Edit name", the Students list's phone layout, the sign request "Close without a message" wording, and the self-reflection test cards. Billy (B) is invited to classes but on no course, so student course features (trophies, homework, lesson icons, reflection) can only be seen locally.
- Open decision: a test that was sat but failed counts as "finished" for homework, trophies and the Students page, but My Lessons only ticks it once it's passed.
