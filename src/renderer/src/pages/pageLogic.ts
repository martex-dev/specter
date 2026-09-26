// Pure helpers used by the internal pages (kept free of DOM/store imports so
// they can be unit-tested).

/**
 * Index to pass to `bookmarks:move` when `dragId` is dropped on the bookmark
 * `targetId`: the target's position among its siblings in stored `sort`
 * order. (The Bookmarks page lists folders first and search results across
 * folders, so the on-screen row index is not a sibling position.)
 */
export function bookmarkDropIndex(all: { id: string; parentId: string | null; sort: number }[], targetId: string): number {
  const target = all.find((b) => b.id === targetId)
  if (!target) return 9999
  const siblings = all.filter((b) => b.parentId === target.parentId).sort((a, b) => a.sort - b.sort)
  return siblings.findIndex((b) => b.id === targetId)
}

/** True when an http(s) URL points at this machine (loopback host), not merely starts with "localhost". */
export function isLoopbackUrl(url: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/i.test(url.trim())
}

/**
 * One entry per local calendar day from `days` days ago through today
 * (YYYY-MM-DD, oldest first), filled from `rows` and zero where there was no activity.
 */
export function fillDays<T extends { day: string }>(rows: T[], days: number, empty: (day: string) => T, now = new Date()): T[] {
  const byDay = new Map(rows.map((r) => [r.day, r]))
  const out: T[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    const key = d.toLocaleDateString('sv-SE')
    out.push(byDay.get(key) ?? empty(key))
  }
  return out
}
