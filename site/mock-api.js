// Faux back-end de la démo : remplace l'API Express + SQLite du vrai projet.
// Tout tourne dans le navigateur ; les données sont fictives et rangées dans localStorage.
// Les règles (validation, chevauchements à la demi-journée, totaux, statistiques) reprennent
// celles de backoffice/routes/admin.js, validate.js et slots.js du projet d'origine.

const DATA_KEY = 'demo-latortue-v1'
const SESSION_KEY = 'demo-latortue-session'
const DEMO_USER = 'demo'
const DEMO_PASSWORD = 'demo'

// Stockage : localStorage dans le navigateur, simple objet en mémoire s'il est indisponible (ou en test).
function makeStore(kind) {
  try {
    const s = globalThis[kind]
    s.setItem('__t', '1'); s.removeItem('__t')
    return s
  } catch {
    const m = new Map()
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }
  }
}
const local = makeStore('localStorage')
const session = makeStore('sessionStorage')

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status }
}
const bad = (message) => new HttpError(400, message)

// ── Demi-journées (slots.js) ─────────────────────────────────────────────
const HALVES = ['am', 'pm']
const dayNum = (ymd) => Math.floor(Date.parse(`${ymd}T00:00:00Z`) / 86400000)
const slot = (ymd, half) => dayNum(ymd) * 2 + (half === 'pm' ? 1 : 0)
const startSlot = (b) => slot(b.start_date, b.start_half)
const endSlot = (b) => slot(b.end_date, b.end_half)
const overlaps = (a, b) => startSlot(a) <= endSlot(b) && startSlot(b) <= endSlot(a)
const slotDate = (s) => new Date(Math.floor(s / 2) * 86400000).toISOString().slice(0, 10)
const slotHalf = (s) => (s % 2 === 0 ? 'am' : 'pm')
const HALF_FR = { am: 'matin', pm: 'après-midi' }
const frDate = (ymd) => ymd.split('-').reverse().join('/')
const describeSlot = (s) => `${frDate(slotDate(s))} ${HALF_FR[slotHalf(s)]}`
const describeAt = (ymd, half) => `${frDate(ymd)} ${HALF_FR[half]}`
const isoOfDay = (n) => new Date(n * 86400000).toISOString().slice(0, 10)
const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── Validation (validate.js) ─────────────────────────────────────────────
function str(value, label, { max = 200 } = {}) {
  if (value == null || value === '') return ''
  if (typeof value !== 'string') throw bad(`${label} invalide`)
  const v = value.trim()
  if (v.length > max) throw bad(`${label} est trop long (${max} caractères maximum)`)
  return v
}
function date(value, label, { required = false } = {}) {
  if (value == null || value === '') {
    if (required) throw bad(`${label} est requise`)
    return null
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw bad(`${label} invalide`)
  const d = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw bad(`${label} invalide`)
  return value
}
function email(value) {
  const v = str(value, 'Email', { max: 200 })
  if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw bad('Email invalide')
  return v
}
function oneOf(value, label, allowed) {
  if (!allowed.includes(value)) throw bad(`${label} invalide`)
  return value
}
function money(value, label) {
  if (value == null || value === '') return 0
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) throw bad(`${label} invalide`)
  return Math.round(n * 100)
}
function count(value, label, { max = 50 } = {}) {
  if (value == null || value === '') return null
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > max) throw bad(`${label} invalide`)
  return n
}

// ── Données fictives ─────────────────────────────────────────────────────
// Générateur pseudo-aléatoire à graine fixe : la démo a toujours le même contenu au départ.
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FIRST_NAMES = ['Camille', 'Julien', 'Sophie', 'Thomas', 'Léa', 'Antoine', 'Emma', 'Nicolas', 'Chloé', 'Maxime', 'Laura', 'Hugo', 'Manon', 'Lucas', 'Inès', 'Paul', 'Clara', 'Romain']
const LAST_NAMES = ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon', 'Laurent', 'Lefèvre', 'Michel', 'Garcia', 'David', 'Bertrand', 'Roux']
const PLATFORMS = ['Wikicampers', 'Wikicampers', 'Yescapa', 'Yescapa', 'En direct', 'En direct', 'Leboncoin', 'Autre']
const INSURANCES = ['', 'Assurance Voyage+', 'Protect Camp']
const PAYMENT_SETS = [['transfer'], ['transfer'], ['cash'], ['cheque'], ['cash', 'transfer']]
const NOTES = ['', '', '', 'Arrivée tardive prévue.', 'Premier séjour en camping-car.', 'Demande un siège bébé.', 'Voyage en famille.']

