import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, CheckCircle2, ChevronRight, Info, X, XCircle } from 'lucide-react'
import { prettyAccelerator } from '@shared/keys'
import { faviconFallback } from '../lib/format'
import { closeMenu, dismissToast, useUi, type MenuItem } from '../stores/ui'
import { getPage } from '../pages/registry'

export function Favicon({ src, url, size = 16 }: { src?: string; url: string; size?: number }) {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [src])
  if (url.startsWith('specter://')) {
    const page = getPage(url.slice(10).split(/[/?#]/)[0] || 'newtab')
    const Icon = page?.icon
    return Icon ? <Icon size={size - 2} style={{ color: 'var(--accent)', flex: 'none' }} /> : <SpecterMark size={size} />
  }
  if (src && !broken) return <img className="favicon" src={src} width={size} height={size} onError={() => setBroken(true)} alt="" draggable={false} />
  return (
    <span className="favicon-fallback" style={{ width: size, height: size }}>
      {faviconFallback(url)}
    </span>
  )
}

export function Kbd({ keys }: { keys?: string }) {
  if (!keys) return null
  const parts = prettyAccelerator(keys).split(/\+(?!$)/)
  return (
    <span className="kbd">
      {parts.map((p, i) => (
        <span key={i}>{p}</span>
      ))}
    </span>
  )
}

export function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={'switch' + (on ? ' on' : '')} disabled={disabled} onClick={() => onChange(!on)} />
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Global tooltip driven by data-tip / data-kbd attributes (one listener for the whole UI). */
export function TooltipLayer() {
  const [tip, setTip] = useState<{ text: string; kbd?: string; x: number; y: number; below: boolean } | null>(null)
  useEffect(() => {
    let timer: number | undefined
    let current: HTMLElement | null = null
    const over = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest?.('[data-tip]') as HTMLElement | null
      if (el === current) return
      current = el
      clearTimeout(timer)
      setTip(null)
      if (!el) return
      timer = window.setTimeout(() => {
        const r = el.getBoundingClientRect()
        const below = r.top < 120
        setTip({ text: el.dataset.tip!, kbd: el.dataset.kbd, x: r.left + r.width / 2, y: below ? r.bottom + 6 : r.top - 6, below })
      }, 450)
    }
    const hide = () => {
      clearTimeout(timer)
      current = null
      setTip(null)
    }
    // Leaving the window (or entering a title-bar drag region) fires no mouseover,
    // only a mouseout with no related target.
    const out = (e: MouseEvent) => {
      if (!e.relatedTarget) hide()
    }
    document.addEventListener('mouseover', over)
    document.addEventListener('mouseout', out)
    document.addEventListener('mousedown', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      document.removeEventListener('mouseover', over)
      document.removeEventListener('mouseout', out)
      document.removeEventListener('mousedown', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [])
  const ref = useRef<HTMLDivElement>(null)
  const [left, setLeft] = useState(0)
  useLayoutEffect(() => {
    if (!tip || !ref.current) return
    const w = ref.current.offsetWidth
    setLeft(Math.max(6, Math.min(window.innerWidth - w - 6, tip.x - w / 2)))
  }, [tip])
  if (!tip) return null
  return (
    <div ref={ref} className="tooltip" style={{ left, top: tip.y, transform: tip.below ? undefined : 'translateY(-100%)' }}>
      {tip.text}
      {tip.kbd && <Kbd keys={tip.kbd} />}
    </div>
  )
}

function MenuList({ items, x, y, flipX, width, onClose, depth = 0 }: { items: MenuItem[]; x: number; y: number; flipX?: number; width?: number; onClose: () => void; depth?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  const [sub, setSub] = useState<{ index: number; x: number; y: number; flipX: number } | null>(null)
  const [sel, setSel] = useState(-1)
  // Submenu intent: don't close an open submenu instantly when the pointer
  // crosses a sibling on its way into the submenu.
  const closeTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => clearTimeout(closeTimer.current), [])
  // Take keyboard focus (a page context menu opens while the web page holds it, so
  // Escape and the arrow keys would otherwise go to the page) and hand it back on close.
  useEffect(() => {
    if (depth) return
    const el = ref.current
    const prev = document.activeElement as HTMLElement | null
    el?.focus({ preventScroll: true })
    return () => {
      const now = document.activeElement
      if (prev && prev !== document.body && prev.isConnected && (!now || now === document.body || el?.contains(now))) prev.focus({ preventScroll: true })
    }
  }, [depth])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    let left = x
    let top = y
    // A submenu that doesn't fit on the right opens to the left of its parent
    // item (the parent can be wider than `width`, which is only a minimum).
    if (left + r.width > window.innerWidth - 6) left = depth && flipX !== undefined ? flipX - r.width - 2 : window.innerWidth - r.width - 6
    if (top + r.height > window.innerHeight - 6) top = Math.max(6, window.innerHeight - r.height - 6)
    setPos({ left: Math.max(6, left), top })
  }, [x, y, flipX, depth, width])

  useEffect(() => {
    if (depth) return
    const key = (e: KeyboardEvent) => {
      const actionable = items.map((it, i) => ({ it, i })).filter(({ it }) => !it.separator && !it.header && !it.disabled)
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const cur = actionable.findIndex((a) => a.i === sel)
        // Nothing selected yet: Down starts at the first item, Up at the last.
        const next = cur < 0 ? actionable[e.key === 'ArrowDown' ? 0 : actionable.length - 1] : actionable[(cur + (e.key === 'ArrowDown' ? 1 : -1) + actionable.length) % actionable.length]
        if (next) setSel(next.i)
      } else if (e.key === 'Enter' && sel >= 0) {
        e.preventDefault()
        const it = items[sel]
        if (it?.run && !it.disabled) {
          onClose()
          it.run()
        }
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [items, sel, onClose, depth])

  return (
    <div ref={ref} className="menu pop" style={{ left: pos.left, top: pos.top, minWidth: width }} role="menu" tabIndex={-1} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) => {
        if (it.separator) return <div key={i} className="menu-sep" />
        if (it.header)
          return (
            <div key={i} className="menu-header label">
              {it.header}
            </div>
          )
        return (
          <div
            key={i}
            role="menuitem"
            aria-disabled={it.disabled}
            className={'menu-item' + (it.disabled ? ' disabled' : '') + (it.danger ? ' danger' : '') + (sel === i ? ' sel' : '')}
            onMouseEnter={(e) => {
              setSel(i)
              clearTimeout(closeTimer.current)
              if (it.submenu) {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                setSub({ index: i, x: r.right + 2, y: r.top - 5, flipX: r.left })
              } else if (sub) closeTimer.current = window.setTimeout(() => setSub(null), 350)
            }}
            onClick={(e) => {
              e.stopPropagation()
              if (it.disabled || it.submenu) return
              onClose()
              it.run?.()
            }}
          >
            <span className="mi-icon">{it.checked !== undefined ? it.checked ? <CheckCircle2 size={14} /> : null : it.icon}</span>
            <span className="ellipsis">{it.label}</span>
            {it.submenu ? <ChevronRight size={14} style={{ marginLeft: 'auto', color: 'var(--fg-3)' }} /> : it.shortcut ? <span className="mi-short">{prettyAccelerator(it.shortcut)}</span> : null}
          </div>
        )
      })}
      {/* Portalled: themes that give .pop a backdrop-filter (Aurora, Holo) make the
          parent menu the containing block of a nested fixed submenu, which would
          then be offset into the parent and clipped by its overflow. */}
      {sub &&
        items[sub.index]?.submenu &&
        createPortal(
          <div onMouseEnter={() => clearTimeout(closeTimer.current)} style={{ display: 'contents' }}>
            <MenuList items={items[sub.index].submenu!} x={sub.x} y={sub.y} flipX={sub.flipX} width={width} onClose={onClose} depth={depth + 1} />
          </div>,
          document.body
        )}
    </div>
  )
}

/**
 * Transparent full-window layer placed just under a popover. Clicks on a web page
 * go to its <webview> guest and never reach this document, so document/window
 * mousedown listeners can't dismiss a popover from there; this layer can.
 */
export function ClickShield({ onDismiss, zIndex }: { onDismiss: () => void; zIndex: number }) {
  return (
    <div
      className="menu-shield"
      style={{ zIndex }}
      onMouseDown={(e) => {
        e.preventDefault()
        onDismiss()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        onDismiss()
      }}
      onWheel={() => onDismiss()}
    />
  )
}

export function MenuLayer() {
  const menu = useUi((s) => s.menu)
  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.menu')) closeMenu()
    }
    const blur = () => closeMenu()
    window.addEventListener('mousedown', close, true)
    window.addEventListener('blur', blur)
    window.addEventListener('resize', blur)
    return () => {
      window.removeEventListener('mousedown', close, true)
      window.removeEventListener('blur', blur)
      window.removeEventListener('resize', blur)
    }
  }, [menu])
  if (!menu) return null
  // Web pages live in <webview> guests whose input never reaches this document,
  // so a transparent shield under the menu catches the dismissing click there.
  return (
    <>
      <ClickShield onDismiss={closeMenu} zIndex={1999} />
      <MenuList items={menu.items} x={menu.x} y={menu.y} width={menu.width} onClose={closeMenu} />
    </>
  )
}

