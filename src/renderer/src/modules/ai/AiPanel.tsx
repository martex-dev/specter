// SPECTER AI side panel: status, model picker, explicit context selector,
// streaming transcript, quick actions, agents and conversation history.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  Code2,
  Globe,
  History,
  Layers,
  Link2,
  Lock,
  MessageSquarePlus,
  NotebookPen,
  PanelsTopLeft,
  Paperclip,
  Pencil,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  Square,
  TextSelect,
  Trash2,
  TriangleAlert,
  Users,
  X
} from 'lucide-react'
import type { AiAgentInfo, AiContextMeta, AiConversationSummary, AiStatus, AiSuggestion } from '@shared/modules/ai'
import { AI_QUICK_ACTIONS, parseSuggestions } from '@shared/modules/ai'
import { searchUrl } from '@shared/settings'
import { invoke } from '../../lib/ipc'
import { getCommand, runCommand, shortcutFor } from '../../lib/commands'
import { timeAgo } from '../../lib/format'
import { newTab, useBrowser } from '../../stores/browser'
import { getSetting, setSetting, useSetting } from '../../stores/settings'
import { openMenu, toast, useUi, type MenuItem } from '../../stores/ui'
import { confirmAction, promptText } from '../../components/prompt'
import { Markdown } from './Markdown'
import {
  actionPrompt,
  addStatusInterest,
  currentPageInfo,
  isPopoutWindow,
  loadConversation,
  newChat,
  otherTabs,
  refreshPreview,
  refreshStatus,
  runAgents,
  send,
  setCtx,
  stop,
  subscribeChunks,
  useAi,
  type UiMessage
} from './store'
import './ai.css'

// ---------------------------------------------------------------- helpers

