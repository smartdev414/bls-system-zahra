---
tags: [skill-creator]
max_turns: 80
timeout_seconds: 3600
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

QA the student side of https://classroom.tms.webcam, especially on phones. Login is in the env vars QA_EMAIL and QA_PASSWORD (it's a student account). Find what's broken or awkward and fix it in /opt/tae/bls-system.
