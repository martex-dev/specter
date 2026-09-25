// Local alert engine: rules persisted in SQLite, evaluated in the main process
// on every incoming quote batch (stream or REST).
import type { AlertRule, Quote } from '@shared/modules/markets'
import { evaluateAlert } from '@shared/modules/markets'
import { broadcast } from '../../ipc'
import { bus } from '../../bus'
import { createLogger } from '../../logger'
import { notify } from '../../services/notifications'
import { setAlertWatch } from './hub'
import { listAlerts, recordAlertTrigger } from './store'

const log = createLogger('markets:alerts')
let rules: AlertRule[] = []

/** Reloads rules from the DB and updates the set of symbols the hub must keep checking. */
export function reloadAlerts(): void {
  try {
    rules = listAlerts()
  } catch (err) {
    log.error('failed to load alerts', err)
    rules = []
  }
  const symbols = rules.filter((r) => r.enabled).map((r) => r.symbol)
  setAlertWatch(symbols, evaluateQuotes)
}

export function evaluateQuotes(quotes: Quote[]): void {
  if (!rules.length) return
  const now = Date.now()
  let changed = false
  for (const q of quotes) {
    for (const rule of rules) {
      if (rule.symbol !== q.symbol || !rule.enabled) continue
      const r = evaluateAlert(rule, q, now)
      if (!r.fire || r.value === null || !r.message) continue
      const ev = recordAlertTrigger(rule, { alertId: rule.id, symbol: rule.symbol, message: r.message, value: r.value, price: q.price, source: q.source, ts: now })
      rule.lastTriggeredAt = now
      rule.triggerCount++
      if (!rule.repeat) rule.enabled = false
      changed = true
      log.info(`alert fired: ${r.message}`)
      notify({ category: 'market', title: `Alert: ${rule.symbol}`, body: r.message + (rule.note ? `\n${rule.note}` : '') })
      bus.emit('ALERT_TRIGGERED', { alertId: rule.id, message: r.message })
      broadcast('alerts:triggered', ev)
    }
  }
  if (changed) {
    broadcast('alerts:changed', undefined)
    reloadAlerts()
  }
}
