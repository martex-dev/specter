// Worker thread: compiles filter lists into a serialized Ghostery engine.
// Parsing ~150k rules takes about half a second, which would freeze every
// window if it ran on the main process.
import { parentPort, workerData } from 'node:worker_threads'
import { FiltersEngine } from '@ghostery/adblocker'

function compile({ filters, resources }: { filters: string; resources: string | null }): void {
  try {
    const engine = FiltersEngine.parse(filters, { loadCSPFilters: true, loadCosmeticFilters: true, loadNetworkFilters: true, enableMutationObserver: true })
    if (resources) engine.updateResources(resources, String(resources.length))
    const bytes = engine.serialize()
    parentPort?.postMessage({ ok: true, bytes }, [bytes.buffer as ArrayBuffer])
  } catch (err) {
    parentPort?.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}

// Only runs as a worker (unit tests import the module graph without starting one).
if (parentPort && workerData) compile(workerData)
