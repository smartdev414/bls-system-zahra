# BLS platform (classroom.tms.webcam)

Next.js app in `/opt/tae/bls-system`, hosted on Vercel at https://classroom.tms.webcam. A sign-language school: tutors teach live classes and build courses; students take lessons, tests and leagues. Users are teachers and students, not engineers — keep everything simple.

## Roles and where they land
- **admin** → `/admin/*` (users, students, courses, tests, signs, leagues, settings, tickets, audit logs)
- **tutor** → `/tutor/*` (courses + lessons, sessions, tests, students, messages, reviews, leagues)
- **student** → `/student/*` (courses, lessons, tests, dictionary + flashcards, leagues, messages, tickets, certifications)
- **support** → `/support/*`
- Public: `/login`, `/register`, `/forgot-password`, `/it-requirements`

Route list for `--routes`: `find app -name page.tsx | sed -E 's#^app##; s#/page.tsx$##; s#/\([^)]+\)##g'`, then keep the paths for the role being swept and swap `[id]` segments for real ids seen while crawling.

## Don't touch on live
- `/tutor/classroom/[id]`, `/student/classroom/[id]` join real LiveKit rooms, and recordings start from there. Don't open them on live without the user's OK.
- Messages, tickets, invites, student approval and enrolments all notify real people.
- `.env` `DATABASE_URL` is the **production** Neon database. Never write test data to it. Schema changes are applied by hand (there is no `_prisma_migrations` table), so leave schema alone without the user's go-ahead.

## Local verification
- DB: docker `bls-test-db` on 127.0.0.1:55432 (start it with `docker start bls-test-db`), users `*@t.test` / `test1234`. If the schema has moved on, push it to a *fresh* database name. Prisma refuses `db push --accept-data-loss` from agents.
- Run with `DATABASE_URL=<local> NEXT_PUBLIC_PUSHER_KEY=dummy npm run dev` (port 4000). Without a Pusher key, every dashboard page crashes.
- Then `node <skill>/scripts/sweep.mjs --url http://localhost:4000 …`.
- Checks: `npx tsc --noEmit`, `npx eslint <changed files>`.

## Deploy
Push to `main` on GitHub (`origin`) → Vercel deploys production. Ask before the first push in a session. The mobile app (`/opt/tae/bls-system-mobile`) is separate and doesn't get these fixes.

## Known from the first sweep (2026-10-28)
- The footer links `/privacy` and `/terms` (`components/layout/footer.tsx`) return 404. Writing those pages needs real policy text from the user.
