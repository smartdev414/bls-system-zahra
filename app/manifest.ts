import type { MetadataRoute } from "next"
import { APP_NAME, THEME_COLOR } from "@/lib/pwa"

// Lets phones "install" the site to the home screen. Icons are generated from
// public/brand/deafsign-logo.png into public/icons (white square, mark centred; the
// maskable one keeps the mark inside the 80% safe circle).
//
// start_url "/" redirects to /login, which proxy.ts forwards a signed-in user
// on to their own dashboard — so one manifest works for every role.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: "Learn British Sign Language online — live classes, lessons and practice.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    theme_color: THEME_COLOR,
    background_color: THEME_COLOR,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
}
