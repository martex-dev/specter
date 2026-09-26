// specter://crypto[/QUERY] — token research (CoinGecko + DexScreener + GoPlus)
// with risk *research indicators*. Never a safety verdict.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, HelpCircle, MinusCircle, Search, ShieldQuestion } from 'lucide-react'
import type { ResearchResult, RiskStatus } from '@shared/modules/markets'
import { CHAIN_EXPLORERS, humanAge } from '@shared/modules/markets'
import type { PageProps } from '../../pages/registry'
import { invoke } from '../../lib/ipc'
import { newTab } from '../../stores/browser'
import { useSetting } from '../../stores/settings'
import { toast } from '../../stores/ui'
import { compact, DisabledNotice, PageHeader, Pct, px, qty, stampFull } from './ui'

export default function CryptoPage(props: PageProps) {
  const enabled = useSetting('markets.enabled')
  if (!enabled) return <DisabledNotice title="Crypto research" />
  return <Crypto {...props} />
}

const STATUS_ICON: Record<RiskStatus, JSX.Element> = {
  CHECKED: <CheckCircle2 size={14} />,
  WARNING: <AlertTriangle size={14} />,
  UNKNOWN: <HelpCircle size={14} />,
  'DATA UNAVAILABLE': <MinusCircle size={14} />
}
const STATUS_CLASS: Record<RiskStatus, string> = { CHECKED: 'ok', WARNING: 'warn', UNKNOWN: '', 'DATA UNAVAILABLE': '' }

const recentKey = 'mk:research-recent'
function recent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(recentKey) || '[]').slice(0, 8)
  } catch {
    return []
  }
}

/** A malformed %-escape in the URL must not crash the page. */
function decodeSub(sub: string | undefined): string {
  try {
    return decodeURIComponent(sub || '')
  } catch {
    return sub || ''
  }
}

