// Generator ikon aplikacji. Źródłem są wektory zapisane poniżej (autorskie, bez
// zewnętrznych zasobów, bez skryptów w SVG). Uruchomienie:
//   node tools/icons/build-icons.mjs [A|B|C]      (wymaga pakietu `playwright`)
// Bez argumentu bierze wariant domyślny (DEFAULT). Zapisuje:
//   (warianty: A, C = pierwsza tura, B1-B3 = trasa i waluty ze złotym wyróżnionym)
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
const DEFAULT = 'D1'

// Elementy rysowane w układzie 512x512, mieszczą się w kole o promieniu ~190 od środka
// (strefa bezpieczna ikon maskable to koło o promieniu 40% szerokości, czyli ~205).
const RED = '#dc143c'
// Symbole walut narysowane liniami (bez czcionek), układ ok. 100 jednostek wysokości, środek w (0,0).
const GLYPH = {
  eur: 'M32 -30A38 38 0 1 0 32 30M-44 -9H20M-44 9H20',
  usd: 'M24 -27C12 -42 -26 -38 -22 -15C-18 6 24 0 24 21C24 44 -14 46 -26 28M0 -52V52',
  gbp: 'M26 -31C14 -50 -24 -44 -24 -13V26M-24 26C-24 38 -36 44 -42 46H30M-40 4H12',
  jpy: 'M-30 -48L0 -6L30 -48M0 -6V50M-26 8H26M-26 30H26',
  inr: 'M-28 -42H28M-28 -18H28M-28 -42C24 -42 24 4 -28 4L18 50',
  pln: 'M-56 -14H-18L-56 36H-18M20 -48V34M4 12L38 -14',
}
const glyph = (k, x, y, s, color, sw) =>
  `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"><path d="${GLYPH[k]}"/></g>`
const coin = (x, y, r, fill = '#fff') => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`
const ring = (x, y, r, w, color) => `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${color}" stroke-width="${w}"/>`

const orbit = (r) => `<circle cx="256" cy="256" r="${r}" fill="none" stroke="#fff" stroke-opacity=".38" stroke-width="8"/>`
const around = (list, r, cr, gs, sw, fill, color, start = -90) => list.map((k, i) => {
  const a = ((start + (360 / list.length) * i) * Math.PI) / 180
  const x = Math.round(256 + r * Math.cos(a)), y = Math.round(256 + r * Math.sin(a))
  return coin(x, y, cr, fill) + glyph(k, x, y, gs, color, sw)
}).join('')
// Trasa-wąż z monetami jako przystankami: start (bursztynowa kropka), 4 monety, pinezka celu.
const pin = ([x, y], fill, hole) => `<g transform="translate(${x} ${y}) scale(.7)"><path d="M0 0c0 0 -58 -52 -58 -98a58 58 0 0 1 116 0c0 46 -58 98 -58 98z" fill="${fill}"/><circle cx="0" cy="-98" r="22" fill="${hole}"/></g>`
const STOPS = [['eur', 216, 388], ['gbp', 383, 341], ['pln', 268, 294], ['jpy', 157, 247], ['usd', 266, 200]]
const journey = (style) => `
  <path d="M136 388H336A47 47 0 0 0 336 294H204A47 47 0 0 1 204 200H356" fill="none" stroke="#fff" stroke-width="22" stroke-linecap="round"/>
  <circle cx="136" cy="388" r="26" fill="${AMBER}"/>
  ${STOPS.map(([k, x, y]) => {
    const z = k === 'pln', st = style(z)
    return coin(x, y, 38, st.fill) + (z && st.ring ? ring(x, y, 34, 9, st.ring) : '') + glyph(k, x, y, z ? 0.44 : 0.4, st.glyph, 20)
  }).join('')}
  ${pin([356, 200], RED, '#fff')}`
