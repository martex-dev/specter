import { describe, expect, it } from 'vitest'
import {
  counterDelta,
  cpuUsage,
  effectiveInterval,
  normalizeHost,
  parseCsvLine,
  parseNetstatE,
  parseNvidiaSmiCsv,
  parseTasklistCsv,
  parseTypeperfHeader,
  parseTypeperfRow,
  rateFromCounters,
  sumInterfaces
} from '../../src/main/modules/system/parsers'

describe('nvidia-smi CSV', () => {
  it('parses a real RTX line and converts MiB to bytes', () => {
    const g = parseNvidiaSmiCsv('0, NVIDIA GeForce RTX 5070, 7, 4140, 12227, 34, 13.78, 250.00, 0, 682\r\n')
    expect(g).toHaveLength(1)
    expect(g[0]).toEqual({
      index: 0,
      name: 'NVIDIA GeForce RTX 5070',
      util: 7,
      memUsed: 4140 * 1048576,
      memTotal: 12227 * 1048576,
      temp: 34,
      power: 13.78,
      powerLimit: 250,
      fan: 0,
      clockMHz: 682
    })
  })

  it('maps [N/A] / [Not Supported] to null instead of inventing values', () => {
    const g = parseNvidiaSmiCsv('0, Tesla T4, 0, 10, 15360, [N/A], [Not Supported], 70.00, [N/A], 300\n')
    expect(g[0].temp).toBeNull()
    expect(g[0].power).toBeNull()
    expect(g[0].fan).toBeNull()
    expect(g[0].powerLimit).toBe(70)
  })

  it('handles several GPUs, blank lines and names with commas', () => {
    const text = '0, NVIDIA RTX A6000, 50, 1000, 49140, 60, 120.5, 300.00, 30, 1800\n\n1, Weird, Name GPU, 1, 2, 3, 4, 5.5, 6, 7, 8\n'
    const g = parseNvidiaSmiCsv(text)
    expect(g.map((x) => x.index)).toEqual([0, 1])
    expect(g[1].name).toBe('Weird, Name GPU')
    expect(g[1].util).toBe(1)
    expect(g[1].clockMHz).toBe(8)
  })

  it('ignores error output', () => {
    expect(parseNvidiaSmiCsv('NVIDIA-SMI has failed because it could not communicate with the NVIDIA driver.')).toEqual([])
    expect(parseNvidiaSmiCsv('')).toEqual([])
  })
})

describe('netstat -e', () => {
  const sample = `Interface Statistics

                           Received            Sent

Bytes                     103883008      3534332062
Unicast packets            36525504        11861670
Non-unicast packets          158826           50334
Discards                          0               0
Errors                            0               0
Unknown protocols                 0
`
  it('reads the byte counters', () => {
    expect(parseNetstatE(sample)).toEqual({ rx: 103883008, tx: 3534332062 })
  })

  it('works with localised labels (first two-number row is bytes)', () => {
    const de = sample.replace('Interface Statistics', 'Schnittstellenstatistik').replace('Received', 'Empfangen').replace('Sent', 'Gesendet')
    expect(parseNetstatE(de)).toEqual({ rx: 103883008, tx: 3534332062 })
  })

  it('returns null for garbage', () => {
    expect(parseNetstatE('The system cannot find the path specified.')).toBeNull()
  })

  it('handles 32-bit counter wraparound', () => {
    expect(counterDelta(4294967000, 200)).toBe(496)
    expect(counterDelta(100, 300)).toBe(200)
    // A 64-bit counter going backwards is a reset, not a wrap.
    expect(counterDelta(2 ** 40, 5)).toBeNull()
  })

  it('computes bytes/s from two readings', () => {
    expect(rateFromCounters({ rx: 1000, tx: 0, t: 0 }, { rx: 5000, tx: 2000, t: 2000 })).toEqual({ rxBps: 2000, txBps: 1000 })
    expect(rateFromCounters({ rx: 1, tx: 1, t: 5 }, { rx: 2, tx: 2, t: 5 })).toBeNull()
  })
})

