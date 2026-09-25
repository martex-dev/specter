import { useEffect, useMemo, useState } from 'react'
import { ArrowLeftRight, CheckCircle2, Pipette, XCircle } from 'lucide-react'
import { toast } from '../../../stores/ui'
import { contrastRatio, formatRatio, oklchToRgb, parseColor, rgbToHsv, rgbToOklch, toHex, toHslString, toOklchString, toRgbString, wcag, type RGBA } from '../lib/color'
import { eyeDropperSupported, pickScreenColor } from '../eyedropper'
import type { ToolProps } from '../tools'
import { CopyBtn, Pane, useToolState } from '../ui'

let canvasCtx: CanvasRenderingContext2D | null = null
/** Parses any CSS color, falling back to the browser for named colors. */
function resolveColor(input: string): RGBA | null {
  const direct = parseColor(input)
  if (direct) return direct
  const s = input.trim()
  if (!/^[a-z]+$/i.test(s)) return null
  canvasCtx ??= document.createElement('canvas').getContext('2d')
  if (!canvasCtx) return null
  canvasCtx.fillStyle = '#010203'
  canvasCtx.fillStyle = s
  const out = String(canvasCtx.fillStyle)
  if (out === '#010203' && s.toLowerCase() !== '#010203') return null
  return parseColor(out)
}

const css = (c: RGBA) => toRgbString(c)

function oklchParts(v: string): { l: number; c: number; h: number } | null {
  const m = /^\s*oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/i.exec(v)
  if (!m) return null
  const l = m[2] ? Number(m[1]) / 100 : Number(m[1])
  return { l, c: Number(m[3]), h: Number(m[4]) }
}

function ColorField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const c = resolveColor(value)
  const picker = eyeDropperSupported()
  return (
    <div className="row" style={{ gap: 6 }}>
      <input type="color" className="tk-color-input" value={c ? toHex({ ...c, a: 1 }) : '#000000'} onChange={(e) => onChange(e.target.value)} aria-label={`${label} color picker`} />
      <input className={'input mono grow' + (c ? '' : ' bad')} value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} aria-label={label} style={c ? undefined : { borderColor: 'var(--bad)' }} />
      <button
        className="icon-btn"
        disabled={!picker}
        data-tip={picker ? 'Pick a color from anywhere on screen' : 'EyeDropper API not available'}
        aria-label="Eyedropper"
        onClick={async () => {
          try {
            const hex = await pickScreenColor()
            if (hex) onChange(hex)
          } catch (err) {
            toast({ kind: 'error', title: 'Eyedropper failed', body: err instanceof Error ? err.message : String(err) })
          }
        }}
      >
        <Pipette size={15} />
      </button>
    </div>
  )
}

function Level({ ok, label, need }: { ok: boolean; label: string; need: string }) {
  return (
    <div className="row" style={{ gap: 6, fontSize: 12.5 }}>
      {ok ? <CheckCircle2 size={14} className="ok" /> : <XCircle size={14} className="bad" />}
      <span style={{ width: 150 }}>{label}</span>
      <span className="mono dim">≥ {need}</span>
    </div>
  )
}

/** Finds the nearest OKLCH lightness for `fg` that reaches `target` against `bg`. */
function suggestFix(fg: RGBA, bg: RGBA, target: number): RGBA | null {
  const base = rgbToOklch(fg)
  let best: RGBA | null = null
  let bestDist = Infinity
  for (let step = 1; step <= 100; step++) {
    for (const dir of [-1, 1]) {
      const l = base.l + (dir * step) / 100
      if (l < 0 || l > 1) continue
      const { rgb } = oklchToRgb({ ...base, l })
      const c = { ...rgb, a: 1 }
      if (contrastRatio(c, bg) >= target && step < bestDist) {
        best = c
        bestDist = step
      }
    }
    if (best) break
  }
  return best
}

