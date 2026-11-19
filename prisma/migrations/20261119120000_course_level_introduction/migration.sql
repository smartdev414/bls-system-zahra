-- Adds an "Introduction" level that sits before L1.
ALTER TYPE "CourseLevel" ADD VALUE IF NOT EXISTS 'Introduction' BEFORE 'L1';
