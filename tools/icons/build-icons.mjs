// Generator ikon aplikacji. Źródłem są wektory zapisane poniżej (autorskie, bez
// zewnętrznych zasobów, bez skryptów w SVG). Uruchomienie:
//   node tools/icons/build-icons.mjs [A|B|C]      (wymaga pakietu `playwright`)
// Bez argumentu bierze wariant domyślny (DEFAULT). Zapisuje:
//   web/public/{icon.svg,icon-maskable.svg,icon-192.png,icon-512.png,icon-maskable-512.png,
//               apple-touch-icon.png,favicon.svg,favicon-32.png}
//   mobile/android/app/src/main/res/mipmap-*/ic_launcher*.png
//   tools/icons/variants/*.svg, tools/icons/preview/*.png
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BLUE = '#1f6feb'
const BLUE_DARK = '#1857bd'
const AMBER = '#ffc83d'
const DEFAULT = 'A'

// Elementy rysowane w układzie 512x512, mieszczą się w kole o promieniu ~190 od środka
// (strefa bezpieczna ikon maskable to koło o promieniu 40% szerokości, czyli ~205).
const VARIANTS = {
  // A: trasa z punktem startu i pinezką celu
  A: {
    name: 'Trasa i pinezka',
    fg: `
  <path d="M168 352C250 352 300 340 300 270" fill="none" stroke="#fff" stroke-width="26" stroke-linecap="round"/>
  <circle cx="160" cy="352" r="34" fill="${AMBER}"/>
  <path d="M300 288C300 288 232 226 232 172a68 68 0 0 1 136 0c0 54-68 116-68 116z" fill="#fff"/>
  <circle cx="300" cy="172" r="26" fill="${BLUE}"/>`,
  },
  // B: trasa prowadząca do ceny (moneta z symbolem waluty narysowanym liniami)
  B: {
    name: 'Trasa i cena',
    fg: `
  <path d="M150 350H214a64 64 0 0 0 64-64V236" fill="none" stroke="#fff" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="150" cy="350" r="34" fill="${AMBER}"/>
  <circle cx="304" cy="190" r="84" fill="#fff"/>
  <path d="M338 160a46 46 0 1 0 0 60" fill="none" stroke="${BLUE}" stroke-width="20" stroke-linecap="round"/>
  <path d="M260 184h58M260 208h58" fill="none" stroke="${BLUE}" stroke-width="14" stroke-linecap="round"/>`,
  },
  // C: czoło pociągu na szynach
  C: {
    name: 'Pociąg',
    fg: `
  <rect x="166" y="128" width="180" height="228" rx="56" fill="#fff"/>
  <rect x="192" y="162" width="128" height="88" rx="22" fill="${BLUE}"/>
  <rect x="166" y="274" width="180" height="16" fill="${AMBER}"/>
  <circle cx="210" cy="322" r="17" fill="${BLUE}"/>
  <circle cx="302" cy="322" r="17" fill="${BLUE}"/>
  <path d="M196 388L176 420M316 388l20 32M150 404H362" fill="none" stroke="#fff" stroke-width="18" stroke-linecap="round"/>`,
  },
}

const NS = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"'
const gradDefs = `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${BLUE}"/><stop offset="1" stop-color="${BLUE_DARK}"/></linearGradient></defs>`
const bg = (rx) => `<rect width="512" height="512" rx="${rx}" fill="url(#g)"/>`
const svgAny = (v) => `<svg ${NS}>${gradDefs}${bg(112)}${v.fg}\n</svg>\n`
const svgMaskable = (v) => `<svg ${NS}>${gradDefs}${bg(0)}${v.fg}\n</svg>\n`
// Ikona adaptacyjna Androida: tło kolorem z zasobów, pierwszy plan w ~72% skali.
const svgFore = (v) => `<svg ${NS}><g transform="translate(256 256) scale(.78) translate(-256 -256)">${v.fg}</g>\n</svg>\n`
// Favicon: bez gradientu, grubsze, mały rozmiar.
const svgFavicon = (v) => `<svg ${NS}><rect width="512" height="512" rx="112" fill="${BLUE}"/><g transform="translate(256 256) scale(1.12) translate(-256 -256)">${v.fg}</g>\n</svg>\n`