const VARIANTS = {
  // B1: duża moneta zł z czerwonym pierścieniem, obok mniejsze € i $
  B1: {
    name: 'Trasa i cena: zł w centrum, obok € i $',
    fg: `
  <path d="M150 352H246V270" fill="none" stroke="#fff" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="150" cy="352" r="34" fill="${AMBER}"/>
  ${coin(304, 196, 100)}${ring(304, 196, 88, 12, RED)}${glyph('pln', 304, 196, 0.78, BLUE, 17)}
  ${coin(168, 196, 34)}${glyph('eur', 168, 196, 0.4, BLUE, 20)}
  ${coin(206, 280, 30, '#fff')}${glyph('usd', 206, 280, 0.34, BLUE, 22)}`,
  },
  // B2: trasa przez monety € i $ do dużej monety zł
  B2: {
    name: 'Trasa i cena: € → $ → zł',
    fg: `
  <path d="M150 350H226a62 62 0 0 0 62-62V240" fill="none" stroke="#fff" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>
  ${coin(150, 350, 40, AMBER)}${glyph('eur', 150, 350, 0.46, BLUE_DARK, 18)}
  ${coin(232, 350, 40, '#fff')}${glyph('usd', 232, 350, 0.4, BLUE, 20)}
  ${coin(300, 190, 100)}${ring(300, 190, 88, 12, RED)}${glyph('pln', 300, 190, 0.78, BLUE, 17)}`,
  },
  // B3: wachlarz monet: zł z przodu (biało-czerwone), € i £ z tyłu
  B3: {
    name: 'Trasa i cena: wachlarz € £ i zł',
    fg: `
  <path d="M150 352H210" fill="none" stroke="#fff" stroke-width="26" stroke-linecap="round"/>
  <circle cx="150" cy="352" r="34" fill="${AMBER}"/>
  ${coin(206, 160, 58, AMBER)}${glyph('eur', 206, 160, 0.56, BLUE_DARK, 15)}
  ${coin(372, 190, 58, '#e7efff')}${glyph('gbp', 372, 190, 0.52, BLUE, 16)}
  ${coin(290, 262, 96)}${ring(290, 262, 84, 12, RED)}${glyph('pln', 290, 262, 0.74, BLUE, 17)}`,
  },
  // D1: złoty w centrum (biało-czerwony), wokół orbita monet z walutami świata
  D1: {
    name: 'Orbita walut: zł w centrum, 4 waluty',
    fg: `
  ${orbit(142)}
  ${around(['eur', 'usd', 'gbp', 'jpy'], 142, 42, 0.42, 19, '#fff', BLUE, -135)}
  ${coin(256, 256, 90)}${ring(256, 256, 77, 13, RED)}${glyph('pln', 256, 256, 0.78, BLUE, 17)}`,
  },
  // D2: czerwona moneta zł w centrum, 5 walut dookoła
  D2: {
    name: 'Orbita walut: czerwone zł, 5 walut',
    fg: `
  ${orbit(150)}
  ${around(['eur', 'usd', 'gbp', 'jpy', 'inr'], 150, 36, 0.36, 20, '#fff', BLUE)}
  ${coin(256, 256, 92, RED)}${ring(256, 256, 78, 7, '#fff')}${glyph('pln', 256, 256, 0.8, '#fff', 17)}`,
  },
  // D3: biała moneta zł, 5 walut, bursztynowa kropka jako "podróżnik" na orbicie
  D3: {
    name: 'Orbita walut: białe zł, złote monety',
    fg: `
  ${orbit(150)}
  ${around(['eur', 'usd', 'gbp', 'jpy', 'inr'], 150, 36, 0.36, 20, AMBER, BLUE_DARK)}
  ${coin(256, 256, 92)}${ring(256, 256, 79, 13, RED)}${glyph('pln', 256, 256, 0.8, BLUE, 17)}`,
  },
  // E1: trasa z monetami-przystankami, zł tej samej wielkości z czerwonym pierścieniem
  E1: {
    name: 'Podróż: białe monety, zł z czerwonym pierścieniem',
    fg: journey((z) => ({ fill: '#fff', ring: RED, glyph: BLUE })),
  },
  // E2: jak E1, ale moneta zł jest czerwona (reszta biała)
  E2: {
    name: 'Podróż: czerwona moneta zł',
    fg: journey((z) => (z ? { fill: RED, glyph: '#fff' } : { fill: '#fff', glyph: BLUE })),
  },
  // E3: złote monety, zł biało-czerwone
  E3: {
    name: 'Podróż: złote monety, zł z czerwoną obwódką',
    fg: journey((z) => (z ? { fill: AMBER, ring: RED, glyph: BLUE_DARK } : { fill: AMBER, glyph: BLUE_DARK })),
  },
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
  const rows = Object.entries(VARIANTS).filter(([k]) => k === 'E3').map(([k, vv]) => {
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
