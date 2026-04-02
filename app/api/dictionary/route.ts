import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"

// Static BSL sign dictionary — in production this would come from the DB or a CMS
const SIGNS: Array<{
  id: string
  word: string
  category: string
  level: "BEGINNER" | "INTERMEDIATE" | "ADVANCED"
  description: string
  videoUrl: string | null
  imageUrl: string | null
  handshape: string
  usage: string
}> = [
  {
    id: "1",
    word: "Hello",
    category: "Greetings",
    level: "BEGINNER",
    description: "Open your hand and wave it from side to side at head level.",
    videoUrl: null,
    imageUrl: null,
    handshape: "Open hand",
    usage: "Used as a general greeting",
  },
  {
    id: "2",
    word: "Thank you",
    category: "Greetings",
    level: "BEGINNER",
    description: "Place your flat hand on your chin and move it forward.",
    videoUrl: null,
    imageUrl: null,
    handshape: "Flat hand",
    usage: "Expressing gratitude",
  },
  {
    id: "3",
    word: "Please",
    category: "Greetings",
    level: "BEGINNER",
    description: "Rub your flat hand in a circular motion on your chest.",
    videoUrl: null,
    imageUrl: null,
    handshape: "Flat hand",
    usage: "Polite request",
  },
  {
    id: "4",
    word: "Sorry",
    category: "Greetings",
    level: "BEGINNER",
    description: "Make a fist and rub it in a circular motion on your chest.",
    videoUrl: null,
    imageUrl: null,
    handshape: "Fist",
    usage: "Expressing apology",
  },
  {
    id: "5",
    word: "Good",
    category: "Adjectives",
    level: "BEGINNER",
    description: "Extend your thumb upwards with a closed fist.",
    videoUrl: null,
    imageUrl: null,
    handshape: "Thumbs up",
    usage: "Expressing approval or positivity",
  },
  {
    id: "6",
    word: "Bad",
    category: "Adjectives",
    level: "BEGINNER",
    description: "Extend your thumb downwards with a closed fist.",
    videoUrl: null,
    imageUrl: null,
    handshape: "Thumbs down",
    usage: "Expressing disapproval or negativity",
  },
  {
    id: "7",
    word: "Yes",
    category: "Responses",
    level: "BEGINNER",
    description: "Nod your head or make a fist and nod it up and down.",
    videoUrl: null,
    imageUrl: null,
    handshape: "Fist",
    usage: "Affirmative response",
  },
  {
    id: "8",
    word: "No",
    category: "Responses",
    level: "BEGINNER",
    description: "Shake your head or bring your index and middle fingers together with your thumb.",
    videoUrl: null,
    imageUrl: null,
    handshape: "Index + middle finger",
    usage: "Negative response",
  },
  {
    id: "9",
    word: "Family",
    category: "People",
    level: "BEGINNER",
    description: "Form an F with both hands and move them in a circle.",
    videoUrl: null,
    imageUrl: null,
    handshape: "F handshape",
    usage: "Referring to family members collectively",
  },
  {
    id: "10",
    word: "Friend",
    category: "People",
    level: "BEGINNER",
    description: "Hook your index fingers together and twist them.",
    videoUrl: null,
    imageUrl: null,
    handshape: "Hooked index",
    usage: "Referring to a friend",
  },
  {
    id: "11",
    word: "School",
    category: "Education",
    level: "BEGINNER",
    description: "Tap the back of one hand with the other hand twice.",
    videoUrl: null,
    imageUrl: null,
    handshape: "Flat hand",
    usage: "Referring to school or education",
  },
  {
    id: "12",
    word: "Work",
    category: "Activities",
    level: "INTERMEDIATE",
    description: "Tap your dominant fist on top of your non-dominant fist twice.",
    videoUrl: null,
    imageUrl: null,
    handshape: "Fist",
    usage: "Referring to work or employment",
  },
  {
    id: "13",
    word: "Help",
    category: "Actions",
    level: "BEGINNER",
    description: "Place your fist on your open palm and lift both upward together.",
    videoUrl: null,
    imageUrl: null,
    handshape: "Fist on palm",
    usage: "Asking for or offering assistance",
  },
  {
    id: "14",
    word: "Water",
    category: "Food & Drink",
    level: "BEGINNER",
    description: "Form a W with your dominant hand and tap your chin twice.",
    videoUrl: null,
    imageUrl: null,
    handshape: "W handshape",
    usage: "Referring to water",
  },
  {
    id: "15",
    word: "Eat",
    category: "Food & Drink",
    level: "BEGINNER",
    description: "Bring your fingertips to your mouth repeatedly.",
    videoUrl: null,
    imageUrl: null,
    handshape: "Flat O",
    usage: "Referring to eating",
  },
  {
    id: "16",
    word: "Home",
    category: "Places",
    level: "BEGINNER",
    description: "Touch the fingertips of a flat O to your cheek, then move slightly and repeat.",
    videoUrl: null,
    imageUrl: null,
    handshape: "Flat O",
    usage: "Referring to home",
  },
  {
    id: "17",
    word: "Time",
    category: "Concepts",
    level: "INTERMEDIATE",
    description: "Point to your wrist where a watch would be.",
    videoUrl: null,
    imageUrl: null,
    handshape: "Pointed index",
    usage: "Asking about or referring to time",
  },
  {
    id: "18",
    word: "Love",
    category: "Emotions",
    level: "BEGINNER",
    description: "Cross both hands over your chest.",
    videoUrl: null,
    imageUrl: null,
    handshape: "Crossed hands",
    usage: "Expressing love or affection",
  },
]

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const q = req.nextUrl.searchParams.get("q")?.toLowerCase().trim() ?? ""
    const category = req.nextUrl.searchParams.get("category")?.toLowerCase().trim() ?? ""
    const level = req.nextUrl.searchParams.get("level")?.toUpperCase().trim() ?? ""

    let results = SIGNS

    if (q) {
      results = results.filter(
        (s) =>
          s.word.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.category.toLowerCase().includes(q)
      )
    }

    if (category) {
      results = results.filter((s) => s.category.toLowerCase() === category)
    }

    if (level) {
      results = results.filter((s) => s.level === level)
    }

    const categories = [...new Set(SIGNS.map((s) => s.category))].sort()

    return NextResponse.json({ signs: results, total: results.length, categories })
  } catch (err) {
    console.error("[GET /api/dictionary]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
