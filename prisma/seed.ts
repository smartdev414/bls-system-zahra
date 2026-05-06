import { PrismaClient } from "../app/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import bcrypt from "bcryptjs"
import "dotenv/config"

function createClient() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set")
  const adapter = new PrismaPg(url)
  return new PrismaClient({ adapter })
}

const prisma = createClient()

const isProd = process.env.NODE_ENV === "production"

const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    ?? (isProd ? null : "admin@bslplatform.com")
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? (isProd ? null : "Admin@1234")
const ADMIN_NAME     = process.env.ADMIN_NAME     ?? "BSL Admin"

async function main() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error(
      "ADMIN_EMAIL and ADMIN_PASSWORD must be set in environment variables when running in production."
    )
  }

  const existing = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } })

  if (existing) {
    console.log(`✓  Admin already exists: ${existing.email} (id: ${existing.id})`)
    return
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12)

  const admin = await prisma.user.create({
    data: {
      name:         ADMIN_NAME,
      email:        ADMIN_EMAIL,
      passwordHash,
      role:         "ADMIN",
    },
  })

  console.log(`✓  Admin created successfully`)
  console.log(`   Name  : ${admin.name}`)
  console.log(`   Email : ${admin.email}`)
  console.log(`   ID    : ${admin.id}`)

  if (!isProd) {
    console.log(`   Password: ${ADMIN_PASSWORD}  ← change this in production!`)
  }
}

main()
  .catch((err) => {
    console.error("Seed failed:", err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