export function buildSeed(now = new Date()) {
  const rnd = mulberry32(2026)
  const pick = (a) => a[Math.floor(rnd() * a.length)]
  const todayN = dayNum(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`)
  const rows = []
  let id = 1

  const add = (r) => rows.push({
    id: id++, first_name: '', customer_name: '', email: '', phone: '', notes: '', people: null, booked_on: null,
    start_half: 'am', end_half: 'pm', insurance: 0, insurance_name: '', platform: '', rental_cents: 0,
    deposit_cents: 0, payment: '', paid: 0, ...r,
  })

  const cy = now.getFullYear()
  for (const year of [cy - 1, cy, cy + 1]) {
    const upcomingYear = year > cy
    // Entretien annuel avant la saison et révision d'automne
    add({ status: 'blocked', start_date: `${year}-03-10`, end_date: `${year}-03-14`, notes: 'Entretien annuel' })
    if (!upcomingYear) add({ status: 'blocked', start_date: `${year}-11-12`, end_date: `${year}-11-16`, notes: 'Révision avant l\'hiver' })

    let cur = dayNum(`${year}-04-01`) + Math.floor(rnd() * 6)
    const last = dayNum(`${year}-10-31`)
    let made = 0
    // L'an prochain : seulement quelques réservations déjà prises (on est en avance sur la saison)
    while (cur < last && !(upcomingYear && made >= 5)) {
      made++
      const nights = 3 + Math.floor(rnd() * 11)
      const startN = cur
      const endN = cur + nights
      const first = pick(FIRST_NAMES)
      const name = pick(LAST_NAMES)
      const past = endN < todayN
      let status = 'confirmed'
      if (past && rnd() < 0.08) status = 'cancelled'
      else if (!past && startN > todayN) status = rnd() < 0.4 ? 'pending' : 'confirmed'

      const perDay = 95 + Math.floor(rnd() * 9) * 5
      const rental = nights * perDay
      const deposit = Math.round((rental * 0.3) / 10) * 10
      const halfStart = rnd() < 0.2 ? 'pm' : 'am'
      const halfEnd = rnd() < 0.2 ? 'am' : 'pm'
      const insurance = pick(INSURANCES)
      add({
        status,
        start_date: isoOfDay(startN), start_half: halfStart,
        end_date: isoOfDay(endN), end_half: halfEnd,
        first_name: first, customer_name: name,
        email: `${first.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()}.${name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()}@example.com`,
        // Numéros réservés à la fiction (plage ARCEP 06 39 98 xx xx)
        phone: `06 39 98 ${String(10 + Math.floor(rnd() * 89))} ${String(10 + Math.floor(rnd() * 89))}`,
        notes: pick(NOTES),
        people: 2 + Math.floor(rnd() * 4),
        // Jamais réservé « dans le futur »
        booked_on: isoOfDay(Math.min(startN - (10 + Math.floor(rnd() * 80)), todayN - 1 - Math.floor(rnd() * 60))),
        insurance: insurance ? 1 : 0, insurance_name: insurance,
        platform: pick(PLATFORMS),
        rental_cents: rental * 100,
        deposit_cents: deposit * 100,
        payment: pick(PAYMENT_SETS).join(','),
        paid: past && status !== 'cancelled' && rnd() < 0.9 ? 1 : 0,
      })
      cur = endN + 1 + Math.floor(rnd() * 7)
    }
  }
  return rows
}

// ── Stockage ─────────────────────────────────────────────────────────────
let cache = null
function load() {
  if (cache) return cache
  try {
    const raw = local.getItem(DATA_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed.bookings)) return (cache = parsed)
    }
  } catch { /* données illisibles : on repart de la graine */ }
  cache = { nextId: 0, bookings: buildSeed() }
  cache.nextId = Math.max(0, ...cache.bookings.map((b) => b.id)) + 1
  save()
  return cache
}
function save() {
  try { local.setItem(DATA_KEY, JSON.stringify(cache)) } catch { /* quota ou mode privé : la démo reste en mémoire */ }
}
export function resetDemo() {
  cache = null
  local.removeItem(DATA_KEY)
}

// ── Règles métier (routes/admin.js) ──────────────────────────────────────
const BOOKING_STATUS = ['pending', 'confirmed', 'cancelled', 'blocked']
const BLOCKING = ['confirmed', 'blocked']
const PLATFORM_NAMES = ['Leboncoin', 'Wikicampers', 'Yescapa', 'En direct', 'Autre']
const PAYMENTS = ['cash', 'cheque', 'transfer']

function parseBooking(b) {
  const out = {
    start_date: date(b?.start_date, 'Date de début', { required: true }),
    end_date: date(b?.end_date, 'Date de fin', { required: true }),
    status: oneOf(b?.status, 'Statut', BOOKING_STATUS),
    customer_name: str(b?.customer_name, 'Nom', { max: 100 }),
    first_name: str(b?.first_name, 'Prénom', { max: 100 }),
    email: email(b?.email),
    phone: str(b?.phone, 'Téléphone', { max: 40 }),
    notes: str(b?.notes, 'Notes', { max: 2000 }),
    people: count(b?.people, 'Nombre de personnes', { max: 20 }),
    booked_on: date(b?.booked_on, 'Date de réservation'),
    start_half: oneOf(b?.start_half ?? 'am', 'Départ', HALVES),
    end_half: oneOf(b?.end_half ?? 'pm', 'Retour', HALVES),
    insurance_name: str(b?.insurance_name, 'Assurance', { max: 80 }),
    insurance: 0,
    platform: b?.platform ? oneOf(b.platform, 'Plateforme', PLATFORM_NAMES) : '',
    rental_cents: money(b?.rental_amount, 'Montant de la location'),
    deposit_cents: money(b?.deposit_amount, 'Acompte'),
    payment: '',
    paid: b?.paid ? 1 : 0,
  }
  const methods = Array.isArray(b?.payment) ? b.payment : []
  if (methods.some((m) => !PAYMENTS.includes(m))) throw bad('Règlement invalide')
  out.payment = PAYMENTS.filter((m) => methods.includes(m)).join(',')

  if (out.end_date < out.start_date) throw bad('La date de fin précède la date de début')
  if (startSlot(out) > endSlot(out)) {
    throw bad(`Le retour (${describeAt(out.end_date, out.end_half)}) est avant le départ (${describeAt(out.start_date, out.start_half)}). Le même jour, choisissez un départ le matin ou un retour l'après-midi.`)
  }
  if (out.status !== 'blocked' && !out.customer_name) throw bad('Nom requis')
  out.insurance = out.insurance_name ? 1 : 0
  if (out.status === 'blocked') {
    Object.assign(out, { first_name: '', people: null, booked_on: null, insurance: 0, insurance_name: '',
      platform: '', rental_cents: 0, deposit_cents: 0, payment: '', paid: 0 })
  }
  return out
}

