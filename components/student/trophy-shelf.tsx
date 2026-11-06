import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export type StudentTrophy = {
  id: string
  courseTitle: string
  /** The teacher who gave it; null for the one for finishing a course so far. */
  givenBy: string | null
  createdAt: string
}

/**
 * The student's trophies, newest first — for finishing their lessons and tests,
 * or given by a teacher for their hard work. Only shown once they have one.
 */
export function TrophyShelf({ trophies }: { trophies: StudentTrophy[] }) {
  if (trophies.length === 0) return null
  return (
    <Card id="trophies" className="shadow-sm border-amber-200 bg-gradient-to-br from-amber-50 to-background scroll-mt-20">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <span className="text-xl leading-none">🏆</span>
          My trophies
          <span className="text-sm font-normal text-muted-foreground">({trophies.length})</span>
        </CardTitle>
        <p className="text-sm text-muted-foreground">Well done — you have earned these with your hard work. Keep it up!</p>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {trophies.map((t) => (
            <li key={t.id} className="flex items-center gap-3 rounded-xl border border-amber-200 bg-background p-3">
              <span className="text-2xl leading-none shrink-0" aria-hidden>🏆</span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold truncate">{t.courseTitle}</span>
                <span className="block text-xs text-muted-foreground">
                  {t.givenBy ? `From ${t.givenBy}` : "Finished every lesson and test"}
                  {" · "}
                  {new Date(t.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