function Crypto({ sub }: PageProps) {
  const [input, setInput] = useState(() => decodeSub(sub))
  const [res, setRes] = useState<ResearchResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<string[]>(recent)
  const seq = useRef(0)

  const run = async (q: string) => {
    const query = q.trim()
    if (!query) return
    // Only the latest search may show its result (an older, slower one must not overwrite it).
    const my = ++seq.current
    setBusy(true)
    try {
      const r = await invoke('crypto:research', query)
      if (my !== seq.current) return
      setRes(r)
      const next = [query, ...history.filter((h) => h.toLowerCase() !== query.toLowerCase())].slice(0, 8)
      setHistory(next)
      try {
        localStorage.setItem(recentKey, JSON.stringify(next))
      } catch {
        /* ignore */
      }
    } catch (e: any) {
      if (my === seq.current) toast({ kind: 'error', title: 'Research failed', body: String(e?.message ?? e) })
    } finally {
      if (my === seq.current) setBusy(false)
    }
  }

  useEffect(() => {
    if (!sub) return
    const q = decodeSub(sub)
    setInput(q)
    run(q)
  }, [sub])

  const coin = res?.coin
  const token = res?.token
  const explorer = token ? CHAIN_EXPLORERS[token.chainId] : undefined
  const pairs = res?.pairs ?? []
  const totalLiq = pairs.reduce((s, p) => s + (p.liquidityUsd ?? 0), 0)
  const totalVol = pairs.reduce((s, p) => s + (p.volume24h ?? 0), 0)
  const oldest = pairs.map((p) => p.pairCreatedAt).filter((x): x is number => !!x)
  const firstPair = oldest.length ? Math.min(...oldest) : null

  return (
    <div className="page wide mk-page">
      <PageHeader kicker="Crypto · Research" title="Token research" sub="Look up a coin by symbol, CoinGecko id or contract address. Requests go to CoinGecko, DexScreener and GoPlus Security only when you search." />
      <form
        className="mk-search"
        onSubmit={(e) => {
          e.preventDefault()
          run(input)
        }}
      >
        <Search size={15} className="muted" />
        <input className="mono" value={input} onChange={(e) => setInput(e.target.value)} placeholder="BTC · ethereum · 0x6982508145454Ce325dDbE47a25d4ec3d2311933" autoFocus spellCheck={false} />
        <button className="btn primary sm" disabled={busy || !input.trim()} type="submit">
          {busy ? 'Researching…' : 'Research'}
        </button>
      </form>
      {history.length > 0 && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '8px 0 0' }}>
          <span className="label">Recent</span>
          {history.map((h) => (
            <button
              key={h}
              className="btn sm ghost mono"
              onClick={() => {
                setInput(h)
                run(h)
              }}
            >
              {h.length > 16 ? h.slice(0, 6) + '…' + h.slice(-4) : h}
            </button>
          ))}
        </div>
      )}

      <div className="mk-disclaimer">
        <ShieldQuestion size={14} />
        <span>
          <b>Research, not advice.</b> These indicators summarize public data and simple rules. They cannot prove an asset is safe — “CHECKED” only means the rule shown found nothing to flag. Always verify contracts yourself.
        </span>
      </div>

      {res?.error && !coin && !pairs.length && (
        <div className="card mk-card">
          <div className="empty">{res.error}</div>
        </div>
      )}

      {res && (coin || token || pairs.length > 0) && (
        <>
          <div className="mk-split">
            <div className="card mk-card grow">
              <div className="card-h">
                {coin?.image && <img src={coin.image} width={20} height={20} alt="" style={{ borderRadius: 4 }} />}
                <span className="section-title" style={{ margin: 0 }}>
                  {coin?.name ?? token?.name ?? res.query}
                </span>
                <span className="mono dim">{coin?.symbol ?? token?.symbol}</span>
                {coin?.rank && <span className="badge">Rank #{coin.rank}</span>}
                <span className="spacer" />
                <span className="mono dim" style={{ fontSize: 11 }} data-tip={stampFull(res.fetchedAt)}>
                  fetched {new Date(res.fetchedAt).toLocaleTimeString()}
                </span>
              </div>
              <div className="card-b mk-kvgrid">
                <KV label="Price (USD)" value={coin?.price !== null && coin?.price !== undefined ? px(coin.price) : pairs[0]?.priceUsd !== null && pairs[0] ? px(pairs[0].priceUsd) : '—'} src={coin?.price != null ? 'CoinGecko' : pairs[0] ? 'DexScreener (top pair)' : undefined} />
                <KV label="24h change" value={<Pct v={coin?.change24hPct ?? pairs[0]?.priceChange24h ?? null} />} />
                <KV label="Market cap" value={coin?.marketCap ? '$' + compact(coin.marketCap) : pairs[0]?.marketCap ? '$' + compact(pairs[0].marketCap) : '—'} src={coin?.marketCap ? 'CoinGecko' : pairs[0]?.marketCap ? 'DexScreener' : undefined} />
                <KV label="FDV" value={coin?.fdv ? '$' + compact(coin.fdv) : pairs[0]?.fdv ? '$' + compact(pairs[0].fdv) : '—'} />
                <KV label="Volume 24h" value={coin?.volume24h ? '$' + compact(coin.volume24h) : totalVol ? '$' + compact(totalVol) : '—'} src={coin?.volume24h ? 'CoinGecko (all venues)' : totalVol ? 'DexScreener (DEX only)' : undefined} />
                <KV label="DEX liquidity" value={pairs.length ? '$' + compact(totalLiq) : '—'} src={pairs.length ? `DexScreener · ${pairs.length} pairs` : res.pairsNote} />
                <KV label="Circulating" value={coin?.circulating ? qty(coin.circulating) : '—'} />
                <KV label="Max supply" value={coin?.maxSupply ? qty(coin.maxSupply) : coin ? '∞ / not reported' : '—'} />
                <KV label="First DEX pair" value={firstPair ? `${new Date(firstPair).toISOString().slice(0, 10)} (${humanAge(Date.now() - firstPair)})` : '—'} />
                <KV label="Genesis" value={coin?.genesisDate ?? '—'} src={coin?.genesisDate ? 'CoinGecko' : undefined} />
              </div>
              {token && (
                <div className="mk-contract">
                  <span className="label">Contract · {token.chainId}</span>
                  <code className="mono selectable">{token.address}</code>
                  <button
                    className="icon-btn sm"
                    data-tip="Copy address"
                    aria-label="Copy address"
                    onClick={() => {
                      invoke('app:clipboardWrite', token.address)
                      toast({ kind: 'ok', title: 'Address copied' })
                    }}
                  >
                    <Copy size={12} />
                  </button>
                  {explorer && (
                    <button className="btn sm ghost" onClick={() => newTab(explorer.token + token.address)}>
                      <ExternalLink size={12} /> {explorer.name}
                    </button>
                  )}
                  <button className="btn sm ghost" onClick={() => newTab(`https://dexscreener.com/${token.chainId}/${token.address}`)}>
                    <ExternalLink size={12} /> DexScreener
                  </button>
                </div>
              )}
              {coin && (coin.platforms.length > 1 || coin.categories.length > 0 || coin.homepage) && (
                <div className="mk-contract" style={{ flexWrap: 'wrap' }}>
                  {coin.platforms.length > 1 && <span className="label">Also on: {coin.platforms.filter((p) => p.address !== token?.address).map((p) => p.chain).join(', ')}</span>}
                  {coin.categories.slice(0, 5).map((c) => (
                    <span key={c} className="badge">
                      {c}
                    </span>
                  ))}
                  <span className="spacer" />
                  {coin.homepage && (
                    <button className="btn sm ghost" onClick={() => newTab(coin.homepage!)}>
                      <ExternalLink size={12} /> Website
                    </button>
                  )}
                  <button className="btn sm ghost" onClick={() => newTab(`https://www.coingecko.com/en/coins/${coin.id}`)}>
                    <ExternalLink size={12} /> CoinGecko
                  </button>
                  {!token &&
                    coin.explorers.slice(0, 2).map((u) => (
                      <button key={u} className="btn sm ghost" onClick={() => newTab(u)}>
                        <ExternalLink size={12} /> {safeHost(u)}
                      </button>
                    ))}
                </div>
              )}
            </div>

            <div className="card mk-card mk-risk">
              <div className="card-h">
                <span className="section-title" style={{ margin: 0 }}>
                  Risk research indicators
                </span>
              </div>
              <div className="mk-risk-list">
                {res.risk.map((r) => (
                  <div key={r.id} className="mk-risk-row">
                    <span className={'mk-risk-status ' + STATUS_CLASS[r.status]}>
                      {STATUS_ICON[r.status]} {r.status}
                    </span>
                    <div className="grow">
                      <div className="mk-risk-label">{r.label}</div>
                      <div className="mk-risk-detail">{r.detail}</div>
                      {r.source && <div className="mono dim mk-risk-src">{r.source}</div>}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mk-cardfoot mono">Not a safety rating. Absence of warnings ≠ safe.</div>
            </div>
          </div>

          <div className="card mk-card">
            <div className="card-h">
              <span className="section-title" style={{ margin: 0 }}>
                DEX pairs
              </span>
              <span className="dim mono" style={{ fontSize: 11 }}>
                DexScreener · by liquidity
              </span>
            </div>
            {pairs.length === 0 ? (
              <div className="empty" style={{ padding: 24 }}>
                {res.pairsNote ?? 'No DEX pairs found.'}
              </div>
            ) : (
              <>
                {res.pairsNote && <div className="mk-note warn" style={{ margin: '10px 12px 0' }}>{res.pairsNote}</div>}
                <div className="mk-table-wrap" style={{ maxHeight: 420 }}>
                  <table className="table mk-table">
                    <thead>
                      <tr>
                        <th>Pair</th>
                        <th>Chain · DEX</th>
                        <th className="r">Price (USD)</th>
                        <th className="r">24h %</th>
                        <th className="r">Liquidity</th>
                        <th className="r">Volume 24h</th>
                        <th className="r">Txns 24h</th>
                        <th className="r">Age</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {pairs.map((p) => (
                        <tr key={p.chainId + p.pairAddress}>
                          <td className="mono">
                            <b>{p.baseSymbol}</b>/{p.quoteSymbol} {p.labels.map((l) => <span key={l} className="badge">{l}</span>)}
                          </td>
                          <td className="mono dim">
                            {p.chainId} · {p.dexId}
                          </td>
                          <td className="r num">{px(p.priceUsd)}</td>
                          <td className="r num">
                            <Pct v={p.priceChange24h} />
                          </td>
                          <td className={'r num ' + (p.liquidityUsd !== null && p.liquidityUsd < 50_000 ? 'warn' : '')}>{p.liquidityUsd !== null ? '$' + compact(p.liquidityUsd) : '—'}</td>
                          <td className="r num">{p.volume24h !== null ? '$' + compact(p.volume24h) : '—'}</td>
                          <td className="r num mono">{p.buys24h !== null ? `${p.buys24h}↑ ${p.sells24h ?? 0}↓` : '—'}</td>
                          <td className="r mono dim">{p.pairCreatedAt ? humanAge(Date.now() - p.pairCreatedAt) : '—'}</td>
                          <td className="r">
                            {p.url && (
                              <button className="icon-btn sm" onClick={() => newTab(p.url)} data-tip="Open on DexScreener" aria-label="Open on DexScreener">
                                <ExternalLink size={12} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          {res.security && (
            <div className="card mk-card">
              <div className="card-h">
                <span className="section-title" style={{ margin: 0 }}>
                  Contract checks
                </span>
                <span className="dim mono" style={{ fontSize: 11 }} data-tip={stampFull(res.security.fetchedAt)}>
                  GoPlus Security (free, keyless) · {new Date(res.security.fetchedAt).toLocaleTimeString()}
                </span>
              </div>
              <div className="card-b mk-kvgrid">
                <KV label="Source verified" value={flag(res.security.isOpenSource)} />
                <KV label="Proxy (upgradeable)" value={flag(res.security.isProxy)} />
                <KV label="Mintable" value={flag(res.security.isMintable)} />
                <KV label="Honeypot flag" value={flag(res.security.isHoneypot)} />
                <KV label="Buy / sell tax" value={`${res.security.buyTaxPct !== null ? res.security.buyTaxPct.toFixed(1) + '%' : '?'} / ${res.security.sellTaxPct !== null ? res.security.sellTaxPct.toFixed(1) + '%' : '?'}`} />
                <KV label="Holders" value={res.security.holderCount !== null ? res.security.holderCount.toLocaleString() : '—'} />
                <KV label="Top-10 share" value={res.security.top10Pct !== null ? res.security.top10Pct.toFixed(1) + '%' : '—'} src="excl. burn & locked" />
                <KV label="Owner" value={!res.security.ownerAddress ? 'none reported' : /^0x0+$/.test(res.security.ownerAddress) ? 'zero address (renounced)' : res.security.ownerAddress.slice(0, 8) + '…' + res.security.ownerAddress.slice(-6)} />
              </div>
            </div>
          )}

          <div className="mk-sources mono">
            <span className="label">Sources</span>
            {res.sources.map((s) => (
              <span key={s.name} className={s.ok ? '' : 'warn'} data-tip={stampFull(s.fetchedAt)}>
                {s.ok ? '●' : '○'} {s.name}
                {s.detail ? ` — ${s.detail}` : ''} · {new Date(s.fetchedAt).toLocaleTimeString()}
              </span>
            ))}
            {res.liquiditySnapshot && <span>Local liquidity snapshot from {stampFull(res.liquiditySnapshot.ts)}</span>}
          </div>
        </>
      )}
    </div>
  )
}

function KV({ label, value, src }: { label: string; value: ReactNode; src?: string }) {
  return (
    <div className="mk-kvcell">
      <span className="label">{label}</span>
      <span className="num">{value}</span>
      {src && <span className="mono dim mk-kvsrc">{src}</span>}
    </div>
  )
}

function flag(v: boolean | null): ReactNode {
  if (v === null) return <span className="dim">not reported</span>
  return v ? 'Yes' : 'No'
}

function safeHost(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return 'Explorer'
  }
}