export function Toasts() {
  const toasts = useUi((s) => s.toasts)
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast pop" role="status">
          <span className="t-icon">
            {t.kind === 'ok' ? <CheckCircle2 size={16} className="ok" /> : t.kind === 'warn' ? <AlertTriangle size={16} className="warn" /> : t.kind === 'error' ? <XCircle size={16} className="bad" /> : <Info size={16} className="accent" />}
          </span>
          <div className="grow">
            <div className="t-title">{t.title}</div>
            {t.body && <div className="t-body">{t.body}</div>}
            {t.action && (
              <button
                className="btn sm"
                style={{ marginTop: 8 }}
                onClick={() => {
                  t.action!.run()
                  dismissToast(t.id)
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
          <button className="icon-btn sm" onClick={() => dismissToast(t.id)} aria-label="Dismiss">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}

export function Modal({ title, icon, children, footer, onClose, width }: { title: ReactNode; icon?: ReactNode; children: ReactNode; footer?: ReactNode; onClose: () => void; width?: number }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  // Portalled: a Modal opened from an internal page would otherwise sit inside
  // .content, which Aurora gives a backdrop-filter; its fixed scrim would then
  // cover only the content area and leave the toolbar live.
  return createPortal(
    <div className="scrim center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal pop" style={width ? { width: `min(${width}px, calc(100vw - 40px))` } : undefined} role="dialog" aria-modal="true">
        <div className="modal-h">
          {icon}
          <h2>{title}</h2>
          <span className="spacer" />
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}

/** Small inline sparkline (SVG). Values must be real samples. */
export function Sparkline({ values, width = 60, height = 16, color = 'var(--accent)', max }: { values: number[]; width?: number; height?: number; color?: string; max?: number }) {
  if (values.length < 2) return <svg width={width} height={height} />
  const hi = max ?? Math.max(...values)
  const lo = max !== undefined ? 0 : Math.min(...values)
  const range = hi - lo || 1
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * width},${height - 1 - ((v - lo) / range) * (height - 2)}`).join(' ')
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export function SpecterMark({ size = 18 }: { size?: number }) {
  // Minimal spectral "S" glyph: two offset arcs, recognisable at 16px.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M17.5 6.2C16.2 4.8 14.3 4 12.1 4 8.6 4 6.2 5.9 6.2 8.5c0 5.6 11.6 3.3 11.6 9 0 2.6-2.5 4.5-6 4.5-2.5 0-4.6-1-5.9-2.6" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
      <path d="M19.6 3.4 21 2" stroke="var(--accent)" strokeWidth="2.1" strokeLinecap="round" />
      <path d="M3 22l1.4-1.4" stroke="var(--accent)" strokeWidth="2.1" strokeLinecap="round" opacity="0.55" />
    </svg>
  )
}
