import { useMemo, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { HelpCircle, Search } from 'lucide-react'
import { fuzzyBest } from '@shared/fuzzy'
import { listCommands, runCommand, shortcutFor } from '../lib/commands'
import { Kbd } from '../components/ui'
import type { PageProps } from './registry'

interface Topic {
  id: string
  q: string
  keywords: string
  body: string
}

const TOPICS: Topic[] = [
  {
    id: 'palette',
    q: 'How do I find any feature quickly?',
    keywords: 'command palette search ctrl k run',
    body: 'Press **Ctrl+K** to open the command palette. Type part of any command, tab title or workspace name. Start with `>` to search commands only. Every feature in SPECTER is a command, so everything is reachable from here.'
  },
  {
    id: 'omnibox',
    q: 'What can I type in the address bar?',
    keywords: 'address bar omnibox url search scope @',
    body: 'The address bar understands URLs, searches and scopes:\n\n- `github.com` opens a site\n- `best pytorch tutorials` searches with your engine\n- `@tabs btc` searches open tabs\n- `@history github` searches history\n- `@bookmarks` searches bookmarks\n- `@ws trading` switches workspace\n- `@cmd screenshot` or `> screenshot` runs a command\n- `@ai …` / `? …` asks local AI (when enabled)\n\n**Alt+Enter** opens the result in a new tab. **Ctrl+Enter** turns `name` into `www.name.com`.'
  },
  {
    id: 'suspend',
    q: 'How do I suspend (sleep) a tab?',
    keywords: 'suspend sleep tab memory discard',
    body: 'Right-click a tab → **Sleep tab**, or run **Sleep all background tabs** from the palette. Tabs also sleep automatically after the time set in *Settings → Browser & tabs*. A sleeping tab releases its renderer process; it reloads with its scroll position when you click it. Open the **Tabs & memory** panel (moon icon on the rail) to see measured memory.'
  },
  {
    id: 'workspace',
    q: 'How do I create a workspace?',
    keywords: 'workspace create switch snapshot',
    body: 'Press **Ctrl+Shift+W** (or click the workspace pill left of the tabs) and choose **New**. Each workspace keeps its own tabs, groups and split layout. Right-click a tab → **Move to workspace** to move it. **Snapshot** saves a restorable copy; compare snapshots in *specter://workspaces*.'
  },
  {
    id: 'split',
    q: 'How do I use split screen?',
    keywords: 'split screen layout panes quadrant columns',
    body: 'Click the split button in the toolbar (or **Ctrl+Alt+S**) and pick a layout: 50/50, 33/67, 67/33, 25/75, stacked rows, three columns, quadrant or four panels. Drag the gaps between panes to resize; double-click a gap to reset. Right-click a tab → **Open in split view** to pair it with the current tab. Save layouts from the same menu.'
  },
  {
    id: 'ai',
    q: 'How do I enable local AI?',
    keywords: 'ai ollama local model enable',
    body: '1. Install **Ollama** from ollama.com.\n2. Pull a model, e.g. `ollama pull llama3.2`.\n3. Make sure Ollama is running (it listens on `127.0.0.1:11434`).\n4. Press **Alt+Space** to open the AI sidebar.\n\nSPECTER shows exactly which context (page, selection, tabs) is attached before sending, and everything is processed locally. AI is optional — the browser works fully without it.'
  },
  {
    id: 'import',
    q: 'How do I import bookmarks?',
    keywords: 'import bookmarks chrome edge firefox opera brave history migrate',
    body: 'Go to *Settings → Storage & import*. SPECTER detects Chrome, Edge, Brave, Vivaldi, Opera and Firefox profiles on this PC and imports bookmarks and history. You can also import any standard bookmarks HTML file from the Bookmarks page. Passwords are not imported.'
  },
  {
    id: 'focus',
    q: 'How do I hide everything except the page?',
    keywords: 'focus mode distraction free hide ui zen',
    body: '**Ctrl+Shift+F** toggles focus mode: tabs, bookmarks bar, rail, status bar and HUD are hidden. Press it again to restore. **F11** is full screen.'
  },
  {
    id: 'reader',
    q: 'How do I read articles without clutter?',
    keywords: 'reader mode article clean text speech',
    body: 'Press **Alt+R** or click the book icon in the address bar. Adjust font size, width, spacing, serif/sans and dark/light/sepia. The play button reads the article aloud using your system’s local voices.'
  },
  {
    id: 'find',
    q: 'Can I search pages with regular expressions?',
    keywords: 'find in page regex whole word case',
    body: '**Ctrl+F** opens find. Toggle **Aa** (match case), **W** (whole word) and **.\\*** (regular expression). Regex and whole-word search run locally inside the page and highlight every match.'
  },
  {
    id: 'devtools',
    q: 'How do I open developer tools?',
    keywords: 'devtools inspect developer f12 docked',
    body: '**F12** docks Chromium DevTools under the page (drag the edge to resize). *Page tools → Developer tools (window)* opens them detached. Right-click → **Inspect** jumps to an element.'
  },
  {
    id: 'privacy',
    q: 'What data does SPECTER send anywhere?',
    keywords: 'privacy data telemetry tracking upload',
    body: 'None by default. SPECTER has no analytics. History, bookmarks, notes and workspaces are stored in a local SQLite database. Optional network features (remote search suggestions, market data, translation links) are clearly labelled. See the **Privacy Center** (*specter://privacy*) for live state.'
  },
  {
    id: 'profiles',
    q: 'How do profiles work?',
    keywords: 'profile isolate cookies accounts',
    body: 'Each profile has isolated cookies, storage, cache, history, bookmarks and workspaces. Click the avatar in the toolbar to switch or create one. Switching reopens SPECTER’s windows under the other profile.'
  },
  {
    id: 'save',
    q: 'How do I save things for later?',
    keywords: 'save to specter capture note snippet research',
    body: '**Ctrl+Shift+S** opens *Save to SPECTER*: bookmark, workspace session bookmark, notes, research or knowledge base (when those tools are enabled). **Ctrl+Shift+C** captures the selected text. **Ctrl+Shift+N** opens a quick note.'
  }
]

export default function Help({ query }: PageProps) {
  const [q, setQ] = useState(query.get('q') ?? '')
  const topics = useMemo(() => {
    if (!q.trim()) return TOPICS
    return TOPICS.map((t) => ({ t, s: fuzzyBest(q, [t.q, t.keywords, t.body]) }))
      .filter((x) => x.s !== null)
      .sort((a, b) => b.s! - a.s!)
      .map((x) => x.t)
  }, [q])
  const cmds = useMemo(() => {
    const all = listCommands()
    return q.trim() ? all.filter((c) => fuzzyBest(q, [c.title, c.category, ...(c.keywords ?? [])]) !== null).slice(0, 12) : []
  }, [q])
  return (
    <div className="page">
      <div className="page-h">
        <div className="grow">
          <div className="page-kicker">Help</div>
          <h1 className="page-title">How can we help?</h1>
        </div>
      </div>
      <div className="row" style={{ position: 'relative', marginBottom: 18 }}>
        <Search size={16} style={{ position: 'absolute', left: 12, color: 'var(--fg-3)' }} />
        <input className="input grow" style={{ height: 42, paddingLeft: 36, fontSize: 14 }} placeholder="e.g. How do I suspend a tab?" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      {cmds.length > 0 && (
        <div className="card" style={{ padding: 8, marginBottom: 16 }}>
          <div className="label" style={{ padding: '4px 8px 6px' }}>
            Matching commands
          </div>
          {cmds.map((c) => (
            <div key={c.id} className="list-row" onClick={() => runCommand(c.id)}>
              {c.icon ? <c.icon size={14} /> : <HelpCircle size={14} />}
              <span className="grow">{c.title}</span>
              <span className="muted" style={{ fontSize: 11 }}>
                {c.category}
              </span>
              <Kbd keys={shortcutFor(c.id)} />
            </div>
          ))}
        </div>
      )}
      <div className="col" style={{ gap: 10 }}>
        {topics.map((t) => (
          <details key={t.id} className="card" style={{ padding: '12px 16px' }} open={!!q.trim() && topics.length <= 3}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{t.q}</summary>
            <div className="md" style={{ marginTop: 8 }} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(t.body, { async: false }) as string) }} />
          </details>
        ))}
        {topics.length === 0 && cmds.length === 0 && <div className="empty">No help topics match. Try the command palette (Ctrl+K).</div>}
      </div>
    </div>
  )
}
