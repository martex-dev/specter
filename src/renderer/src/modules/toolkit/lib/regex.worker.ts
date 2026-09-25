// Runs user regexes off the UI thread so catastrophic backtracking can be
// stopped (the page terminates this worker after a timeout).
import { runRegex, type RegexRequest } from './regexRun'

self.onmessage = (e: MessageEvent<RegexRequest>) => {
  ;(self as unknown as { postMessage(m: unknown): void }).postMessage(runRegex(e.data))
}
