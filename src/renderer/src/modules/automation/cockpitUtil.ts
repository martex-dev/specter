/** Normalizes user input to an http(s) URL, or null. */
export function safeHttpUrl(input: string): string | null {
  let v = input.trim()
  if (!v) return null
  if (!/^[a-z]+:\/\//i.test(v)) v = 'https://' + v
  try {
    const u = new URL(v)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}