function openUrl(url: string): void {
  if (!/^https?:\/\//i.test(url)) return
  if (isPopoutWindow || !useBrowser.getState().ready) void invoke('window:new', { url, focus: true })
  else newTab(url)
}

function copy(text: string, what = 'Copied'): void {
  invoke('app:clipboardWrite', text)
    .then(() => toast({ kind: 'ok', title: what }))
    .catch(() => toast({ kind: 'error', title: 'Copy failed' }))
}

function fmtChars(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(n >= 10_000 ? 0 : 1) + 'k' : String(n)
}

const KIND_ICON = { page: Globe, selection: TextSelect, tab: PanelsTopLeft, workspace: Layers, notes: FileText, agent: Bot } as const
const KIND_NAME = { page: 'Page', selection: 'Selection', tab: 'Tab', workspace: 'Workspace', notes: 'Notes', agent: 'Agent' } as const

// ---------------------------------------------------------------- panel

export default function AiPanel({ popout }: { popout?: boolean }) {
  const enabled = useSetting('ai.enabled')
  const view = useAi((s) => s.view)

  useEffect(() => {
    subscribeChunks()
  }, [])
  useEffect(() => (enabled ? addStatusInterest(15_000, true) : undefined), [enabled])

  // Remember the width the user drags the AI panel to.
  useEffect(() => {
    if (popout) return
    let t: ReturnType<typeof setTimeout> | undefined
    const unsub = useUi.subscribe((s, prev) => {
      if (s.sidePanel === 'ai' && prev.sidePanel === 'ai' && s.sidePanelWidth !== prev.sidePanelWidth) {
        clearTimeout(t)
        t = setTimeout(() => setSetting('ai.sidebarWidth', Math.round(s.sidePanelWidth)), 700)
      }
    })
    return () => {
      clearTimeout(t)
      unsub()
    }
  }, [popout])

  if (!enabled) {
    return (
      <div className="empty" style={{ height: '100%' }}>
        <Bot size={26} />
        <div>SPECTER AI is turned off.</div>
        <div className="dim" style={{ fontSize: 12, maxWidth: 260 }}>
          AI is optional and runs locally through Ollama. Nothing is sent anywhere while it is off.
        </div>
        <button className="btn sm" onClick={() => setSetting('ai.enabled', true)}>
          Enable local AI
        </button>
      </div>
    )
  }

  return (
    <div className="ai-panel">
      <Header />
      {view === 'history' ? <HistoryView /> : view === 'agents' ? <AgentsView /> : <Transcript />}
      {view === 'chat' && <Composer />}
    </div>
  )
}

// ---------------------------------------------------------------- header

function statusText(st: AiStatus | null, loading: boolean): { dot: string; text: string } {
  if (!st) return { dot: 'hollow', text: loading ? 'Checking…' : 'Status unknown' }
  if (!st.running) return { dot: 'hollow', text: st.reason === 'not-installed' ? 'Offline · Ollama not installed' : 'Offline' }
  if (!st.models.length) return { dot: 'warn', text: 'Connected · no models' }
  return { dot: 'ok', text: st.local ? 'Local AI · Connected' : 'Remote Ollama · Connected' }
}

function Header() {
  const st = useAi((s) => s.status)
  const loading = useAi((s) => s.statusLoading)
  const model = useAi((s) => s.model)
  const view = useAi((s) => s.view)
  const busy = useAi((s) => !!s.activeRequestId)
  const { dot, text } = statusText(st, loading)
  const chosen = model && st?.models.includes(model) ? model : (st?.model ?? '')
  return (
    <div className="ai-head">
      <span className={'status-dot ' + dot} />
      <span className="ai-head-status ellipsis" data-tip={st?.error ?? st?.url}>
        {text}
      </span>
      {st?.running && st.models.length > 0 && (
        <select
          className="select ai-model"
          value={chosen}
          disabled={busy}
          onChange={(e) => {
            useAi.setState({ model: e.target.value })
            void setSetting('ai.model', e.target.value)
          }}
          data-tip="Model"
          aria-label="Model"
        >
          {st.models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      )}
      <span className="spacer" />
      <button className={'icon-btn sm' + (view === 'agents' ? ' on' : '')} onClick={() => useAi.setState({ view: view === 'agents' ? 'chat' : 'agents' })} data-tip="Agents" aria-label="Agents">
        <Users size={13} />
      </button>
      <button className={'icon-btn sm' + (view === 'history' ? ' on' : '')} onClick={() => useAi.setState({ view: view === 'history' ? 'chat' : 'history' })} data-tip="Conversation history" aria-label="History">
        <History size={13} />
      </button>
      <button className="icon-btn sm" onClick={() => newChat()} data-tip="New chat" aria-label="New chat">
        <MessageSquarePlus size={13} />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------- offline / setup

function OfflineCard({ st }: { st: AiStatus | null }) {
  const [starting, setStarting] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const retry = () => {
    setMsg(null)
    void refreshStatus(true)
  }
  const pull = 'ollama pull llama3.2'
  let title = 'Local AI unavailable — install/start Ollama'
  let body: ReactNode = null
  if (!st) body = <span>Checking the local AI server…</span>
  else if (st.reason === 'not-installed') {
    title = 'Ollama is not installed'
    body = (
      <ol className="ai-steps">
        <li>
          Install Ollama (free, runs on this computer).{' '}
          <button className="btn sm" onClick={() => openUrl('https://ollama.com/download')}>
            <Link2 size={12} /> ollama.com/download
          </button>
        </li>
        <li>
          Download a model: <CodeCopy text={pull} />
        </li>
        <li>Come back here and press Retry.</li>
      </ol>
    )
  } else if (!st.running) {
    title = st.local ? 'Ollama is not running' : 'Can’t reach Ollama'
    body = (
      <>
        <div className="muted">{st.error ?? 'The server did not respond.'}</div>
        <div className="dim mono" style={{ fontSize: 11 }}>
          {st.url}
        </div>
        {st.local && st.installed ? (
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button
              className="btn sm primary"
              disabled={starting}
              onClick={async () => {
                setStarting(true)
                setMsg(null)
                try {
                  const r = await invoke('ai:startOllama')
                  setMsg(r.message)
                } catch (err) {
                  setMsg(String((err as Error)?.message ?? err))
                } finally {
                  setStarting(false)
                  void refreshStatus(true)
                }
              }}
            >
              <Play size={12} /> {starting ? 'Starting…' : 'Start Ollama'}
            </button>
            <span className="dim" style={{ fontSize: 11.5 }}>
              or run <span className="mono">ollama serve</span>
            </span>
          </div>
        ) : !st.local ? (
          <div className="muted" style={{ fontSize: 12 }}>
            Check the address in Settings → AI.
          </div>
        ) : null}
      </>
    )
  } else if (!st.models.length) {
    title = 'No chat model installed'
    body = (
      <>
        <div className="muted">Ollama is running{st.embeddingModels.length ? ` (embedding models only: ${st.embeddingModels.join(', ')})` : ''}. Download a chat model in a terminal:</div>
        <CodeCopy text={pull} />
      </>
    )
  }
  return (
    <div className="ai-offline card">
      <div className="row">
        <span className="status-dot hollow" />
        <b>{title}</b>
      </div>
      {body}
      {msg && <div className="muted" style={{ fontSize: 12 }}>{msg}</div>}
      <div className="row">
        <button className="btn sm" onClick={retry}>
          <RefreshCw size={12} /> Retry
        </button>
        <button className="btn sm ghost" onClick={() => openUrl('https://github.com/ollama/ollama/blob/main/README.md')} data-tip="Opens the Ollama README on GitHub in a new tab">
          About Ollama
        </button>
      </div>
      <div className="dim" style={{ fontSize: 11 }}>
        SPECTER works fully without AI. Prompts are only ever sent to the Ollama server configured in Settings → AI.
      </div>
    </div>
  )
}

function CodeCopy({ text }: { text: string }) {
  return (
    <span className="ai-codecopy">
      <code className="mono">{text}</code>
      <button className="icon-btn sm" onClick={() => copy(text, 'Command copied')} data-tip="Copy" aria-label="Copy command">
        <Copy size={12} />
      </button>
    </span>
  )
}

// ---------------------------------------------------------------- transcript

function Transcript() {
  const messages = useAi((s) => s.messages)
  const st = useAi((s) => s.status)
  const error = useAi((s) => s.error)
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useLayoutEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [messages])

  const onScroll = () => {
    const el = ref.current
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  }

  const onClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement
    const cp = t.closest('.ai-copy')
    if (cp) {
      const code = cp.parentElement?.querySelector('code')?.textContent ?? ''
      copy(code, 'Code copied')
      return
    }
    const a = t.closest('a')
    if (a) {
      e.preventDefault()
      const href = a.getAttribute('href') ?? ''
      if (/^https?:\/\//i.test(href)) openUrl(href)
    }
  }

  const ready = !!st?.running && st.models.length > 0
  return (
    <div className="ai-transcript" ref={ref} onScroll={onScroll} onClick={onClick}>
      {!ready && <OfflineCard st={st} />}
      {ready && messages.length === 0 && <Welcome />}
      {messages.map((m, i) => (m.role === 'user' ? <UserMessage key={m.id} m={m} /> : <AssistantMessage key={m.id} m={m} prev={messages[i - 1]} />))}
      {error && (
        <div className="ai-error">
          <TriangleAlert size={13} />
          <span className="grow selectable">{error}</span>
          <button className="icon-btn sm" onClick={() => useAi.setState({ error: null })} aria-label="Dismiss">
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  )
}

function Welcome() {
  const page = currentPageInfo()
  const kb = shortcutFor('ai.toggle')
  return (
    <div className="ai-welcome">
      <div className="ai-welcome-mark">
        <Sparkles size={18} />
      </div>
      <div className="ai-welcome-title">Ask about what you’re reading</div>
      <div className="muted" style={{ fontSize: 12 }}>
        Answers come from your local model and cite the context you attach below ([C1], [C2]…).
      </div>
      {page.readable && (
        <div className="ai-suggest-list">
          {AI_QUICK_ACTIONS.filter((a) => a.kind === 'page').map((a) => (
            <button
              key={a.id}
              className="ai-suggest"
              onClick={() => {
                setCtx({ page: true })
                void send(a.prompt, { action: a.id, ctx: { ...useAi.getState().ctx, page: true } })
              }}
            >
              <Sparkles size={12} /> {a.label}
            </button>
          ))}
        </div>
      )}
      {kb && (
        <div className="dim" style={{ fontSize: 11 }}>
          <span className="mono">{kb}</span> toggles this panel
        </div>
      )}
    </div>
  )
}

function ContextChips({ items }: { items: AiContextMeta[] }) {
  if (!items.length) return <div className="ai-ctx-used dim">No context attached</div>
  return (
    <div className="ai-ctx-used">
      {items.map((c) => {
        const Icon = KIND_ICON[c.kind]
        return (
          <span key={c.id} className="ai-chip static" data-tip={`${c.label}${c.url ? '\n' + c.url : ''}\n${c.chars.toLocaleString()} of ${c.originalChars.toLocaleString()} characters sent${c.note ? '\n' + c.note : ''}`}>
            <b>{c.id}</b>
            <Icon size={11} />
            <span className="ellipsis">{c.label}</span>
            <span className="dim">{fmtChars(c.chars)}</span>
            {c.truncated && <span className="warn">cut</span>}
          </span>
        )
      })}
    </div>
  )
}

function UserMessage({ m }: { m: UiMessage }) {
  return (
    <div className="ai-msg user">
      <div className="ai-msg-h">
        <span className="label">You</span>
        <span className="spacer" />
        <span className="dim">{timeAgo(m.createdAt)}</span>
      </div>
      <div className="ai-user-text selectable">{m.content}</div>
      <ContextChips items={m.context} />
    </div>
  )
}

function AssistantMessage({ m, prev }: { m: UiMessage; prev?: UiMessage }) {
  const perms = useSetting('ai.permissions')
  const streaming = m.status === 'streaming'
  const { body, suggestions } = useMemo(() => (streaming ? { body: m.content, suggestions: [] as AiSuggestion[] } : parseSuggestions(m.content)), [m.content, streaming])
  const cites = prev?.role === 'user' ? prev.context : []
  const canSaveNotes = !!getCommand('notes.savePage')
  const allowed = suggestions.filter((s) => (s.kind === 'note' ? perms.includes('write') : perms.includes('suggest')))
  return (
    <div className="ai-msg ai">
      <div className="ai-msg-h">
        <span className="label accent">SPECTER AI</span>
        {m.model && <span className="dim mono ellipsis">{m.model}</span>}
        <span className="spacer" />
        {streaming && m.stage && <span className="badge accent">{m.stage}</span>}
      </div>
      {body ? <Markdown text={body} cites={cites} streaming={streaming} /> : streaming ? <Thinking /> : null}
      {m.status === 'error' && (
        <div className="ai-error">
          <TriangleAlert size={13} />
          <span className="grow selectable">{m.error ?? 'The model failed to answer.'}</span>
          {prev?.role === 'user' && (
            <button className="btn sm" onClick={() => void send(prev.content)} disabled={!!useAi.getState().activeRequestId}>
              <RefreshCw size={12} /> Retry
            </button>
          )}
        </div>
      )}
      {m.status === 'stopped' && <div className="dim ai-note">Stopped{m.content ? ' — partial answer' : ''}</div>}
      {allowed.length > 0 && <Suggestions items={allowed} source={prev?.context.find((c) => c.url)} />}
      {!streaming && m.content && (
        <div className="ai-msg-actions">
          <button className="btn ghost sm" onClick={() => copy(m.content, 'Answer copied')}>
            <Copy size={12} /> Copy
          </button>
          {canSaveNotes && (
            <button
              className="btn ghost sm"
              onClick={() => {
                const src = prev?.context.find((c) => c.url)
                void runCommand('notes.savePage', { url: src?.url ?? '', title: useAi.getState().title || 'SPECTER AI answer', text: m.content })
              }}
            >
              <NotebookPen size={12} /> Save to notes
            </button>
          )}
          {m.stats?.evalTokens ? (
            <span className="dim mono ai-stats">
              {m.stats.evalTokens} tok{m.stats.durationMs ? ` · ${(m.stats.durationMs / 1000).toFixed(1)}s` : ''}
            </span>
          ) : null}
        </div>
      )}
    </div>
  )
}

function Thinking() {
  return (
    <div className="ai-thinking">
      <span />
      <span />
      <span />
    </div>
  )
}

function Suggestions({ items, source }: { items: AiSuggestion[]; source?: AiContextMeta }) {
  const run = async (s: AiSuggestion) => {
    if (s.kind === 'open') {
      if (await confirmAction('Open link suggested by AI?', s.value, 'Open in new tab')) openUrl(s.value)
    } else if (s.kind === 'search') {
      const url = searchUrl({ 'search.engine': getSetting('search.engine'), 'search.customTemplate': getSetting('search.customTemplate') }, s.value)
      if (await confirmAction('Search the web?', `“${s.value}” will be sent to your search engine.`, 'Search')) openUrl(url)
    } else if (s.kind === 'note') {
      if (!getCommand('notes.saveSelection')) return
      if (await confirmAction('Save this to your notes?', s.value, 'Save note')) void runCommand('notes.saveSelection', { text: s.value, url: source?.url ?? '', title: source?.label ?? 'SPECTER AI' })
    }
  }
  return (
    <div className="ai-suggestions">
      <div className="label">Suggested — you decide</div>
      {items.map((s, i) => {
        const disabled = s.kind === 'note' && !getCommand('notes.saveSelection')
        const Icon = s.kind === 'open' ? Link2 : s.kind === 'search' ? Search : NotebookPen
        return (
          <button key={i} className="ai-suggestion" disabled={disabled} onClick={() => void run(s)} data-tip={disabled ? 'Notes module unavailable' : 'Asks for confirmation first'}>
            <Icon size={12} />
            <span className="dim">{s.kind}</span>
            <span className="ellipsis">{s.value}</span>
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------- composer + context selector

function useAutoPreview(): void {
  const ctx = useAi((s) => s.ctx)
  const selection = useAi((s) => s.selection)
  const notes = useAi((s) => s.notes)
  const running = useAi((s) => !!s.status?.running)
  const tabKey = useBrowser((s) => {
    const ws = s.open[s.activeWsId]
    const t = ws?.tabs.find((x) => x.id === ws.activeTabId)
    return t ? `${t.id}|${t.url}|${t.loading ? 1 : 0}|${t.suspended ? 1 : 0}` : ''
  })
  useEffect(() => {
    if (!running) return
    const t = setTimeout(() => void refreshPreview(), 450)
    return () => clearTimeout(t)
  }, [ctx, selection, notes, running, tabKey])
}

function ContextSelector() {
  const ctx = useAi((s) => s.ctx)
  const selection = useAi((s) => s.selection)
  const notes = useAi((s) => s.notes)
  const preview = useAi((s) => s.preview)
  const previewLoading = useAi((s) => s.previewLoading)
  const st = useAi((s) => s.status)
  const [tabsOpen, setTabsOpen] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const [inspect, setInspect] = useState(false)
  useBrowser((s) => s.activeWsId + (s.open[s.activeWsId]?.activeTabId ?? '') + (s.open[s.activeWsId]?.tabs.length ?? 0))
  useAutoPreview()
  const page = currentPageInfo()
  const tabs = otherTabs()
  const inPopout = isPopoutWindow || !useBrowser.getState().ready
  const errors = (preview?.errors ?? []).filter((e) => !(e === 'No text is selected' && !selection))

  return (
    <div className="ai-context">
      <div className="ai-context-row">
        <span className="label">Context</span>
        <Chip on={ctx.page && page.readable} disabled={!page.readable} icon={Globe} label={page.readable ? (inPopout ? 'Current page' : 'Page') : 'Page'} detail={page.readable && !inPopout ? page.title : page.reason} onClick={() => setCtx({ page: !ctx.page })} tip={page.readable ? `Current page${page.url ? '\n' + page.url : ''}` : page.reason} />
        {selection ? (
          <Chip on={ctx.selection} icon={TextSelect} label="Selection" detail={`${fmtChars(selection.text.length)} chars`} onClick={() => setCtx({ selection: !ctx.selection })} onRemove={() => useAi.setState({ selection: null })} tip={selection.text.slice(0, 400)} />
        ) : (
          <Chip on={ctx.selection && page.readable} disabled={!page.readable} icon={TextSelect} label="Selected text" onClick={() => setCtx({ selection: !ctx.selection })} tip="Whatever is selected on the page when you send" />
        )}
        {!inPopout && (
          <Chip on={ctx.tabs.length > 0} icon={PanelsTopLeft} label={ctx.tabs.length ? `Tabs · ${ctx.tabs.length}` : 'Other tabs'} onClick={() => setTabsOpen(!tabsOpen)} caret={tabsOpen} disabled={!tabs.length} tip={tabs.length ? 'Choose other open tabs' : 'No other web tabs in this workspace'} />
        )}
        {!inPopout && <Chip on={ctx.workspace} icon={Layers} label="Workspace" onClick={() => setCtx({ workspace: !ctx.workspace })} tip="Names and addresses of this workspace’s tabs (no page content)" />}
        <Chip
          on={ctx.notes && !!notes.text.trim()}
          icon={FileText}
          label={notes.text.trim() ? `Notes · ${fmtChars(notes.text.length)}` : 'Notes'}
          onClick={() => {
            if (!notes.text.trim()) setNotesOpen(true)
            else if (notesOpen) setNotesOpen(false)
            else setCtx({ notes: !ctx.notes })
          }}
          caret={notesOpen}
          tip="Paste or attach notes"
        />
      </div>

      {tabsOpen && !inPopout && (
        <div className="ai-tabpick">
          {tabs.map((t) => {
            const on = ctx.tabs.includes(t.id)
            return (
              <button key={t.id} className={'ai-tabpick-row' + (on ? ' on' : '')} onClick={() => setCtx({ tabs: on ? ctx.tabs.filter((x) => x !== t.id) : [...ctx.tabs, t.id] })}>
                <span className="ai-check">{on && <Check size={11} />}</span>
                <span className="ellipsis grow">{t.title}</span>
                {t.sleeping && (
                  <span className="dim" data-tip="Sleeping tabs contribute only their title and address">
                    sleeping
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {notesOpen && <NotesEditor onDone={() => setNotesOpen(false)} />}

      <div className="ai-privacy">
        {st && !st.local ? (
          <span className="warn row" style={{ gap: 5 }}>
            <TriangleAlert size={11} /> Your context will leave this computer ({hostOf(st.url)})
          </span>
        ) : (
          <span className="row" style={{ gap: 5 }}>
            <Lock size={11} /> Your prompt is processed locally.
          </span>
        )}
        <span className="spacer" />
        <button className="ai-inspect" onClick={() => setInspect(!inspect)} data-tip="See exactly what will be sent">
          {preview && preview.items.length ? `${preview.items.length} item${preview.items.length > 1 ? 's' : ''} · ≈${fmtChars(preview.approxTokens)} tok` : previewLoading ? 'Reading…' : 'Nothing attached'}
          {inspect ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>
      </div>
      {inspect && (
        <div className="ai-inspector">
          <div className="row">
            <span className="dim" style={{ fontSize: 11 }}>
              Exactly this text is sent with your next message{preview?.budgetChars ? ` (budget ${fmtChars(preview.budgetChars)} chars)` : ''}.
            </span>
            <span className="spacer" />
            <button className="icon-btn sm" onClick={() => void refreshPreview()} data-tip="Re-read" aria-label="Refresh preview">
              <RefreshCw size={11} className={previewLoading ? 'spin' : ''} />
            </button>
          </div>
          {errors.map((e) => (
            <div key={e} className="warn" style={{ fontSize: 11 }}>
              {e}
            </div>
          ))}
          {(preview?.items ?? []).map((it) => (
            <details key={it.id} className="ai-inspect-item">
              <summary>
                <b className="mono">{it.id}</b> {KIND_NAME[it.kind]} · <span className="ellipsis">{it.label}</span>
                <span className="dim">
                  {' '}
                  {it.text.length.toLocaleString()} / {it.originalChars.toLocaleString()} chars{it.truncated ? ' · truncated' : ''}
                </span>
              </summary>
              <pre className="selectable">{it.text || it.note || '(empty)'}</pre>
            </details>
          ))}
        </div>
      )}
    </div>
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function Chip(p: { on: boolean; icon: typeof Globe; label: string; detail?: string; onClick: () => void; onRemove?: () => void; disabled?: boolean; caret?: boolean; tip?: string }) {
  const Icon = p.icon
  return (
    <span className={'ai-chip' + (p.on ? ' on' : '') + (p.disabled ? ' disabled' : '')} data-tip={p.tip}>
      <button className="ai-chip-main" onClick={p.onClick} disabled={p.disabled} aria-pressed={p.on}>
        <span className="ai-check">{p.on && <Check size={10} />}</span>
        <Icon size={11} />
        <span>{p.label}</span>
        {p.detail && <span className="ai-chip-detail ellipsis">{p.detail}</span>}
        {p.caret !== undefined && (p.caret ? <ChevronDown size={10} /> : <ChevronRight size={10} />)}
      </button>
      {p.onRemove && (
        <button className="ai-chip-x" onClick={p.onRemove} aria-label="Remove">
          <X size={10} />
        </button>
      )}
    </span>
  )
}

function NotesEditor({ onDone }: { onDone: () => void }) {
  const notes = useAi((s) => s.notes)
  const [text, setText] = useState(notes.text)
  const [label, setLabel] = useState(notes.label)
  const attach = async () => {
    try {
      const path = await invoke('app:pickFile', [{ name: 'Text', extensions: ['txt', 'md', 'markdown', 'csv', 'json', 'log', 'html', 'xml', 'yaml', 'yml', 'ts', 'js', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'cs'] }])
      if (!path) return
      const content = await invoke('app:readTextFile', path)
      setText(content.slice(0, 400_000))
      setLabel(path.split(/[\\/]/).pop() ?? 'Attached file')
    } catch (err) {
      toast({ kind: 'error', title: 'Could not read file', body: String((err as Error)?.message ?? err) })
    }
  }
  return (
    <div className="ai-notes">
      <textarea className="textarea" rows={4} value={text} placeholder="Paste notes, an excerpt or data to include…" onChange={(e) => setText(e.target.value)} />
      <div className="row">
        <button className="btn sm ghost" onClick={attach}>
          <Paperclip size={12} /> Attach text file
        </button>
        <span className="dim ellipsis grow" style={{ fontSize: 11 }}>
          {text ? `${label} · ${text.length.toLocaleString()} chars` : ''}
        </span>
        {text && (
          <button
            className="btn sm ghost"
            onClick={() => {
              setText('')
              useAi.setState({ notes: { text: '', label: 'Pasted notes' } })
              setCtx({ notes: false })
            }}
          >
            Clear
          </button>
        )}
        <button
          className="btn sm"
          onClick={() => {
            useAi.setState({ notes: { text, label: label || 'Pasted notes' } })
            setCtx({ notes: !!text.trim() })
            onDone()
          }}
        >
          {text.trim() ? 'Attach' : 'Close'}
        </button>
      </div>
    </div>
  )
}

function Composer() {
  const draft = useAi((s) => s.draft)
  const busy = useAi((s) => !!s.activeRequestId)
  const sending = useAi((s) => s.sending)
  const st = useAi((s) => s.status)
  const focusTick = useAi((s) => s.focusTick)
  const ta = useRef<HTMLTextAreaElement>(null)
  const ready = !!st?.running && st.models.length > 0

  useEffect(() => {
    if (focusTick) setTimeout(() => ta.current?.focus(), 30)
  }, [focusTick])
  useLayoutEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(180, Math.max(38, el.scrollHeight)) + 'px'
  }, [draft])

  const submit = () => {
    if (!ready || busy || sending) return
    void send(draft)
  }

  return (
    <div className="ai-composer">
      <ContextSelector />
      <div className="ai-input">
        <textarea
          ref={ta}
          className="ai-textarea"
          value={draft}
          placeholder={ready ? 'Ask about the attached context…' : 'Local AI is offline'}
          onChange={(e) => useAi.setState({ draft: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            } else if (e.key === 'Escape' && busy) {
              e.preventDefault()
              stop()
            }
          }}
          rows={1}
          spellCheck
        />
        <div className="ai-input-bar">
          <button className="btn ghost sm" onClick={(e) => showQuickActions(e.currentTarget)} disabled={!ready || busy} data-tip="Quick actions">
            <Sparkles size={12} /> Actions
          </button>
          <span className="spacer" />
          {draft.length > 0 && <span className="dim mono" style={{ fontSize: 10.5 }}>{draft.length}</span>}
          {busy ? (
            <button className="btn sm ai-send stop" onClick={() => stop()} data-tip="Stop (Esc)">
              <Square size={11} /> Stop
            </button>
          ) : (
            <button className="btn sm primary ai-send" onClick={submit} disabled={!ready || sending || !draft.trim()} data-tip={ready ? 'Send (Enter)' : 'Local AI is offline'}>
              <ArrowUp size={13} /> {sending ? 'Reading…' : 'Send'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

async function selectionFor(): Promise<{ text: string; url?: string; title?: string } | null> {
  const st = useAi.getState()
  if (st.selection?.text) return st.selection
  const page = currentPageInfo()
  if (page.wcId === null) return null
  const text = await invoke('guest:selection', page.wcId).catch(() => '')
  return text.trim() ? { text: text.trim(), url: page.url, title: page.title } : null
}

async function runTextAction(id: string): Promise<void> {
  const prompt = actionPrompt(id)
  if (!prompt) return
  const sel = await selectionFor()
  if (!sel) {
    toast({ kind: 'warn', title: 'Select some text first', body: 'Highlight text on the page, then choose the action again.' })
    return
  }
  const ctx = { page: false, selection: true, tabs: [], workspace: false, notes: false }
  useAi.setState({ selection: sel, ctx })
  await send(prompt, { action: id, ctx })
}

function showQuickActions(anchor: HTMLElement): void {
  const r = anchor.getBoundingClientRect()
  const page = currentPageInfo()
  const items: MenuItem[] = [{ header: 'This page' }]
  for (const a of AI_QUICK_ACTIONS.filter((x) => x.kind === 'page')) {
    items.push({
      label: a.label,
      icon: <Globe size={13} />,
      disabled: !page.readable,
      run: () => {
        const ctx = { ...useAi.getState().ctx, page: true }
        useAi.setState({ ctx })
        void send(a.prompt, { action: a.id, ctx })
      }
    })
  }
  items.push({ separator: true }, { header: 'Selected text' })
  for (const a of AI_QUICK_ACTIONS.filter((x) => x.kind === 'text')) items.push({ label: a.label, icon: <TextSelect size={13} />, run: () => void runTextAction(a.id) })
  items.push({ separator: true }, { header: 'Selected code' })
  for (const a of AI_QUICK_ACTIONS.filter((x) => x.kind === 'code')) items.push({ label: a.label, icon: <Code2 size={13} />, run: () => void runTextAction(a.id) })
  openMenu({ x: r.left, y: Math.max(8, r.top - Math.min(560, items.length * 27)), items, width: 210 })
}

// ---------------------------------------------------------------- agents

function AgentsView() {
  const [agents, setAgents] = useState<AiAgentInfo[] | null>(null)
  const [picked, setPicked] = useState<string[]>(['summarizer', 'source-auditor'])
  const [focus, setFocus] = useState('')
  const st = useAi((s) => s.status)
  const busy = useAi((s) => !!s.activeRequestId || s.sending)
  const error = useAi((s) => s.error)
  const ready = !!st?.running && st.models.length > 0
  useEffect(() => {
    invoke('ai:agents')
      .then(setAgents)
      .catch(() => setAgents([]))
  }, [])
  return (
    <div className="ai-agents">
      <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
        Run specialised agents one after another over the context below. Each agent sees the earlier agents’ output. Agents only read and write text — they never act on your behalf.
      </div>
      {!agents ? (
        <div className="dim">Loading…</div>
      ) : (
        <div className="ai-agent-list">
          {agents.map((a) => {
            const idx = picked.indexOf(a.id)
            return (
              <button key={a.id} className={'ai-agent' + (idx >= 0 ? ' on' : '')} onClick={() => setPicked(idx >= 0 ? picked.filter((x) => x !== a.id) : [...picked, a.id])}>
                <span className="ai-agent-n">{idx >= 0 ? idx + 1 : ''}</span>
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="ai-agent-name">{a.name}</span>
                  <span className="ai-agent-role dim">{a.role}</span>
                </span>
                <span className="badge">{a.output}</span>
              </button>
            )
          })}
        </div>
      )}
      <input className="input" value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="Optional focus, e.g. “pricing claims”" />
      <ContextSelector />
      {error && (
        <div className="ai-error">
          <TriangleAlert size={13} />
          <span className="grow">{error}</span>
        </div>
      )}
      <button className="btn primary" disabled={!ready || busy || !picked.length} onClick={() => void runAgents(picked, focus)} data-tip={ready ? undefined : 'Local AI is offline'}>
        <Play size={13} /> Run {picked.length ? picked.map((id) => agents?.find((a) => a.id === id)?.name ?? id).join(' → ') : 'pipeline'}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------- history

function HistoryView() {
  const [list, setList] = useState<AiConversationSummary[] | null>(null)
  const current = useAi((s) => s.conversationId)
  const load = () =>
    invoke('ai:conversations', 200)
      .then(setList)
      .catch(() => setList([]))
  useEffect(() => {
    void load()
  }, [])
  return (
    <div className="ai-history">
      <div className="ai-history-h">
        <span className="label">History</span>
        <span className="dim" style={{ fontSize: 11 }}>
          {list ? `${list.length} conversation${list.length === 1 ? '' : 's'} · stored on this computer` : ''}
        </span>
        <span className="spacer" />
        {!!list?.length && (
          <button
            className="btn ghost sm danger"
            onClick={async () => {
              if (!(await confirmAction('Delete all AI conversations?', 'This permanently removes every conversation in this profile.', 'Delete all', true))) return
              await invoke('ai:clearConversations')
              newChat()
              void load()
            }}
          >
            Clear all
          </button>
        )}
      </div>
      {list && list.length === 0 && (
        <div className="empty">
          <History size={22} />
          No conversations yet
        </div>
      )}
      {list?.map((c) => (
        <div key={c.id} className={'ai-history-row' + (c.id === current ? ' on' : '')} onClick={() => void loadConversation(c.id)} role="button">
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="ellipsis">{c.title}</div>
            <div className="dim" style={{ fontSize: 11 }}>
              {timeAgo(c.updatedAt)} · {c.messages} msg{c.model ? ` · ${c.model}` : ''}
            </div>
          </div>
          <button
            className="icon-btn sm"
            data-tip="Rename"
            aria-label="Rename"
            onClick={async (e) => {
              e.stopPropagation()
              const t = await promptText({ title: 'Rename conversation', initial: c.title, confirmLabel: 'Rename' })
              if (t?.trim()) {
                await invoke('ai:renameConversation', c.id, t)
                if (c.id === useAi.getState().conversationId) useAi.setState({ title: t.trim() })
                void load()
              }
            }}
          >
            <Pencil size={12} />
          </button>
          <button
            className="icon-btn sm"
            data-tip="Delete"
            aria-label="Delete"
            onClick={async (e) => {
              e.stopPropagation()
              if (!(await confirmAction('Delete this conversation?', c.title, 'Delete', true))) return
              await invoke('ai:deleteConversation', c.id)
              if (c.id === useAi.getState().conversationId) newChat()
              void load()
            }}
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
