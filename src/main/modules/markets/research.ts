// Crypto research: CoinGecko (coin overview) + DexScreener (DEX pairs) +
// GoPlus Security (contract checks, EVM chains, keyless). User-triggered only.
import type { CoinInfo, ResearchResult, ResearchSource, TokenSecurity } from '@shared/modules/markets'
import { computeRiskIndicators, looksLikeAddress } from '@shared/modules/markets'
import { fetchJson } from '../../services/net'
import { createLogger } from '../../logger'
import { CHAIN_TO_CG_PLATFORM, CG_PLATFORM_TO_CHAIN, GOPLUS_CHAIN, normalizeCoinGeckoCoin, normalizeDexPairs, normalizeGoPlus } from './normalize'
import { describeError, HOSTS } from './providers'
import { liquiditySnapshot, storeLiquiditySnapshot } from './store'

const log = createLogger('markets:research')
const COIN_QS = 'localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false'

async function coinById(id: string): Promise<CoinInfo> {
  const c = await fetchJson<any>(`${HOSTS.coingecko}/coins/${encodeURIComponent(id)}?${COIN_QS}`, { ttl: 120_000, timeoutMs: 12000 })
  return normalizeCoinGeckoCoin(c)
}

async function coinSearch(q: string): Promise<string | null> {
  const r = await fetchJson<{ coins: { id: string; symbol: string; name: string; market_cap_rank: number | null }[] }>(`${HOSTS.coingecko}/search?query=${encodeURIComponent(q)}`, { ttl: 3_600_000, timeoutMs: 10000 })
  const coins = r.coins ?? []
  const lower = q.toLowerCase()
  const byRank = (a: { market_cap_rank: number | null }, b: { market_cap_rank: number | null }) => (a.market_cap_rank ?? 1e9) - (b.market_cap_rank ?? 1e9)
  const exactId = coins.find((c) => c.id === lower)
  if (exactId) return exactId.id
  const sym = coins.filter((c) => c.symbol.toLowerCase() === lower).sort(byRank)
  if (sym.length) return sym[0].id
  const name = coins.filter((c) => c.name.toLowerCase() === lower).sort(byRank)
  if (name.length) return name[0].id
  return null
}

