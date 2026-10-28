"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "./button"
import { cn } from "@/lib/utils"

interface PaginationProps {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  className?: string
}

function getPageNumbers(page: number, totalPages: number): (number | "...")[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
  if (page <= 4) return [1, 2, 3, 4, 5, "...", totalPages]
  if (page >= totalPages - 3) {
    return [1, "...", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
  }
  return [1, "...", page - 1, page, page + 1, "...", totalPages]
}

export function Pagination({ page, totalPages, onPageChange, className }: PaginationProps) {
  if (totalPages <= 1) return null

  const pages = getPageNumbers(page, totalPages)

  return (
    <div className={cn("flex items-center justify-center gap-1", className)}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        className="gap-1"
        aria-label="Previous page"
      >
        {/* Arrows only on a phone, so seven page numbers still fit. */}
        <ChevronLeft className="size-3.5" /> <span className="hidden sm:inline">Previous</span>
      </Button>

      <div className="flex items-center gap-1 mx-1">
        {pages.map((p, i) =>
          p === "..." ? (
            // Not `i`: on page 1 the first "…" sits at index 5, next to page 5.
            <span key={`gap-${i}`} className="px-1.5 text-muted-foreground text-sm select-none">…</span>
          ) : (
            <Button
              key={p}
              variant={p === page ? "default" : "outline"}
              size="icon"
              onClick={() => onPageChange(p as number)}
              className="size-8 text-xs"
            >
              {p}
            </Button>
          )
        )}
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        className="gap-1"
        aria-label="Next page"
      >
        <span className="hidden sm:inline">Next</span> <ChevronRight className="size-3.5" />
      </Button>
    </div>
  )
}
