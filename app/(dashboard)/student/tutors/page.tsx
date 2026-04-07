"use client"

import { useState } from "react"
import Link from "next/link"
import {
  Search, BookOpen, Users, Star, Video,
  Loader2, BadgeCheck, ArrowRight, GraduationCap,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useFetch } from "@/hooks/use-fetch"
import { useDebounce } from "@/hooks/use-debounce"

type Tutor = {
  id: string
  name: string
  avatarUrl: string | null
  bio: string | null
  qualifications: string[]
  isVerified: boolean
  courseCount: number
  sessionCount: number
  studentCount: number
  avgRating: number | null
  reviewCount: number
  joinedAt: string
}

type TutorsData = { tutors: Tutor[]; total: number }

export default function TutorsPage() {
  const [query, setQuery] = useState("")
  const debouncedQuery = useDebounce(query)

  const params = new URLSearchParams()
  if (debouncedQuery) params.set("q", debouncedQuery)

  const { data, loading } = useFetch<TutorsData>(`/api/student/tutors?${params.toString()}`, {
    errorMessage: "Could not load tutors",
  })

  const tutors = data?.tutors ?? []

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black tracking-tight">Tutors</h1>
        <p className="text-sm text-muted-foreground mt-1">Browse tutors and explore their courses</p>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Search tutors..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9 h-9"
        />
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="rounded-xl bg-card p-5 animate-pulse">
              <div className="flex items-center gap-3 mb-4">
                <div className="size-12 rounded-full bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-muted rounded w-2/3" />
                  <div className="h-3 bg-muted rounded w-1/3" />
                </div>
              </div>
              <div className="h-10 bg-muted rounded mb-3" />
              <div className="h-8 bg-muted rounded" />
            </div>
          ))}
        </div>
      ) : tutors.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tutors.map((tutor) => (
            <TutorCard key={tutor.id} tutor={tutor} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="rounded-full bg-muted p-5 mb-4">
            <GraduationCap className="size-8 text-muted-foreground" />
          </div>
          <p className="font-semibold">
            {debouncedQuery ? "No tutors match your search" : "No tutors available yet"}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {debouncedQuery ? "Try a different search term." : "Check back later."}
          </p>
        </div>
      )}
    </div>
  )
}

function TutorCard({ tutor }: { tutor: Tutor }) {
  const initials = tutor.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)

  return (
    <Link
      href={`/student/tutors/${tutor.id}`}
      className="group block rounded-xl bg-card hover:bg-muted/30 transition-colors"
    >
      <div className="p-5">
        {/* Avatar + name */}
        <div className="flex items-center gap-3 mb-3">
          <Avatar className="size-12 ring-2 ring-primary/10">
            {tutor.avatarUrl && <AvatarImage src={tutor.avatarUrl} alt={tutor.name} />}
            <AvatarFallback className="bg-primary/10 text-primary font-bold text-sm">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="font-bold text-sm truncate group-hover:text-primary transition-colors">
                {tutor.name}
              </h3>
              {tutor.isVerified && (
                <BadgeCheck className="size-4 text-primary shrink-0" />
              )}
            </div>
            {tutor.avgRating ? (
              <div className="flex items-center gap-1 mt-0.5">
                <Star className="size-3 fill-amber-400 text-amber-400" />
                <span className="text-xs font-semibold">{tutor.avgRating}</span>
                <span className="text-[10px] text-muted-foreground">({tutor.reviewCount})</span>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground mt-0.5">New tutor</p>
            )}
          </div>
        </div>

        {/* Bio */}
        {tutor.bio ? (
          <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed mb-3">
            {tutor.bio}
          </p>
        ) : (
          <div className="mb-3" />
        )}

        {/* Qualifications */}
        {tutor.qualifications.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {tutor.qualifications.slice(0, 3).map((q) => (
              <Badge key={q} variant="secondary" className="text-[10px] h-5 px-1.5 font-medium">
                {q}
              </Badge>
            ))}
            {tutor.qualifications.length > 3 && (
              <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
                +{tutor.qualifications.length - 3}
              </Badge>
            )}
          </div>
        )}

        {/* Stats */}
        <div className="flex items-center gap-4 text-[11px] text-muted-foreground pt-3 border-t">
          <span className="flex items-center gap-1">
            <BookOpen className="size-3" /> {tutor.courseCount} courses
          </span>
          <span className="flex items-center gap-1">
            <Users className="size-3" /> {tutor.studentCount} students
          </span>
          <span className="flex items-center gap-1">
            <Video className="size-3" /> {tutor.sessionCount} sessions
          </span>
        </div>
      </div>

      {/* View profile bar */}
      <div className="flex items-center justify-center gap-1.5 px-5 py-2.5 border-t text-xs font-semibold text-primary group-hover:bg-primary/5 transition-colors">
        View Profile <ArrowRight className="size-3" />
      </div>
    </Link>
  )
}
