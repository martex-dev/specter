// Full-bleed wallpaper behind the new tab page, mounted through the
// newTabBackgrounds registry as the first child of `.ntp`.
import { useSetting } from '../../../stores/settings'
import { useControl } from '../store'
import { Wallpaper } from './Wallpaper'

export default function NewTabWallpaper() {
  const value = useSetting('appearance.wallpaper')
  const cfg = useControl((s) => s.config?.wallpaper)
  if (!value) return null
  return <Wallpaper value={value} dim={cfg?.dim ?? 0.35} animate={cfg?.animate ?? true} />
}