export default function ColorTool({ query }: ToolProps) {
  const [value, setValue] = useToolState('color.value', '#a3b1ff')
  const [fg, setFg] = useToolState('color.fg', '#e9ebf0')
  const [bg, setBg] = useToolState('color.bg', '#14161b')
  const [lastGood, setLastGood] = useState<RGBA>(() => parseColor('#a3b1ff')!)

  useEffect(() => {
    const q = query.get('c') || query.get('color')
    if (q) setValue(q)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const parsed = resolveColor(value)
  useEffect(() => {
    if (parsed) setLastGood(parsed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  const c = parsed ?? lastGood
  // Keep slider positions exact (and out-of-gamut values intact) when the input is oklch().
  const ok = oklchParts(value) ?? rgbToOklch(c)
  const hsv = rgbToHsv(c)

  const formats: [string, string][] = [
    ['HEX', toHex(c, false)],
    ...(c.a < 1 ? ([['HEX + alpha', toHex(c, true)]] as [string, string][]) : []),
    ['RGB', toRgbString(c)],
    ['HSL', toHslString(c)],
    ['HSV', `hsv(${Math.round(hsv.h)} ${Math.round(hsv.s)}% ${Math.round(hsv.v)}%)`],
    ['OKLCH', toOklchString(c)],
    ['Legacy rgba()', `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${Math.round(c.a * 1000) / 1000})`]
  ]

  const setOk = (patch: Partial<{ l: number; c: number; h: number }>) => {
    const n = { ...ok, ...patch }
    setValue(`oklch(${(n.l * 100).toFixed(2)}% ${n.c.toFixed(4)} ${n.h.toFixed(2)}${c.a < 1 ? ` / ${c.a}` : ''})`)
  }
  const gamut = oklchToRgb(ok).inGamut

  const ramp = useMemo(() => [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95].map((l) => ({ ...oklchToRgb({ l, c: ok.c, h: ok.h }).rgb, a: 1 })), [ok.c, ok.h])

  const F = resolveColor(fg)
  const B = resolveColor(bg)
  const w = F && B ? wcag(F, B) : null
  const fix = F && B && w && !w.aaNormal ? suggestFix(F, B, 4.5) : null

  return (
    <div className="tk-body">
      <div className="tk-split" style={{ flex: 'none', alignItems: 'start' }}>
        <Pane label="Color">
          <div className="col" style={{ padding: 12, gap: 10 }}>
            <ColorField value={value} onChange={setValue} label="Color" />
            {!parsed && <div className="bad" style={{ fontSize: 12 }}>Unrecognised color — showing the last valid one.</div>}
            <div className="tk-swatch">
              <div style={{ background: css(c) }} />
            </div>
            <div className="col" style={{ gap: 6 }}>
              {(
                [
                  ['L', ok.l, 0, 1, 0.001, (v: number) => setOk({ l: v }), `${(ok.l * 100).toFixed(1)}%`],
                  ['C', ok.c, 0, 0.37, 0.001, (v: number) => setOk({ c: v }), ok.c.toFixed(3)],
                  ['H', ok.h, 0, 360, 0.5, (v: number) => setOk({ h: v }), `${ok.h.toFixed(1)}°`]
                ] as const
              ).map(([k, v, min, max, step, on, label]) => (
                <label key={k} className="row" style={{ gap: 8, fontSize: 12 }}>
                  <span className="mono dim" style={{ width: 14 }}>
                    {k}
                  </span>
                  <input type="range" className="grow" min={min} max={max} step={step} value={v} onChange={(e) => on(Number(e.target.value))} aria-label={`OKLCH ${k}`} />
                  <span className="mono" style={{ width: 58, textAlign: 'right' }}>
                    {label}
                  </span>
                </label>
              ))}
              {!gamut && <div className="warn" style={{ fontSize: 11.5 }}>Outside the sRGB gamut — clipped for display.</div>}
            </div>
            <div className="label">Lightness ramp (OKLCH)</div>
            <div className="tk-ramp">
              {ramp.map((r, i) => (
                <button key={i} style={{ background: css(r) }} onClick={() => setValue(toHex(r))} data-tip={toHex(r)} aria-label={`Use ${toHex(r)}`} />
              ))}
            </div>
          </div>
        </Pane>
        <Pane label="Formats">
          <div className="tk-kv">
            {formats.map(([k, v]) => (
              <div key={k} className="tk-kv-row">
                <span className="tk-kv-k" style={{ width: 100 }}>
                  {k}
                </span>
                <span className="tk-kv-v mono">{v}</span>
                <CopyBtn text={v} />
              </div>
            ))}
          </div>
          <div className="row" style={{ padding: 10, gap: 6 }}>
            <button className="btn sm" onClick={() => setFg(toHex(c))}>
              Use as foreground
            </button>
            <button className="btn sm" onClick={() => setBg(toHex(c))}>
              Use as background
            </button>
          </div>
        </Pane>
      </div>

      <Pane label="Contrast checker (WCAG 2.x)" style={{ flex: 'none' }}>
        <div className="tk-split" style={{ padding: 12, alignItems: 'start' }}>
          <div className="col" style={{ gap: 10 }}>
            <div className="label">Foreground (text)</div>
            <ColorField value={fg} onChange={setFg} label="Foreground" />
            <div className="row">
              <div className="label grow">Background</div>
              <button
                className="btn sm ghost"
                onClick={() => {
                  setFg(bg)
                  setBg(fg)
                }}
              >
                <ArrowLeftRight size={12} /> Swap
              </button>
            </div>
            <ColorField value={bg} onChange={setBg} label="Background" />
            {F && B && (
              <div className="tk-contrast-sample" style={{ background: css(B), color: css(F) }}>
                <div className="big">Large text 24px</div>
                <div style={{ fontSize: 14, marginTop: 6 }}>Normal body text at 14px — the quick brown fox jumps over the lazy dog.</div>
                <div style={{ marginTop: 10, display: 'inline-block', border: `2px solid ${css(F)}`, borderRadius: 6, padding: '4px 10px', fontSize: 12 }}>UI component</div>
              </div>
            )}
          </div>
          <div className="col" style={{ gap: 8 }}>
            {w ? (
              <>
                <div className="mono" style={{ fontSize: 40, fontWeight: 600, letterSpacing: '-0.02em' }}>
                  {formatRatio(w.ratio)}
                </div>
                <Level ok={w.aaNormal} label="AA · normal text" need="4.5:1" />
                <Level ok={w.aaLarge} label="AA · large text" need="3:1" />
                <Level ok={w.aaaNormal} label="AAA · normal text" need="7:1" />
                <Level ok={w.aaaLarge} label="AAA · large text" need="4.5:1" />
                <Level ok={w.uiComponents} label="UI components (1.4.11)" need="3:1" />
                {fix && (
                  <div className="row" style={{ marginTop: 6, fontSize: 12 }}>
                    <span className="dim">Closest AA foreground:</span>
                    <span style={{ width: 14, height: 14, borderRadius: 3, background: css(fix), border: '1px solid var(--line-strong)' }} />
                    <span className="mono">{toHex(fix)}</span>
                    <span className="mono dim">{formatRatio(contrastRatio(fix, B!))}</span>
                    <button className="btn sm" onClick={() => setFg(toHex(fix))}>
                      Apply
                    </button>
                  </div>
                )}
                <div className="tk-note">Large text = 24px regular or 18.66px bold. Transparent foregrounds are composited over the background.</div>
              </>
            ) : (
              <div className="empty">Enter two valid colors.</div>
            )}
          </div>
        </div>
      </Pane>
    </div>
  )
}
