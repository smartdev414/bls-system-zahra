import { cn } from "@/lib/utils"

/** Mirror the local camera so self-view matches a familiar mirror (signing, grooming). */
export function localCameraClassName(
  isLocal: boolean,
  base = "w-full h-full object-cover",
) {
  return cn(base, isLocal && "-scale-x-100")
}
