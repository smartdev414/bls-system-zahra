import { PrismaClient } from "@/app/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

function createPrismaClient() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is not set")
  }
  const adapter = new PrismaPg(process.env.DATABASE_URL)
  return new PrismaClient({ adapter })
}

// Singleton — reuse across hot reloads in dev
declare const globalThis: { prisma?: PrismaClient } & typeof global

const prisma = globalThis.prisma ?? createPrismaClient()
if (process.env.NODE_ENV !== "production") globalThis.prisma = prisma

export default prisma
