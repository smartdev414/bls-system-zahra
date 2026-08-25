-- Adds the "Support Team" role.
-- Postgres will not let a value added to an enum be used in the same
-- transaction, so this runs on its own; Prisma applies each migration file
-- separately, which is enough.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SUPPORT';