describe('tasklist CSV', () => {
  const text = [
    '"System Idle Process","0","Services","0","8 K"',
    '"System","4","Services","0","16,724 K"',
    '"electron.exe","1234","Console","1","183.412 K"',
    '"Some, App.exe","99","Console","1","1 024 K"',
    '',
    'INFO: garbage line'
  ].join('\r\n')

  it('parses rows, locale-formatted memory and quoted commas', () => {
    const rows = parseTasklistCsv(text, new Set([1234]))
    expect(rows).toHaveLength(4)
    expect(rows[1]).toEqual({ name: 'System', pid: 4, session: 'Services', memKB: 16724, specter: false })
    expect(rows[2].memKB).toBe(183412)
    expect(rows[2].specter).toBe(true)
    expect(rows[3].name).toBe('Some, App.exe')
    expect(rows[3].memKB).toBe(1024)
  })

  it('csv line parser handles escaped quotes', () => {
    expect(parseCsvLine('"a ""b""",c,"d,e"')).toEqual(['a "b"', 'c', 'd,e'])
  })
})

describe('CPU delta math', () => {
  const t = (user: number, sys: number, idle: number) => ({ user, nice: 0, sys, idle, irq: 0 })

  it('computes per-core and total utilisation', () => {
    const prev = [t(100, 100, 800), t(0, 0, 1000)]
    const cur = [t(150, 150, 900), t(0, 0, 1200)] // core0: 100 busy / 200; core1: 0 / 200
    const u = cpuUsage(prev, cur)!
    expect(u.perCore).toEqual([50, 0])
    expect(u.total).toBe(25)
  })

  it('counts irq time as busy', () => {
    const u = cpuUsage([{ user: 0, nice: 0, sys: 0, idle: 0, irq: 0 }], [{ user: 0, nice: 0, sys: 0, idle: 75, irq: 25 }])!
    expect(u.total).toBe(25)
  })

  it('is null when nothing elapsed or the core count changed', () => {
    expect(cpuUsage([t(1, 1, 1)], [t(1, 1, 1)])).toBeNull()
    expect(cpuUsage([t(1, 1, 1)], [t(2, 2, 2), t(1, 1, 1)])).toBeNull()
    expect(cpuUsage([], [])).toBeNull()
  })

  it('refuses to report a core whose counters went backwards', () => {
    expect(cpuUsage([t(0, 0, 100)], [t(500, 0, 50)])).toBeNull()
    const u = cpuUsage([t(0, 0, 100), t(0, 0, 0)], [t(500, 0, 50), t(100, 0, 100)])!
    expect(u.perCore).toEqual([0, 50])
    expect(u.total).toBe(50)
  })
})