function withTotals(row) {
  const total = row.rental_cents
  const paid = !!row.paid
  return {
    ...row,
    paid,
    payment: row.payment ? row.payment.split(',') : [],
    total_cents: total,
    collected_cents: paid ? total : row.deposit_cents,
    remaining_cents: paid ? 0 : total - row.deposit_cents,
  }
}

function assertNoOverlap(b, excludeId = 0) {
  if (!BLOCKING.includes(b.status)) return
  const c = load().bookings.find((x) =>
    BLOCKING.includes(x.status) && x.id !== excludeId && x.start_date <= b.end_date && x.end_date >= b.start_date && overlaps(x, b))
  if (!c) return
  const who = c.status === 'blocked' ? 'une indisponibilité' : `la location de ${c.customer_name || 'un client'}`
  throw new HttpError(409, [
    `Créneau déjà pris par ${who} : du ${describeAt(c.start_date, c.start_half)} au ${describeAt(c.end_date, c.end_half)} (inclus).`,
    `Libre juste avant : jusqu'au ${describeSlot(startSlot(c) - 1)} inclus.`,
    `Libre juste après : à partir du ${describeSlot(endSlot(c) + 1)}.`,
  ].join('\n'))
}

const byStart = (a, b) => (a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : a.id - b.id)

function stats(yearParam) {
  const year = yearParam == null ? new Date().getFullYear() : Number(yearParam)
  if (!Number.isInteger(year) || year < 1900 || year > 2200) throw bad('Année invalide')
  const all = load().bookings
  const rows = all
    .filter((r) => ['confirmed', 'pending'].includes(r.status) && r.start_date >= `${year}-01-01` && r.start_date <= `${year}-12-31`)
    .map(withTotals)

  const months = Array.from({ length: 12 }, () => ({ revenue_cents: 0, rentals: 0, days: 0 }))
  const platforms = {}
  const payments = { cash: 0, cheque: 0, transfer: 0 }
  let collected = 0
  let remaining = 0
  for (const r of rows) {
    const m = months[Number(r.start_date.slice(5, 7)) - 1]
    m.revenue_cents += r.total_cents
    m.rentals += 1
    const key = r.platform || 'Non renseignée'
    platforms[key] ||= { rentals: 0, revenue_cents: 0 }
    platforms[key].rentals += 1
    platforms[key].revenue_cents += r.total_cents
    for (const p of r.payment) payments[p] += 1
    collected += r.collected_cents
    remaining += Math.max(r.remaining_cents, 0)
    for (let s = startSlot(r); s <= endSlot(r); s++) {
      const d = new Date(Math.floor(s / 2) * 86400000)
      if (d.getUTCFullYear() === year) months[d.getUTCMonth()].days += 0.5
    }
  }
  const daysInYear = (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 366 : 365
  const rentedDays = months.reduce((s, m) => s + m.days, 0)
  const today = todayIso()

  return {
    year,
    pendingBookings: all.filter((b) => b.status === 'pending').length,
    rentals: rows.length,
    revenue_cents: rows.reduce((s, r) => s + r.total_cents, 0),
    collected_cents: collected,
    remaining_cents: remaining,
    occupancy: rentedDays / daysInYear,
    months, platforms, payments,
    upcoming: all
      .filter((b) => ['confirmed', 'pending'].includes(b.status) && b.end_date >= today)
      .sort(byStart).slice(0, 5)
      .map(({ id, start_date, end_date, status, customer_name, first_name }) => ({ id, start_date, end_date, status, customer_name, first_name })),
  }
}

function requireAuth() {
  if (session.getItem(SESSION_KEY) !== '1') throw new HttpError(401, 'Non connecté')
}

const clone = (v) => JSON.parse(JSON.stringify(v))

// Point d'entrée : même signature que l'appel réseau du vrai projet.
// path = "/bookings?year=2026", renvoie les mêmes JSON que l'API Express.
export async function handle(method, path, body) {
  const url = new URL(path, 'http://demo.local')
  const route = url.pathname
  const q = url.searchParams

  if (method === 'GET' && route === '/login-config') return { recaptchaSiteKey: null }

  if (method === 'POST' && route === '/login') {
    const u = String(body?.username ?? '').trim()
    if (u.toLowerCase() !== DEMO_USER || String(body?.password ?? '') !== DEMO_PASSWORD) {
      throw new HttpError(401, 'Identifiants invalides (démo : identifiant « demo », mot de passe « demo »)')
    }
    session.setItem(SESSION_KEY, '1')
    return { user: { username: DEMO_USER }, csrf: 'demo' }
  }

  requireAuth()
  const data = load()

  if (method === 'GET' && route === '/me') return { user: { username: DEMO_USER }, csrf: 'demo' }
  if (method === 'POST' && route === '/logout') { session.removeItem(SESSION_KEY); return { ok: true } }
  if (method === 'GET' && route === '/stats') return clone(stats(q.get('year')))

  if (method === 'GET' && route === '/bookings/years') {
    const years = data.bookings.map((b) => Number(b.start_date.slice(0, 4)))
    years.push(new Date().getFullYear())
    return [...new Set(years)].sort((a, b) => a - b)
  }

  if (method === 'GET' && route === '/bookings') {
    const from = date(q.get('from'), 'from')
    const to = date(q.get('to'), 'to')
    let rows
    if (from && to) {
      rows = data.bookings.filter((b) => b.end_date >= from && b.start_date <= to)
    } else if (q.get('year') != null) {
      const year = Number(q.get('year'))
      if (!Number.isInteger(year) || year < 1900 || year > 2200) throw bad('Année invalide')
      rows = data.bookings.filter((b) => b.start_date >= `${year}-01-01` && b.start_date <= `${year}-12-31`)
    } else {
      rows = data.bookings.slice(0, 1000)
    }
    return clone(rows.slice().sort(byStart).map(withTotals))
  }

  if (method === 'POST' && route === '/bookings') {
    const b = parseBooking(body)
    assertNoOverlap(b)
    const id = data.nextId++
    data.bookings.push({ id, ...b })
    save()
    return { id }
  }

  const m = route.match(/^\/bookings\/(\d+)(\/paid)?$/)
  if (m) {
    const id = Number(m[1])
    const idx = data.bookings.findIndex((b) => b.id === id)
    if (method === 'PUT' && !m[2]) {
      const b = parseBooking(body)
      assertNoOverlap(b, id)
      if (idx < 0) throw new HttpError(404, 'Introuvable')
      data.bookings[idx] = { id, ...b }
      save()
      return { ok: true }
    }
    if (method === 'PATCH' && m[2]) {
      if (idx < 0 || data.bookings[idx].status === 'blocked') throw new HttpError(404, 'Introuvable')
      data.bookings[idx].paid = body?.paid ? 1 : 0
      save()
      return { ok: true }
    }
    if (method === 'DELETE' && !m[2]) {
      if (idx >= 0) data.bookings.splice(idx, 1)
      save()
      return { ok: true }
    }
  }

  throw new HttpError(404, 'Introuvable')
}
