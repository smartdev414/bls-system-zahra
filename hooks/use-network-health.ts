"use client"

import { useSyncExternalStore } from "react"
import {
  getNetworkSnapshot, getServerNetworkSnapshot, subscribeNetwork,
  type NetworkSnapshot,
} from "@/lib/network-health"

/**
 * The current state of this browser's link to us. Safe during SSR, where it
 * always reports "online" — a server-rendered "you are offline" banner would
 * flash on every first paint.
 */
export function useNetworkHealth(): NetworkSnapshot {
  return useSyncExternalStore(subscribeNetwork, getNetworkSnapshot, getServerNetworkSnapshot)
}
