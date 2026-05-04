"use client"

import { useParams } from "next/navigation"
import {
  Award, CheckCircle2, XCircle, Calendar,
  Shield, Video, BookOpen, Users, Loader2,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { useFetch } from "@/hooks/use-fetch"

type CertData = {
  certificate: {
    studentName: string
    studentAvatar: string | null
    programTitle: string
    level: string
    issuedAt: string
    expiresAt: string | null
    isExpired: boolean
    isValid: boolean
    steps: { title: string; type: string }[]
  }
}

const stepIcon: Record<string, React.ElementType> = {
  COURSE_COMPLETION: Award,
  QUIZ: BookOpen,
  VIDEO_SUBMISSION: Video,
  LIVE_ASSESSMENT: Users,
}


export default function VerifyCertificatePage() {
  const { token } = useParams<{ token: string }>()
  const { data, loading } = useFetch<CertData>(`/api/verify/${token}`, {
    errorMessage: false,
  })

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-violet-50 to-sky-50">
        <Loader2 className="size-8 animate-spin text-violet-600" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-rose-50 to-orange-50 px-4">
        <div className="max-w-md w-full text-center">
          <div className="size-16 rounded-full bg-rose-100 flex items-center justify-center mx-auto mb-4">
            <XCircle className="size-8 text-rose-500" />
          </div>
          <h1 className="text-2xl font-black text-rose-900">Certificate Not Found</h1>
          <p className="text-sm text-rose-600 mt-2">
            This certificate link is invalid or has been revoked. Please check the URL and try again.
          </p>
        </div>
      </div>
    )
  }

  const cert = data.certificate

  return (
    <div className="min-h-screen bg-linear-to-br from-violet-50 via-white to-sky-50 flex items-center justify-center px-4 py-12">
      <div className="max-w-lg w-full">
        <div className="rounded-2xl bg-white shadow-xl overflow-hidden border">
          <div className="relative bg-linear-to-br from-violet-600 via-violet-500 to-sky-500 px-8 py-10 text-center text-white">
            <div className="absolute -right-8 -top-8 size-40 rounded-full bg-white/5" />
            <div className="absolute -left-4 bottom-0 size-28 rounded-full bg-white/5" />
            <div className="relative">
              <div className="size-14 rounded-2xl bg-white/20 flex items-center justify-center mx-auto mb-3">
                <Award className="size-7" />
              </div>
              <p className="text-xs font-bold uppercase tracking-widest text-white/60 mb-1">Certificate of Achievement</p>
              <h1 className="text-2xl font-black tracking-tight">{cert.programTitle}</h1>
              <Badge className="mt-3 bg-white/20 text-white border-0 text-xs">
                {cert.level} Level
              </Badge>
            </div>
          </div>

          {/* Body */}
          <div className="px-8 py-8">
            {/* Status */}
            <div className="flex items-center justify-center gap-2 mb-6">
              {cert.isValid ? (
                <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 gap-1 text-sm px-3 py-1">
                  <CheckCircle2 className="size-4" /> Valid Certificate
                </Badge>
              ) : (
                <Badge className="bg-rose-100 text-rose-700 border-rose-200 gap-1 text-sm px-3 py-1">
                  <XCircle className="size-4" /> Expired
                </Badge>
              )}
            </div>

            {/* Recipient */}
            <div className="text-center mb-6">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Awarded to</p>
              <p className="text-xl font-black text-foreground">{cert.studentName}</p>
            </div>

            {/* Dates */}
            <div className="flex items-center justify-center gap-6 text-xs text-muted-foreground mb-6">
              <div className="flex items-center gap-1.5">
                <Calendar className="size-3" />
                Issued {new Date(cert.issuedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
              </div>
              {cert.expiresAt && (
                <div className="flex items-center gap-1.5">
                  <Calendar className="size-3" />
                  {cert.isExpired ? "Expired" : "Expires"} {new Date(cert.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
                </div>
              )}
            </div>

            {/* Completed steps */}
            <div className="border-t pt-5">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
                <Shield className="size-3" /> Assessment Completed
              </p>
              <div className="flex flex-col gap-2">
                {cert.steps.map((step, i) => {
                  const Icon = stepIcon[step.type] ?? BookOpen
                  return (
                    <div key={i} className="flex items-center gap-2.5 text-sm">
                      <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
                      <Icon className="size-3.5 text-muted-foreground shrink-0" />
                      <span>{step.title}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-8 py-4 bg-muted/30 border-t text-center">
            <p className="text-[10px] text-muted-foreground">
              Verified by BSL Platform &middot; This certificate confirms the holder has passed all required assessments.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