const write = (p, data) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, data) }

async function main() {
  const pick = (process.argv[2] || DEFAULT).toUpperCase()
  if (!VARIANTS[pick]) throw new Error('Nieznany wariant: ' + pick)
  const browser = await chromium.launch()
  const page = await browser.newPage()
  const png = async (svg, size, { transparent = false, round = false } = {}) => {
    await page.setViewportSize({ width: size, height: size })
    const clip = round ? 'border-radius:50%;overflow:hidden;' : ''
    await page.setContent(`<html><body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px;${clip}">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</div></body></html>`)
    return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })
  }

  for (const [k, v] of Object.entries(VARIANTS)) {
    write(join(ROOT, 'tools/icons/variants', `variant-${k.toLowerCase()}.svg`), svgAny(v))
  }

  const v = VARIANTS[pick]
  const pub = (f) => join(ROOT, 'web/public', f)
  write(pub('icon.svg'), svgAny(v))
  write(pub('icon-maskable.svg'), svgMaskable(v))
  write(pub('favicon.svg'), svgFavicon(v))
  write(pub('icon-192.png'), await png(svgAny(v), 192))
  write(pub('icon-512.png'), await png(svgAny(v), 512))
  write(pub('icon-maskable-512.png'), await png(svgMaskable(v), 512))
  write(pub('apple-touch-icon.png'), await png(svgMaskable(v), 180)) // iOS sam zaokrągla narożniki
  write(pub('favicon-32.png'), await png(svgFavicon(v), 32))

  const res = join(ROOT, 'mobile/android/app/src/main/res')
  const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
  for (const [d, m] of Object.entries(dens)) {
    const dir = join(res, `mipmap-${d}`)
    write(join(dir, 'ic_launcher.png'), await png(svgAny(v), Math.round(48 * m)))
    write(join(dir, 'ic_launcher_round.png'), await png(svgMaskable(v), Math.round(48 * m), { round: true }))
    write(join(dir, 'ic_launcher_foreground.png'), await png(svgFore(v), Math.round(108 * m)))
  }
  write(join(res, 'values/ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BLUE}</color>\n</resources>\n`)

  // Podglądy wszystkich wariantów: jasne i ciemne tło, kształt zaokrąglony i okrągły, rozmiary 128/48/24.
  const cell = (svg, bgc, round, s) => `<div style="background:${bgc};padding:14px;display:flex;align-items:center;justify-content:center"><div style="width:${s}px;height:${s}px;${round ? 'border-radius:50%;overflow:hidden' : ''}">${svg.replace('<svg ', `<svg width="${s}" height="${s}" `)}</div></div>`
  const rows = Object.entries(VARIANTS).map(([k, vv]) => {
    const any = svgAny(vv), mask = svgMaskable(vv)
    const cells = ['#f6f7f9', '#0f1216'].map((c) => [cell(any, c, false, 128), cell(mask, c, true, 128), cell(any, c, false, 48), cell(any, c, false, 24)].join('')).join('')
    return `<div style="font:600 18px system-ui;padding:8px 12px;grid-column:1/-1">Wariant ${k}: ${vv.name}${k === pick ? ' (domyślny)' : ''}</div>${cells}`
  }).join('')
  await page.setViewportSize({ width: 1240, height: 1100 })
  await page.setContent(`<html><body style="margin:0;background:#fff"><div style="display:grid;grid-template-columns:repeat(8,1fr);gap:0">${rows}</div></body></html>`)
  write(join(ROOT, 'tools/icons/preview/warianty.png'), await page.screenshot({ fullPage: true }))
  await browser.close()
  console.log('Gotowe, wariant domyślny:', pick)
}
main()
