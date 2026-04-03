import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"

const SEED_SIGNS = [
  { word: "Hello", category: "Greetings", level: "BEGINNER" as const, description: "Open your hand and wave it from side to side at head level.", handshape: "Open hand", usage: "Used as a general greeting" },
  { word: "Thank you", category: "Greetings", level: "BEGINNER" as const, description: "Place your flat hand on your chin and move it forward.", handshape: "Flat hand", usage: "Expressing gratitude" },
  { word: "Please", category: "Greetings", level: "BEGINNER" as const, description: "Rub your flat hand in a circular motion on your chest.", handshape: "Flat hand", usage: "Polite request" },
  { word: "Sorry", category: "Greetings", level: "BEGINNER" as const, description: "Make a fist and rub it in a circular motion on your chest.", handshape: "Fist", usage: "Expressing apology" },
  { word: "Good", category: "Adjectives", level: "BEGINNER" as const, description: "Extend your thumb upwards with a closed fist.", handshape: "Thumbs up", usage: "Expressing approval or positivity" },
  { word: "Bad", category: "Adjectives", level: "BEGINNER" as const, description: "Extend your thumb downwards with a closed fist.", handshape: "Thumbs down", usage: "Expressing disapproval or negativity" },
  { word: "Yes", category: "Responses", level: "BEGINNER" as const, description: "Nod your head or make a fist and nod it up and down.", handshape: "Fist", usage: "Affirmative response" },
  { word: "No", category: "Responses", level: "BEGINNER" as const, description: "Shake your head or bring your index and middle fingers together with your thumb.", handshape: "Index + middle finger", usage: "Negative response" },
  { word: "Family", category: "People", level: "BEGINNER" as const, description: "Form an F with both hands and move them in a circle.", handshape: "F handshape", usage: "Referring to family members collectively" },
  { word: "Friend", category: "People", level: "BEGINNER" as const, description: "Hook your index fingers together and twist them.", handshape: "Hooked index", usage: "Referring to a friend" },
  { word: "School", category: "Education", level: "BEGINNER" as const, description: "Tap the back of one hand with the other hand twice.", handshape: "Flat hand", usage: "Referring to school or education" },
  { word: "Work", category: "Activities", level: "INTERMEDIATE" as const, description: "Tap your dominant fist on top of your non-dominant fist twice.", handshape: "Fist", usage: "Referring to work or employment" },
  { word: "Help", category: "Actions", level: "BEGINNER" as const, description: "Place your fist on your open palm and lift both upward together.", handshape: "Fist on palm", usage: "Asking for or offering assistance" },
  { word: "Water", category: "Food & Drink", level: "BEGINNER" as const, description: "Form a W with your dominant hand and tap your chin twice.", handshape: "W handshape", usage: "Referring to water" },
  { word: "Eat", category: "Food & Drink", level: "BEGINNER" as const, description: "Bring your fingertips to your mouth repeatedly.", handshape: "Flat O", usage: "Referring to eating" },
  { word: "Home", category: "Places", level: "BEGINNER" as const, description: "Touch the fingertips of a flat O to your cheek, then move slightly and repeat.", handshape: "Flat O", usage: "Referring to home" },
  { word: "Time", category: "Concepts", level: "INTERMEDIATE" as const, description: "Point to your wrist where a watch would be.", handshape: "Pointed index", usage: "Asking about or referring to time" },
  { word: "Love", category: "Emotions", level: "BEGINNER" as const, description: "Cross both hands over your chest.", handshape: "Crossed hands", usage: "Expressing love or affection" },
]

export async function POST() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "ADMIN") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const existing = await prisma.sign.count()
    if (existing > 0) {
      return NextResponse.json({ message: `Dictionary already has ${existing} signs. Skipping seed.` })
    }

    const signs = await prisma.sign.createMany({
      data: SEED_SIGNS.map((s) => ({ ...s, videoUrl: null, imageUrl: null })),
      skipDuplicates: true,
    })

    return NextResponse.json({ message: `Seeded ${signs.count} signs` })
  } catch (err) {
    console.error("[POST /api/admin/signs/seed]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
