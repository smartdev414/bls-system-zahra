/**
 * Display settings for people with low vision (e.g. Usher syndrome) or colour
 * blindness. Kept per device in localStorage and applied to <html> as
 * attributes, which app/globals.css turns into styles. The colour scheme
 * (light / dark / yellow) is a next-themes theme, so it lives there instead.
 */

export const TEXT_SIZES = [100, 125, 150] as const
export type TextSize = (typeof TEXT_SIZES)[number]

export type ColourVision = "standard" | "red-green"

export interface A11yPrefs {
  textSize: TextSize
  highContrast: boolean
  colourVision: ColourVision
  reduceMotion: boolean
  underlineLinks: boolean
}

export const DEFAULT_PREFS: A11yPrefs = {
  textSize: 100,
  highContrast: false,
  colourVision: "standard",
  reduceMotion: false,
  underlineLinks: false,
}

export const A11Y_STORAGE_KEY = "a11y-prefs"

export function readPrefs(): A11yPrefs {
  try {
    const raw = localStorage.getItem(A11Y_STORAGE_KEY)
    if (!raw) return DEFAULT_PREFS
    const p = JSON.parse(raw) as Partial<A11yPrefs>
    return {
      textSize: TEXT_SIZES.includes(p.textSize as TextSize) ? (p.textSize as TextSize) : 100,
      highContrast: p.highContrast === true,
      colourVision: p.colourVision === "red-green" ? "red-green" : "standard",
      reduceMotion: p.reduceMotion === true,
      underlineLinks: p.underlineLinks === true,
    }
  } catch {
    return DEFAULT_PREFS
  }
}

export function savePrefs(prefs: A11yPrefs) {
  try {
    localStorage.setItem(A11Y_STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // Private mode or storage blocked: settings still apply for this visit.
  }
}

export function applyPrefs(prefs: A11yPrefs) {
  const el = document.documentElement
  el.style.fontSize = prefs.textSize === 100 ? "" : `${prefs.textSize}%`
  el.toggleAttribute("data-high-contrast", prefs.highContrast)
  el.toggleAttribute("data-reduce-motion", prefs.reduceMotion)
  el.toggleAttribute("data-underline-links", prefs.underlineLinks)
  if (prefs.colourVision === "standard") el.removeAttribute("data-colour-vision")
  else el.setAttribute("data-colour-vision", prefs.colourVision)
}

/**
 * Runs in <head> before the first paint so a saved text size or contrast
 * doesn't flash in after the page loads. Mirrors readPrefs + applyPrefs.
 */
export const A11Y_BOOT_SCRIPT = `(function(){try{var p=JSON.parse(localStorage.getItem(${JSON.stringify(
  A11Y_STORAGE_KEY
)})||"null");if(!p)return;var e=document.documentElement;if([125,150].indexOf(p.textSize)>-1)e.style.fontSize=p.textSize+"%";if(p.highContrast===true)e.setAttribute("data-high-contrast","");if(p.reduceMotion===true)e.setAttribute("data-reduce-motion","");if(p.underlineLinks===true)e.setAttribute("data-underline-links","");if(p.colourVision==="red-green")e.setAttribute("data-colour-vision","red-green")}catch(_){}})()`