export async function research(rawQuery: string): Promise<ResearchResult> {
  const query = rawQuery.trim().replace(/^\$/, '')
  const now = Date.now()
  const sources: ResearchSource[] = []
  const result: ResearchResult = { query, kind: 'none', coin: null, token: null, pairs: [], security: null, liquiditySnapshot: null, risk: [], sources, fetchedAt: now }
  if (!query) return { ...result, error: 'Enter a symbol, CoinGecko id or contract address' }

  const src = (name: string, ok: boolean, detail?: string) => sources.push({ name, ok, fetchedAt: Date.now(), detail })
  let nativeAsset = false

  if (looksLikeAddress(query)) {
    // Contract address → DexScreener first, then CoinGecko by contract.
    try {
      const payload = await fetchJson<any>(`${HOSTS.dexscreener}/latest/dex/tokens/${encodeURIComponent(query)}`, { ttl: 60_000, timeoutMs: 12000 })
      const pairs = normalizeDexPairs(payload)
      // Prefer pairs where the token is the base asset (it can also appear as the quote side).
      const asBase = pairs.filter((p) => p.baseAddress.toLowerCase() === query.toLowerCase())
      result.pairs = asBase.length ? asBase : pairs
      src('DexScreener', true, `${result.pairs.length} pairs`)
    } catch (err) {
      src('DexScreener', false, describeError(err))
      result.pairsNote = `DexScreener unavailable: ${describeError(err)}`
    }
    const top = result.pairs.find((p) => p.baseAddress.toLowerCase() === query.toLowerCase()) ?? result.pairs[0]
    if (top) result.token = { chainId: top.chainId, address: top.baseAddress.toLowerCase() === query.toLowerCase() ? top.baseAddress : query, symbol: top.baseSymbol, name: top.baseName }
    const platform = top ? CHAIN_TO_CG_PLATFORM[top.chainId] : undefined
    if (platform) {
      try {
        const c = await fetchJson<any>(`${HOSTS.coingecko}/coins/${platform}/contract/${encodeURIComponent(query.toLowerCase())}`, { ttl: 120_000, timeoutMs: 12000 })
        result.coin = normalizeCoinGeckoCoin(c)
        src('CoinGecko', true)
      } catch (err) {
        src('CoinGecko', false, /404/.test(describeError(err)) ? 'Contract not listed on CoinGecko' : describeError(err))
      }
    }
    result.kind = result.token || result.coin ? 'token' : 'none'
  } else {
    // Symbol / name / id → CoinGecko, then DexScreener by contract (or by symbol).
    try {
      const id = await coinSearch(query)
      if (id) {
        result.coin = await coinById(id)
        src('CoinGecko', true)
      } else src('CoinGecko', true, `No exact match for “${query}”`)
    } catch (err) {
      src('CoinGecko', false, describeError(err))
    }
    const coin = result.coin
    if (coin) {
      result.kind = 'coin'
      const primary = coin.platforms.find((p) => CG_PLATFORM_TO_CHAIN[p.chain]) ?? null
      if (!coin.platforms.length) {
        nativeAsset = true
        result.pairsNote = 'Native asset (no token contract) — DEX pair data not applicable.'
      } else if (primary) {
        result.token = { chainId: CG_PLATFORM_TO_CHAIN[primary.chain], address: primary.address, symbol: coin.symbol, name: coin.name }
        try {
          const payload = await fetchJson<any>(`${HOSTS.dexscreener}/latest/dex/tokens/${encodeURIComponent(primary.address)}`, { ttl: 60_000, timeoutMs: 12000 })
          result.pairs = normalizeDexPairs(payload)
          src('DexScreener', true, `${result.pairs.length} pairs`)
        } catch (err) {
          src('DexScreener', false, describeError(err))
          result.pairsNote = `DexScreener unavailable: ${describeError(err)}`
        }
      } else result.pairsNote = `Token contracts are on chains DexScreener lookups here don't cover (${coin.platforms.map((p) => p.chain).join(', ')}).`
    } else {
      try {
        const payload = await fetchJson<any>(`${HOSTS.dexscreener}/latest/dex/search?q=${encodeURIComponent(query)}`, { ttl: 60_000, timeoutMs: 12000 })
        const up = query.toUpperCase()
        result.pairs = normalizeDexPairs(payload).filter((p) => p.baseSymbol.toUpperCase() === up)
        src('DexScreener', true, `${result.pairs.length} pairs matching symbol`)
        if (result.pairs.length) {
          const top = result.pairs[0]
          result.token = { chainId: top.chainId, address: top.baseAddress, symbol: top.baseSymbol, name: top.baseName }
          // Only keep pairs of the most liquid token with this ticker (tickers are not unique).
          result.pairs = result.pairs.filter((p) => p.baseAddress === top.baseAddress)
          result.pairsNote = 'Matched by ticker on DexScreener — tickers are not unique; verify the contract address.'
          result.kind = 'token'
        }
      } catch (err) {
        src('DexScreener', false, describeError(err))
      }
    }
  }

  // Contract checks (GoPlus, EVM chains only).
  let securityNote: string | undefined
  if (result.token) {
    const chain = GOPLUS_CHAIN[result.token.chainId]
    if (!chain) securityNote = `No free keyless contract-check source wired for chain “${result.token.chainId}”.`
    else {
      try {
        const payload = await fetchJson<any>(`${HOSTS.goplus}/api/v1/token_security/${chain}?contract_addresses=${encodeURIComponent(result.token.address.toLowerCase())}`, { ttl: 600_000, timeoutMs: 12000 })
        const sec: TokenSecurity | null = payload?.code === 1 ? normalizeGoPlus(payload, result.token.chainId, result.token.address, Date.now()) : null
        result.security = sec
        if (!sec) securityNote = payload?.message ? `GoPlus: ${String(payload.message).slice(0, 120)}` : 'GoPlus returned no data for this contract.'
        src('GoPlus Security', !!sec, sec ? undefined : securityNote)
      } catch (err) {
        securityNote = `GoPlus unavailable: ${describeError(err)}`
        src('GoPlus Security', false, describeError(err))
      }
    }
  } else securityNote = nativeAsset ? 'Native asset — no token contract to check.' : 'No contract identified.'
  result.securityNote = securityNote

  // Local liquidity snapshots enable a "liquidity change" indicator over time.
  const key = result.token ? `${result.token.chainId}:${result.token.address.toLowerCase()}` : null
  const totalLiq = result.pairs.reduce((s, p) => s + (p.liquidityUsd ?? 0), 0)
  if (key) {
    try {
      result.liquiditySnapshot = liquiditySnapshot(key, 3_600_000)
      if (totalLiq > 0) storeLiquiditySnapshot(key, totalLiq)
    } catch (err) {
      log.warn('liquidity snapshot failed', err)
    }
  }
  result.risk = computeRiskIndicators({ pairs: result.pairs, security: result.security, securityNote, previousLiquidity: result.liquiditySnapshot, now: Date.now(), nativeAsset })
  result.fetchedAt = Date.now()
  if (result.kind === 'none' && !result.pairs.length) result.error = sources.some((s) => !s.ok) ? 'Data unavailable — see sources below.' : `Nothing found for “${query}”.`
  return result
}

