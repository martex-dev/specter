// Dev harness: launches the built SPECTER with an isolated profile, runs a
// scripted sequence of steps and saves screenshots. Usage:
//   node scripts/drive.mjs <outDir> [profileDir] [steps.json]
import { _electron as electron } from 'playwright'
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const outDir = resolve(process.argv[2] ?? 'shots')
const profile = resolve(process.argv[3] ?? join(outDir, 'profile'))
const stepsFile = process.argv[4]
mkdirSync(outDir, { recursive: true })

const app = await electron.launch({
  args: [resolve('.')],
  env: { ...process.env, SPECTER_USER_DATA: profile, ELECTRON_ENABLE_LOGGING: '1' },
  timeout: 60000
})
app.process().stdout?.on('data', (d) => process.stdout.write('[main] ' + d))
app.process().stderr?.on('data', (d) => {
  const s = String(d)
  if (!/gpu|dxgi|Autofill|DevTools listening/i.test(s)) process.stdout.write('[main:err] ' + s)
})

const win = await app.firstWindow()
win.on('console', (m) => {
  if (['error', 'warning'].includes(m.type())) console.log(`[renderer:${m.type()}]`, m.text())
})
win.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message))
await win.setViewportSize?.({ width: 1440, height: 900 }).catch(() => {})
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0]
  w.setBounds({ x: 40, y: 40, width: 1480, height: 920 })
})
await win.waitForSelector('.app', { timeout: 30000 })
await win.waitForTimeout(1200)

const steps = stepsFile && existsSync(stepsFile) ? JSON.parse(readFileSync(stepsFile, 'utf8')) : [{ shot: '01-start' }]
let n = 0
for (const s of steps) {
  n++
  try {
    if (s.eval) console.log('[eval]', JSON.stringify(await win.evaluate(s.eval)))
    if (s.mainEval) console.log('[mainEval]', JSON.stringify(await app.evaluate(new Function('electron', `return (${s.mainEval})(electron)`))))
    if (s.click) await win.click(s.click, { timeout: 5000 })
    if (s.dblclick) await win.dblclick(s.dblclick, { timeout: 5000 })
    if (s.rightclick) await win.click(s.rightclick, { button: 'right', timeout: 5000 })
    if (s.hover) await win.hover(s.hover, { timeout: 5000 })
    if (s.type) await win.keyboard.type(s.type, { delay: 15 })
    if (s.press) await win.keyboard.press(s.press)
    if (s.fill) await win.fill(s.fill[0], s.fill[1])
    if (s.wait) await win.waitForTimeout(s.wait)
    if (s.waitFor) await win.waitForSelector(s.waitFor, { timeout: s.timeout ?? 15000 })
    if (s.shot) {
      await win.screenshot({ path: join(outDir, s.shot + '.png') })
      console.log('[shot]', s.shot)
    }
    if (s.nativeShot) {
      // Electron compositor capture (includes webview guest surfaces exactly as displayed).
      const b64 = await app.evaluate(async ({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.isVisible())
        const img = await w.webContents.capturePage()
        return img.toPNG().toString('base64')
      })
      writeFileSync(join(outDir, s.nativeShot + '.png'), Buffer.from(b64, 'base64'))
      console.log('[nativeShot]', s.nativeShot)
    }
    if (s.text) console.log('[text]', (await win.textContent(s.text))?.slice(0, 400))
  } catch (err) {
    console.log(`[step ${n} failed]`, JSON.stringify(s), err.message.split('\n')[0])
    await win.screenshot({ path: join(outDir, `fail-${n}.png`) }).catch(() => {})
  }
}
await app.close()
