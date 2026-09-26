// First-launch onboarding: short, skippable, six steps.
import { useEffect, useState } from 'react'
import { ArrowRight, Check, Cpu, Download, Palette, Search, Sparkles } from 'lucide-react'
import { SEARCH_ENGINES } from '@shared/settings'
import { invokeRaw } from '../lib/ipc'
import { ThemeGallery } from '../components/ThemeGallery'
import { loadUrl } from '../stores/browser'
import { setSetting, useSetting } from '../stores/settings'
import { SpecterMark, Switch } from '../components/ui'
import { ProfileImport } from '../components/ProfileImport'
import type { PageProps } from './registry'

const STEPS = ['Welcome', 'Appearance', 'Import', 'Local AI', 'Search', 'Done']

export default function Welcome({ tabId }: PageProps) {
  const [step, setStep] = useState(0)
  const finish = async () => {
    await setSetting('general.onboarded', true)
    loadUrl(tabId, 'specter://newtab')
  }
  const next = () => (step === STEPS.length - 1 ? finish() : setStep(step + 1))
  return (
    <div className="ntp" style={{ paddingTop: '8vh' }}>
      <div className="row" style={{ gap: 6, marginBottom: 28 }}>
        {STEPS.map((s, i) => (
          <div key={s} className="row" style={{ gap: 6 }}>
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                background: i < step ? 'var(--accent)' : i === step ? 'var(--accent-dim)' : 'var(--bg-3)',
                color: i < step ? 'var(--accent-fg)' : i === step ? 'var(--accent)' : 'var(--fg-3)',
                border: i === step ? '1px solid var(--accent-line)' : '1px solid transparent'
              }}
            >
              {i < step ? <Check size={12} /> : i + 1}
            </span>
            <span style={{ fontSize: 12, color: i === step ? 'var(--fg-0)' : 'var(--fg-3)' }}>{s}</span>
            {i < STEPS.length - 1 && <span style={{ width: 18, height: 1, background: 'var(--line-strong)' }} />}
          </div>
        ))}
      </div>
      <div className="card" style={{ width: 'min(720px, 100%)', padding: 32, minHeight: 360, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1 }}>
          {step === 0 && <StepWelcome />}
          {step === 1 && <StepAppearance />}
          {step === 2 && <StepImport />}
          {step === 3 && <StepAI />}
          {step === 4 && <StepSearch />}
          {step === 5 && <StepDone />}
        </div>
        <div className="row" style={{ marginTop: 24 }}>
          {step > 0 && step < STEPS.length - 1 && (
            <button className="btn ghost" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          <span className="spacer" />
          {step < STEPS.length - 1 && (
            <button className="btn ghost" onClick={finish}>
              Skip setup
            </button>
          )}
          <button className="btn primary lg" onClick={next} autoFocus>
            {step === 0 ? 'Get started' : step === STEPS.length - 1 ? 'Start browsing' : 'Continue'} <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

function StepWelcome() {
  return (
    <div className="col" style={{ gap: 14, alignItems: 'flex-start' }}>
      <SpecterMark size={40} />
      <div className="page-kicker" style={{ marginTop: 6 }}>
        The power browser
      </div>
      <h1 className="page-title" style={{ fontSize: 30 }}>
        Welcome to SPECTER
      </h1>
      <p className="muted" style={{ lineHeight: 1.6, maxWidth: 540, margin: 0 }}>
        A fast Chromium browser first — with workspaces, split views, a universal command palette, and optional local tools for research, development, markets and AI. Everything runs on this computer by default. Nothing here needs an account.
      </p>
      <div className="row" style={{ gap: 18, marginTop: 8, flexWrap: 'wrap' }}>
        {[
          ['Ctrl+K', 'Command palette'],
          ['Ctrl+Shift+W', 'Workspaces'],
          ['Ctrl+Shift+A', 'Search tabs'],
          ['Alt+Space', 'AI sidebar']
        ].map(([k, l]) => (
          <div key={k} className="col" style={{ gap: 4 }}>
            <span className="kbd">
              {k.split('+').map((p) => (
                <span key={p}>{p}</span>
              ))}
            </span>
            <span className="muted" style={{ fontSize: 11.5 }}>
              {l}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function StepAppearance() {
  const motion = useSetting('appearance.motion')
  return (
    <div className="col" style={{ gap: 14 }}>
      <h2 className="section-title" style={{ fontSize: 17 }}>
        <Palette size={17} /> Pick your look
      </h2>
      <p className="muted" style={{ margin: 0 }}>
        Each theme changes the whole interface — tabs, layout, type and effects. You can fine-tune colours later in Settings → Appearance.
      </p>
      <ThemeGallery compact />
      <div className="setting">
        <div className="st-text">
          <div className="st-title">Animations</div>
          <div className="st-desc">Reduce or turn off motion throughout SPECTER.</div>
        </div>
        <div className="seg">
          {(['full', 'reduced', 'off'] as const).map((m) => (
            <button key={m} className={motion === m ? 'on' : ''} onClick={() => setSetting('appearance.motion', m)}>
              {m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function StepImport() {
  return (
    <div className="col" style={{ gap: 14 }}>
      <h2 className="section-title" style={{ fontSize: 17 }}>
        <Download size={17} /> Bring over your browser?
      </h2>
      <p className="muted" style={{ margin: 0, lineHeight: 1.5 }}>
        Each Chrome profile can come over into a SPECTER profile of its own — bookmarks and history right away, then its passwords from Chrome’s export. You can do this later in Settings → Profiles.
      </p>
      <ProfileImport />
    </div>
  )
}

function StepAI() {
  const enabled = useSetting('ai.enabled')
  const [status, setStatus] = useState<{ running: boolean; models: string[]; error?: string } | null | 'n/a'>(null)
  useEffect(() => {
    invokeRaw<{ running: boolean; models: string[]; error?: string }>('ai:status')
      .then(setStatus)
      .catch(() => setStatus('n/a'))
  }, [])
  return (
    <div className="col" style={{ gap: 14 }}>
      <h2 className="section-title" style={{ fontSize: 17 }}>
        <Cpu size={17} /> Enable local AI?
      </h2>
      <p className="muted" style={{ margin: 0, lineHeight: 1.55 }}>
        SPECTER’s AI features run on your own machine through <b>Ollama</b> — your prompts and page content never leave this computer. AI is optional; the browser works fully without it.
      </p>
      <div className="card row" style={{ padding: 14 }}>
        <span className={'status-dot ' + (status && status !== 'n/a' && status.running ? 'ok' : 'hollow')} />
        <div className="grow">
          <div style={{ fontWeight: 500 }}>Local AI · Ollama</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {status === null
              ? 'Checking…'
              : status === 'n/a'
                ? 'AI module unavailable'
                : status.running
                  ? `Connected · ${status.models.length} model${status.models.length === 1 ? '' : 's'} installed${status.models[0] ? ` (${status.models.slice(0, 3).join(', ')})` : ''}`
                  : 'Offline — install Ollama from ollama.com and run it to enable local AI.'}
          </div>
        </div>
        <Switch on={enabled} onChange={(v) => setSetting('ai.enabled', v)} label="Enable AI features" />
      </div>
      {status && status !== 'n/a' && status.running && status.models.length === 0 && (
        <div className="muted" style={{ fontSize: 12 }}>
          Ollama is running but has no models. Run <code className="mono">ollama pull llama3.2</code> in a terminal, then reopen the AI sidebar.
        </div>
      )}
    </div>
  )
}

function StepSearch() {
  const engine = useSetting('search.engine')
  const remote = useSetting('search.remoteSuggestions')
  return (
    <div className="col" style={{ gap: 14 }}>
      <h2 className="section-title" style={{ fontSize: 17 }}>
        <Search size={17} /> Default search engine
      </h2>
      <div className="grid-4" style={{ gap: 8 }}>
        {SEARCH_ENGINES.map((e) => (
          <button key={e.id} className={'btn' + (engine === e.id ? ' primary' : '')} style={{ height: 40 }} onClick={() => setSetting('search.engine', e.id)}>
            {e.name}
          </button>
        ))}
      </div>
      <div className="setting">
        <div className="st-text">
          <div className="st-title">Search suggestions from your engine</div>
          <div className="st-desc">Sends what you type in the address bar to the search engine to show suggestions. Off by default — local history and bookmark suggestions always work.</div>
        </div>
        <Switch on={remote} onChange={(v) => setSetting('search.remoteSuggestions', v)} />
      </div>
    </div>
  )
}

function StepDone() {
  return (
    <div className="col" style={{ gap: 14, alignItems: 'flex-start' }}>
      <Sparkles size={34} className="accent" />
      <h1 className="page-title">You’re set.</h1>
      <p className="muted" style={{ margin: 0, lineHeight: 1.6, maxWidth: 540 }}>
        Just browse. When you want more, press <b>Ctrl+K</b> — every tool in SPECTER is one search away. Press <b>F1</b> any time for help.
      </p>
    </div>
  )
}
