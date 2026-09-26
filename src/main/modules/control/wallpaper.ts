// Local wallpaper images: the user picks a file, SPECTER copies it into its own
// data folder (never uploaded anywhere) and the new tab page loads it as a data
// URL. Only files inside that folder can be read back through IPC.
import { app, BrowserWindow, dialog } from 'electron'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { extname, join, relative, resolve, isAbsolute } from 'node:path'

const MAX_BYTES = 30 * 1024 * 1024
const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp'
}

export function wallpaperDir(): string {
  return join(app.getPath('userData'), 'wallpapers')
}

function inside(dir: string, file: string): boolean {
  const rel = relative(resolve(dir), resolve(file))
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
}

export async function pickWallpaper(win: BrowserWindow | null): Promise<string | null> {
  const opts = { title: 'Choose a new tab wallpaper', properties: ['openFile' as const], filters: [{ name: 'Images', extensions: Object.keys(MIME).map((e) => e.slice(1)) }] }
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  const src = r.canceled ? null : r.filePaths[0]
  if (!src) return null
  const ext = extname(src).toLowerCase()
  if (!MIME[ext]) throw new Error('Unsupported image type')
  const size = statSync(src).size
  if (size > MAX_BYTES) throw new Error('Image is larger than 30 MB')
  const dir = wallpaperDir()
  mkdirSync(dir, { recursive: true })
  const hash = createHash('sha1').update(readFileSync(src)).digest('hex').slice(0, 12)
  const dest = join(dir, `wallpaper-${hash}${ext}`)
  if (!existsSync(dest)) copyFileSync(src, dest)
  // Keep only the current custom wallpaper.
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (p !== dest && /^wallpaper-[0-9a-f]+\.\w+$/.test(f)) {
      try {
        unlinkSync(p)
      } catch {
        /* in use */
      }
    }
  }
  return dest
}

export function wallpaperData(path: string): string | null {
  if (typeof path !== 'string' || !inside(wallpaperDir(), path) || !existsSync(path)) return null
  const mime = MIME[extname(path).toLowerCase()]
  if (!mime) return null
  const buf = readFileSync(path)
  if (buf.length > MAX_BYTES) return null
  return `data:${mime};base64,${buf.toString('base64')}`
}
