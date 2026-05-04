# Pre-handover checklist (MOT-style)

Use this before declaring the platform ready for final client handover. Record date, reviewer, and pass/fail per section.

## 1. Authentication and roles

- [ ] Admin, tutor, and student flows sign in and land on the correct dashboard.
- [ ] Unauthorized routes return 401/403 as expected.
- [ ] Password reset / verification flows work if enabled in your deployment.

## 2. Courses and progression

- [ ] Course CRUD for tutors; publish/archive respected on the student catalogue.
- [ ] Course levels display as **L1–L6** consistently (catalogue, detail, certificates snapshot text where applicable).
- [ ] Enrolment, progress, and lesson completion behave correctly after DB migrations.

## 3. Live sessions (crash protocol — product expectation)

- [ ] **Student:** Tapping **Leave** shows the intentional-leave message; an unexpected drop shows **Connection lost** with reconnect steps and **Try reconnecting**.
- [ ] **Tutor:** End session completes the session and returns to the sessions list; token/recording errors are logged and do not strand the UI.
- [ ] LiveKit credentials (URL, API keys) are set for staging and production.

## 4. Dictionary

- [ ] Dictionary loads for student and tutor; filters work.
- [ ] Video uses browser controls without an obvious download control (`nodownload`); images discourage right-click save (best-effort — not a substitute for signed URLs or DRM).
- [ ] Admin dictionary CRUD and seed still work after level enum migration.

## 5. Categories

- [ ] **Course categories** (Admin → Categories) appear on courses and filters; deleting blocked when courses still reference the category.
- [ ] Team understands: course categories ≠ dictionary sign category strings.

## 6. Database and migrations

- [ ] `CourseLevel` enum in the database matches Prisma (`L1`–`L6`). If upgrading from `BEGINNER`/`INTERMEDIATE`/`ADVANCED` without reset, apply the SQL rename/add migration your team agreed on, then `prisma migrate resolve` / deploy as appropriate.
- [ ] `npx prisma migrate deploy` (or your CI equivalent) succeeds on a clone of production-like data.

## 7. Email, uploads, and third parties

- [ ] Outbound email (if used) sends from the correct domain and SPF/DKIM are valid.
- [ ] File uploads (e.g. S3) succeed and buckets are not world-writable.

## 8. Security and ops

- [ ] Secrets only in environment / secret manager — not in the repo.
- [ ] Rate limiting / basic abuse considerations for auth and public APIs.
- [ ] Error pages do not leak stack traces or internal URLs in production.

## 9. Sign-off

- [ ] Smoke test on production-like URL after deploy.
- [ ] Rollback plan documented (previous image / migration down strategy).

---

**Note:** Browser-level dictionary protection does not stop determined users from capturing URLs or network traffic; treat sensitive media with CDN tokens or streaming policies if required.