describe('typeperf', () => {
  const header =
    '"(PDH-CSV 4.0)","\\\\PC\\Network Interface(Realtek Gaming 2.5GbE Family Controller)\\Bytes Received/sec","\\\\PC\\Network Interface(Intel[R] Wi-Fi 6E AX211 160MHz)\\Bytes Received/sec","\\\\PC\\Network Interface(Realtek Gaming 2.5GbE Family Controller)\\Bytes Sent/sec","\\\\PC\\Network Interface(Intel[R] Wi-Fi 6E AX211 160MHz)\\Bytes Sent/sec"'

  it('parses header and rows into per-interface rates', () => {
    const cols = parseTypeperfHeader(header)!
    expect(cols.map((c) => c.role)).toEqual(['rx', 'rx', 'tx', 'tx'])
    const row = parseTypeperfRow('"09/25/2026 21:59:02.946","0.000000","26142.883264","0.000000","642.033235"', cols)!
    expect(row.ts).toBe('09/25/2026 21:59:02.946')
    const wifi = row.interfaces.find((i) => i.name.startsWith('Intel'))!
    expect(wifi.rxBps).toBe(26143)
    expect(wifi.txBps).toBe(642)
    expect(sumInterfaces(row.interfaces)).toEqual({ rxBps: 26143, txBps: 642 })
  })

  it('rejects incomplete rows and non-header lines', () => {
    const cols = parseTypeperfHeader(header)!
    expect(parseTypeperfRow('"09/25/2026 21:59:02.946","0.000000"', cols)).toBeNull()
    expect(parseTypeperfRow('"x"," ","1","2","3"', cols)).toBeNull()
    expect(parseTypeperfHeader('Error: No valid counters.')).toBeNull()
  })

  it('reads % Processor Utility (total + per core, clamped) alongside the network counters', () => {
    const h =
      '"(PDH-CSV 4.0)","\\\\PC\\Network Interface(NIC)\\Bytes Received/sec","\\\\PC\\Network Interface(NIC)\\Bytes Sent/sec",' +
      '"\\\\PC\\Processor Information(0,0)\\% Processor Utility","\\\\PC\\Processor Information(0,1)\\% Processor Utility","\\\\PC\\Processor Information(0,10)\\% Processor Utility","\\\\PC\\Processor Information(0,_Total)\\% Processor Utility","\\\\PC\\Processor Information(_Total)\\% Processor Utility"'
    const cols = parseTypeperfHeader(h)!
    expect(cols.map((c) => c.role)).toEqual(['rx', 'tx', 'util', 'util', 'util', 'util', 'util'])
    const row = parseTypeperfRow('"t","10","20","35.5","120.2","5","40","41.25"', cols)!
    expect(row.util).toEqual({ total: 41.3, perCore: [35.5, 100, 5] })
    expect(sumInterfaces(row.interfaces)).toEqual({ rxBps: 10, txBps: 20 })
  })

  it('assigns roles by position when counter names are localised', () => {
    const h =
      '"(PDH-CSV 4.0)","\\\\PC\\Netzwerkschnittstelle(NIC)\\Empfangene Bytes/s","\\\\PC\\Netzwerkschnittstelle(NIC)\\Gesendete Bytes/s","\\\\PC\\Prozessorinformationen(_Total)\\Prozessorauslastung (%)"'
    expect(parseTypeperfHeader(h)!.map((c) => c.role)).toEqual(['rx', 'tx', 'util'])
  })

  it('excludes virtual adapters from totals', () => {
    const h = '"(PDH-CSV 4.0)","\\\\PC\\Network Interface(Intel NIC)\\Bytes Received/sec","\\\\PC\\Network Interface(Hyper-V Virtual Ethernet Adapter)\\Bytes Received/sec","\\\\PC\\Network Interface(Intel NIC)\\Bytes Sent/sec","\\\\PC\\Network Interface(Hyper-V Virtual Ethernet Adapter)\\Bytes Sent/sec"'
    const row = parseTypeperfRow('"t","100","100","10","10"', parseTypeperfHeader(h)!)!
    expect(sumInterfaces(row.interfaces)).toEqual({ rxBps: 100, txBps: 10 })
  })
})

describe('poll interval policy', () => {
  const focused = { visible: 1, focused: 1 }
  it('uses the configured interval normally', () => {
    expect(effectiveInterval(2000, 'normal', focused)).toEqual({ ms: 2000, reason: 'normal' })
    expect(effectiveInterval(2000, 'ml', focused)).toEqual({ ms: 2000, reason: 'normal' })
  })
  it('slows down in gaming / battery', () => {
    expect(effectiveInterval(2000, 'gaming', focused)).toEqual({ ms: 5000, reason: 'mode' })
    expect(effectiveInterval(4000, 'battery', focused)).toEqual({ ms: 10000, reason: 'mode' })
  })
  it('slows down when unfocused or hidden', () => {
    expect(effectiveInterval(1000, 'normal', { visible: 1, focused: 0 })).toEqual({ ms: 4000, reason: 'unfocused' })
    expect(effectiveInterval(2000, 'normal', { visible: 0, focused: 0 })).toEqual({ ms: 10000, reason: 'hidden' })
    expect(effectiveInterval(2000, 'battery', { visible: 0, focused: 0 }).ms).toBe(10000)
  })
  it('clamps silly values', () => {
    expect(effectiveInterval(10, 'normal', focused).ms).toBe(500)
    expect(effectiveInterval(NaN, 'normal', focused).ms).toBe(2000)
  })
})

describe('network diagnostics host input', () => {
  it('normalises hosts and URLs', () => {
    expect(normalizeHost('Example.COM')).toBe('example.com')
    expect(normalizeHost('https://github.com/foo/bar')).toBe('github.com')
    expect(normalizeHost('1.1.1.1')).toBe('1.1.1.1')
    expect(normalizeHost('[2606:4700:4700::1111]')).toBe('2606:4700:4700::1111')
  })
  it('rejects junk', () => {
    expect(() => normalizeHost('')).toThrow()
    expect(() => normalizeHost('foo bar')).toThrow()
    expect(() => normalizeHost('a;rm -rf')).toThrow()
  })
})
