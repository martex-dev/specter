// Renders resources/logo.svg to PNG sizes and a multi-resolution .ico using
// Electron's own Chromium (no image dependencies). Run: electron scripts/make-icons.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const svg = fs.readFileSync(path.join(root, 'resources', 'logo.svg'), 'utf8')

function ico(pngs) {
  // ICO container with embedded PNG images (supported since Windows Vista).
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  const dir = Buffer.alloc(16 * pngs.length)
  let offset = 6 + dir.length
  pngs.forEach(({ size, buf }, i) => {
    const o = i * 16
    dir.writeUInt8(size >= 256 ? 0 : size, o)
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1)
    dir.writeUInt8(0, o + 2)
    dir.writeUInt8(0, o + 3)
    dir.writeUInt16LE(1, o + 4)
    dir.writeUInt16LE(32, o + 6)
    dir.writeUInt32LE(buf.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += buf.length
  })
  return Buffer.concat([header, dir, ...pngs.map((p) => p.buf)])
}

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } })
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden">${svg}</body></html>`
  await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'))
  await new Promise((r) => setTimeout(r, 400))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 })
  const base = img.resize({ width: 512, height: 512, quality: 'best' })
  fs.writeFileSync(path.join(root, 'resources', 'icon.png'), base.toPNG())
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), base.toPNG())
  const sizes = [256, 128, 64, 48, 32, 24, 16]
  const pngs = sizes.map((size) => ({ size, buf: base.resize({ width: size, height: size, quality: 'best' }).toPNG() }))
  fs.writeFileSync(path.join(root, 'build', 'icon.ico'), ico(pngs))
  fs.writeFileSync(path.join(root, 'resources', 'icon.ico'), ico(pngs))
  console.log('icons written', base.getSize())
  app.quit()
})
