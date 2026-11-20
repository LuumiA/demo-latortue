// Démo : l'interface d'administration du vrai projet, branchée sur un faux back-end (mock-api.js)
// qui tourne dans le navigateur avec des données fictives. Aucun serveur, aucune vraie donnée.
import { handle, resetDemo } from './mock-api.js'

// Tout le texte venant de la base est inséré via textContent (jamais innerHTML) : pas de XSS.
const app = document.getElementById('app')
const state = { csrf: null, user: null, view: 'dashboard', month: monthStart(new Date()), year: new Date().getFullYear() }

// ── Utilitaires ──────────────────────────────────────────────────────────
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag)
  let value
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue
    if (k === 'value') value = v
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v)
    else if (k === 'class') el.className = v
    else if (k in el && k !== 'list') el[k] = v
    else el.setAttribute(k, v)
  }
  for (const c of children.flat(Infinity)) {
    if (c != null && c !== false) el.append(c.nodeType ? c : String(c))
  }
  if (value !== undefined) el.value = value // après les <option>
  return el
}

const SVG_NS = 'http://www.w3.org/2000/svg'
function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v)
  for (const c of children.flat(Infinity)) if (c != null) el.append(c.nodeType ? c : String(c))
  return el
}

async function api(method, path, body) {
  try {
    return await handle(method, path, body)
  } catch (e) {
    if (e.status === 401 && path !== '/login') { state.csrf = null; showLogin() }
    throw e
  }
}

const pad = (n) => String(n).padStart(2, '0')
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`
const todayIso = () => { const d = new Date(); return iso(d.getFullYear(), d.getMonth(), d.getDate()) }
function monthStart(d) { return new Date(d.getFullYear(), d.getMonth(), 1) }
const fmtDate = (v) => (v ? v.split('-').reverse().join('/') : '')
const range = (a, b) => (a === b ? fmtDate(a) : `${fmtDate(a)} → ${fmtDate(b)}`)

// Demi-journées : chaque jour = 2 créneaux (matin, après-midi). Même logique que backoffice/slots.js.
const HALF_LABEL = { am: 'matin', pm: 'après-midi' }
const dayNum = (ymd) => Math.floor(Date.parse(`${ymd}T00:00:00Z`) / 86400000)
const slotOf = (ymd, half) => dayNum(ymd) * 2 + (half === 'pm' ? 1 : 0)
// La location r occupe-t-elle ce jour, ce matin ('am') ou cet après-midi ('pm') ?
const covers = (r, ds, half) => {
  const s = slotOf(ds, half)
  return s >= slotOf(r.start_date, r.start_half) && s <= slotOf(r.end_date, r.end_half)
}
const halvesText = (r) => `départ ${HALF_LABEL[r.start_half] || 'matin'} → retour ${HALF_LABEL[r.end_half] || 'après-midi'}`
const eur = (cents) => (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: cents % 100 ? 2 : 0 })
const fullName = (b) => [b.first_name, b.customer_name].filter(Boolean).join(' ') || '—'
// Saisie « 1 250,50 » -> 1250.5 (chaîne vide -> '')
const parseAmount = (v) => { const t = String(v).trim().replace(/\s/g, '').replace(',', '.'); return t === '' ? '' : Number(t) }

const BOOKING_LABEL = { pending: 'En attente', confirmed: 'Confirmée', cancelled: 'Annulée', blocked: 'Indisponible' }
const badge = (kind, label) => h('span', { class: `badge ${kind}` }, label)

// Plateformes : étiquettes pastel (comme dans l'Excel) et couleurs de graphique validées (ordre fixe).
const PLATFORMS = [
  { name: 'Wikicampers', cls: 'pf-wikicampers', color: '#e07b39' },
  { name: 'En direct',   cls: 'pf-direct',      color: '#2f7fd0' },
  { name: 'Yescapa',     cls: 'pf-yescapa',     color: '#c99a00' },
  { name: 'Leboncoin',   cls: 'pf-leboncoin',   color: '#8e5bc9' },
  { name: 'Autre',       cls: 'pf-autre',       color: '#7d847f' },
]
const platformOf = (name) => PLATFORMS.find((p) => p.name === name)
const platformTag = (name) => (name ? h('span', { class: `tag ${platformOf(name)?.cls || 'pf-autre'}` }, name) : h('span', { class: 'muted' }, '—'))

const PAYMENTS = [
  { key: 'cash', label: 'Liquide', icon: '💶' },
  { key: 'cheque', label: 'Chèque', icon: '🧾' },
  { key: 'transfer', label: 'Virement', icon: '🏦' },
]
const paymentIcons = (keys) => keys.length
  ? h('span', { class: 'pay' }, keys.map((k) => {
    const p = PAYMENTS.find((x) => x.key === k)
    return h('span', { title: p.label, role: 'img', 'aria-label': p.label }, p.icon)
  }))
  : h('span', { class: 'muted' }, '—')

function errorBox() {
  const el = h('p', { class: 'error', role: 'alert' })
  el.show = (e) => {
    el.textContent = e?.message || String(e || '')
    // Message long (ex. conflit de dates) : on le ramène à l'écran, il peut être hors de la zone visible
    if (el.textContent) el.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  }
  return el
}

// Sélecteur d'année : une pastille par année présente dans les dates de début (+ l'année en cours).
async function yearPicker(onChange) {
  const years = await api('GET', '/bookings/years')
  if (!years.includes(state.year)) state.year = years.includes(new Date().getFullYear()) ? new Date().getFullYear() : years[years.length - 1]
  return h('div', { class: 'years', role: 'group', 'aria-label': 'Année' },
    years.map((y) => h('button', {
      type: 'button', class: `btn small ${y === state.year ? '' : 'secondary'}`, 'aria-pressed': String(y === state.year),
      onclick: () => { state.year = y; onChange() },
    }, y)))
}

// ── Connexion ────────────────────────────────────────────────────────────
// Pas de captcha dans la démo.
const loadRecaptcha = async () => null

function showLogin(message) {
  const err = errorBox()
  if (message) err.show(message)
  const user = h('input', { id: 'u', autocomplete: 'username', required: true, autofocus: true, value: 'demo' })
  const pass = h('input', { id: 'p', type: 'password', autocomplete: 'current-password', required: true, value: 'demo' })
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Se connecter')
  loadRecaptcha().catch((e) => err.show(e)) // préchargé pendant la saisie

  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault()
      err.show('')
      btn.disabled = true
      try {
        // Jeton v3 demandé au moment de l'envoi (valable 2 minutes, usage unique).
        const rc = await loadRecaptcha()
        const token = rc ? await rc.g.execute(rc.siteKey, { action: 'login' }) : undefined
        const r = await api('POST', '/login', { username: user.value, password: pass.value, captcha: token })
        state.csrf = r.csrf
        state.user = r.user
        showApp()
      } catch (ex) {
        err.show(ex)
        pass.value = ''
        btn.disabled = false
      }
    },
  },
  h('div', { class: 'field' }, h('label', { for: 'u' }, 'Identifiant'), user),
  h('div', { class: 'field' }, h('label', { for: 'p' }, 'Mot de passe'), pass),
  err, btn)
  app.replaceChildren(h('div', { class: 'login' }, h('div', { class: 'card' }, h('h1', {}, 'La Tortue – Administration'),
    h('p', { class: 'muted small' }, 'Démo : les identifiants sont déjà remplis, cliquez simplement sur « Se connecter ».'), form)))
}

// ── Coque ────────────────────────────────────────────────────────────────
// short = libellé court pour la barre du bas sur mobile ; disabled = menu prévu, pas encore actif
const VIEWS = [
  { key: 'dashboard', label: 'Tableau de bord', short: 'Accueil', icon: '📊' },
  { key: 'rentals', label: 'Locations', short: 'Locations', icon: '🚐' },
  { key: 'calendar', label: 'Calendrier', short: 'Calendrier', icon: '📅' },
  { key: 'ifu', label: 'IFU', short: 'IFU', icon: '📁', disabled: true },
]

async function logout() {
  try { await api('POST', '/logout', {}) } catch {}
  state.csrf = null
  showLogin()
}

async function showApp() {
  const main = h('main', { class: 'main' })
  const nav = h('nav', { class: 'side', 'aria-label': 'Navigation' },
    h('div', { class: 'brand' }, 'La Tortue'),
    VIEWS.map((v) => h('button', {
      type: 'button',
      class: v.disabled ? 'soon' : '',
      'data-view': v.key,
      disabled: v.disabled,
      title: v.disabled ? 'Bientôt disponible' : null,
      'aria-current': state.view === v.key ? 'page' : null,
      onclick: v.disabled ? null : () => { state.view = v.key; window.scrollTo(0, 0); showApp() },
    }, h('span', { class: 'ico', 'aria-hidden': 'true' }, v.icon),
    h('span', { class: 'lbl full' }, v.label), h('span', { class: 'lbl short' }, v.short))),
    h('div', { class: 'spacer' }),
    h('div', { class: 'who' }, state.user.username),
    h('button', { type: 'button', class: 'logout', onclick: logout }, 'Se déconnecter'))
  // Barre du haut : mobile uniquement (sur ordinateur, la déconnexion est dans le menu latéral)
  const topbar = h('header', { class: 'topbar' },
    h('strong', {}, 'La Tortue'),
    h('span', { class: 'who' }, state.user.username),
    h('button', { type: 'button', class: 'btn secondary small', onclick: logout }, 'Quitter'))
  app.replaceChildren(h('div', { class: 'shell' }, topbar, nav, main))

  const view = { dashboard, rentals, calendar }[state.view] || dashboard
  try {
    await view(main)
  } catch (e) {
    main.replaceChildren(h('p', { class: 'error', role: 'alert' }, e.message))
  }
}

// ── Graphiques (SVG maison, sans bibliothèque) ───────────────────────────
const MONTH_NAMES = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
const INK = '#1f2a22'
const MUTED = '#5d6b61'
const GRID = '#e3e8e3'
const SURFACE = '#ffffff'

function niceMax(v) {
  if (v <= 0) return 1
  const exp = 10 ** Math.floor(Math.log10(v))
  const f = v / exp
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp
}

const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']

// Un graphique est redessiné à la largeur réelle de son conteneur (1 unité SVG = 1 px) :
// les textes gardent leur taille sur téléphone au lieu d'être réduits avec l'image.
function responsive(draw) {
  const el = h('div', { class: 'chart-holder' })
  let last = 0
  new ResizeObserver(([entry]) => {
    const w = Math.round(entry.contentRect.width)
    if (w > 0 && w !== last) { last = w; el.replaceChildren(draw(w)) }
  }).observe(el)
  return el
}

// Barres verticales, une série : axe Y unique, grille discrète, barres fines à bout arrondi, survol = infobulle.
function barChart({ values, labels, shortLabels, color, format, ariaLabel, width }) {
  const narrow = width < 520
  const W = width, H = narrow ? 210 : 240, L = narrow ? 40 : 52, R = 6, T = 12, B = 28
  if (narrow) labels = shortLabels || labels
  const top = niceMax(Math.max(...values, 0))
  const pw = W - L - R, ph = H - T - B
  const slot = pw / values.length
  const bw = Math.min(26, slot * 0.55)
  const y = (v) => T + ph - (v / top) * ph
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': ariaLabel })
  // top vaut 1, 2, 5 ou 10 × 10^n : on choisit un nombre de graduations qui tombe juste (pas de 1,25 k€)
  const steps = Math.round(top / 10 ** Math.floor(Math.log10(top))) === 2 ? 4 : 5
  for (let i = 0; i <= steps; i++) {
    const v = (top / steps) * i
    svg.append(
      s('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: GRID, 'stroke-width': 1 }),
      s('text', { x: L - 8, y: y(v) + 4, 'text-anchor': 'end', fill: MUTED, 'font-size': 11 }, format(v, true)))
  }
  values.forEach((v, i) => {
    const x = L + slot * i + slot / 2
    if (v > 0) svg.append(s('rect', { x: x - bw / 2, y: y(v), width: bw, height: T + ph - y(v), rx: 4, fill: color }))
    svg.append(
      s('text', { x, y: H - 8, 'text-anchor': 'middle', fill: MUTED, 'font-size': 11 }, labels[i]),
      // Zone de survol plus large que la barre
      s('rect', { x: x - slot / 2, y: T, width: slot, height: ph + B, fill: 'transparent' }, s('title', {}, `${labels[i]} : ${format(v)}`)))
  })
  return svg
}

// Anneau : une part par plateforme, 2 px de séparation, total au centre.
function donut(parts, centerText, ariaLabel) {
  const R = 62, SW = 26, C = 2 * Math.PI * R, total = parts.reduce((t, p) => t + p.value, 0)
  const svg = s('svg', { viewBox: '0 0 180 180', class: 'donut', role: 'img', 'aria-label': ariaLabel })
  svg.append(s('circle', { cx: 90, cy: 90, r: R, fill: 'none', stroke: GRID, 'stroke-width': SW }))
  let offset = 0
  for (const p of parts) {
    if (!p.value) continue
    const len = (p.value / total) * C
    svg.append(s('circle', {
      cx: 90, cy: 90, r: R, fill: 'none', stroke: p.color, 'stroke-width': SW,
      'stroke-dasharray': `${Math.max(len - 2, 0.5)} ${C}`, 'stroke-dashoffset': -offset,
      transform: 'rotate(-90 90 90)',
    }, s('title', {}, p.title)))
    offset += len
  }
  svg.append(
    s('text', { x: 90, y: 90, 'text-anchor': 'middle', 'font-size': 26, 'font-weight': 700, fill: INK }, centerText),
    s('text', { x: 90, y: 108, 'text-anchor': 'middle', 'font-size': 11, fill: MUTED }, 'locations'))
  return svg
}

// Alternative accessible à chaque graphique : les mêmes données en tableau.
function dataTable(headers, rows) {
  return h('details', { class: 'data' },
    h('summary', {}, 'Voir les données'),
    h('table', {},
      h('thead', {}, h('tr', {}, headers.map((t) => h('th', {}, t)))),
      h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c)))))))
}

// ── Tableau de bord ──────────────────────────────────────────────────────
async function dashboard(main) {
  const body = h('div')
  const picker = await yearPicker(() => dashboard(main))
  main.replaceChildren(h('div', { class: 'toolbar' }, h('h1', {}, 'Tableau de bord'), picker), body)
  const st = await api('GET', `/stats?year=${state.year}`)
  const kpi = (value, label) => h('div', { class: 'card stat' }, h('b', {}, value), label)

  const empty = st.rentals === 0
  // Axe en k€ au-delà de 1 000 € pour rester lisible sur petit écran
  const axisEur = (v) => (v >= 1000 ? `${+(v / 1000).toFixed(1)} k€` : `${Math.round(v)} €`)
  const revenue = responsive((width) => barChart({
    width, values: st.months.map((m) => m.revenue_cents / 100), labels: MONTHS, shortLabels: MONTH_INITIALS, color: '#2f5d3a',
    format: (v, axis) => (axis ? axisEur(v) : eur(Math.round(v * 100))), ariaLabel: `Chiffre d'affaires par mois, ${st.year}`,
  }))
  const days = responsive((width) => barChart({
    width, values: st.months.map((m) => m.days), labels: MONTHS, shortLabels: MONTH_INITIALS, color: '#2f5d3a',
    format: (v, axis) => (axis ? String(Math.round(v)) : `${v.toLocaleString('fr-FR')} jour${v >= 2 ? 's' : ''}`), ariaLabel: `Jours loués par mois, ${st.year}`,
  }))

  const known = PLATFORMS.map((p) => ({ ...p, ...(st.platforms[p.name] || { rentals: 0, revenue_cents: 0 }) }))
  const unknown = st.platforms['Non renseignée']
  if (unknown) known.push({ name: 'Non renseignée', color: '#c9cfca', ...unknown })
  const parts = known.filter((p) => p.rentals).map((p) => ({
    value: p.rentals, color: p.color, title: `${p.name} : ${p.rentals} location${p.rentals > 1 ? 's' : ''} · ${eur(p.revenue_cents)}`,
  }))
  const legend = h('ul', { class: 'legend-list' }, known.filter((p) => p.rentals).map((p) => h('li', {},
    h('span', { class: 'swatch', style: `background:${p.color}` }), h('span', { class: 'lname' }, p.name),
    h('span', { class: 'muted' }, `${p.rentals} · ${eur(p.revenue_cents)}`))))

  const maxPay = Math.max(1, ...Object.values(st.payments))
  const payRows = PAYMENTS.map((p) => h('div', { class: 'hbar' },
    h('span', { class: 'hlabel' }, `${p.icon} ${p.label}`),
    h('span', { class: 'htrack' }, h('span', { class: 'hfill', style: `width:${(st.payments[p.key] / maxPay) * 100}%` })),
    h('b', {}, st.payments[p.key])))

  const paid = st.revenue_cents ? Math.min(100, (st.collected_cents / st.revenue_cents) * 100) : 0

  body.replaceChildren(
    h('div', { class: 'stats' },
      kpi(st.rentals, `location${st.rentals > 1 ? 's' : ''} en ${st.year}`),
      kpi(eur(st.revenue_cents), 'chiffre d\'affaires'),
      kpi(eur(st.remaining_cents), 'reste à encaisser'),
      kpi(`${Math.round(st.occupancy * 100)} %`, 'jours loués dans l\'année')),
    ...(empty ? [h('p', { class: 'card muted' }, `Aucune location commençant en ${st.year}. Ajoute-en depuis l'onglet Locations.`)] : []),
    h('div', { class: 'card' }, h('h2', {}, `Chiffre d'affaires par mois – ${st.year}`), revenue,
      h('p', { class: 'muted small' }, 'Par mois de début de location, locations confirmées et en attente.'),
      dataTable(['Mois', 'Locations', 'Chiffre d\'affaires'], st.months.map((m, i) => [MONTHS[i], m.rentals, eur(m.revenue_cents)]))),
    h('div', { class: 'grid2' },
      h('div', { class: 'card' }, h('h2', {}, 'Répartition par plateforme'),
        h('div', { class: 'donut-wrap' }, donut(parts, st.rentals, 'Locations par plateforme'), legend)),
      h('div', { class: 'card' }, h('h2', {}, 'Règlements'), payRows,
        h('p', { class: 'muted small' }, 'Une location réglée de plusieurs façons compte pour chacune.'),
        h('h2', { class: 'mt' }, 'Encaissé'),
        h('div', { class: 'progress', role: 'img', 'aria-label': `${Math.round(paid)} % encaissé` }, h('span', { style: `width:${paid}%` })),
        h('p', { class: 'small' }, `${eur(st.collected_cents)} encaissés sur ${eur(st.revenue_cents)} (acomptes et locations payées)`))),
    h('div', { class: 'card' }, h('h2', {}, `Jours loués par mois – ${st.year}`), days,
      dataTable(['Mois', 'Jours loués'], st.months.map((m, i) => [MONTHS[i], m.days.toLocaleString('fr-FR')]))),
    h('div', { class: 'card' },
      h('h2', {}, 'Prochaines locations'),
      st.upcoming.length
        ? st.upcoming.map((b) => h('div', { class: 'item' },
          h('div', { class: 'head' }, h('strong', {}, fullName(b)), badge(b.status, BOOKING_LABEL[b.status])),
          range(b.start_date, b.end_date)))
        : h('p', { class: 'muted' }, 'Aucune location à venir.')))
}

// ── Formulaire de location (création / modification) ─────────────────────
function bookingDialog(initial, onSaved) {
  const b = {
    status: 'confirmed', customer_name: '', first_name: '', email: '', phone: '', notes: '', people: '',
    booked_on: todayIso(), start_date: '', end_date: '', start_half: 'am', end_half: 'pm', insurance_name: '', platform: '',
    rental_cents: 0, deposit_cents: 0, payment: [], paid: false, ...initial,
  }
  const halfSelect = (id, value) => h('select', { id, value },
    h('option', { value: 'am' }, 'Matin'), h('option', { value: 'pm' }, 'Après-midi'))
  const cents = (c) => (c ? String(c / 100).replace('.', ',') : '')
  const err = errorBox()
  const f = {
    status: h('select', { id: 'b-status', value: b.status }, Object.entries(BOOKING_LABEL).map(([v, l]) => h('option', { value: v }, l))),
    name: h('input', { id: 'b-name', value: b.customer_name, maxLength: 100, autocomplete: 'off' }),
    first: h('input', { id: 'b-first', value: b.first_name, maxLength: 100, autocomplete: 'off' }),
    people: h('input', { id: 'b-people', type: 'number', min: 1, max: 20, value: b.people ?? '' }),
    booked: h('input', { id: 'b-booked', type: 'date', value: b.booked_on || '' }),
    start: h('input', { id: 'b-start', type: 'date', value: b.start_date, required: true }),
    end: h('input', { id: 'b-end', type: 'date', value: b.end_date, required: true }),
    startHalf: halfSelect('b-sh', b.start_half),
    endHalf: halfSelect('b-eh', b.end_half),
    platform: h('select', { id: 'b-platform', value: b.platform },
      h('option', { value: '' }, '—'), PLATFORMS.map((p) => h('option', { value: p.name }, p.name))),
    rental: h('input', { id: 'b-rental', inputMode: 'decimal', value: cents(b.rental_cents), placeholder: '0' }),
    deposit: h('input', { id: 'b-deposit', inputMode: 'decimal', value: cents(b.deposit_cents), placeholder: '0' }),
    insName: h('input', { id: 'b-insname', value: b.insurance_name, maxLength: 80, list: 'ins-list', autocomplete: 'off', placeholder: 'ex. Locavoyage, Macif…' }),
    paid: h('input', { id: 'b-paid', type: 'checkbox', checked: !!b.paid }),
    email: h('input', { id: 'b-email', type: 'email', value: b.email }),
    phone: h('input', { id: 'b-phone', value: b.phone, maxLength: 40 }),
    notes: h('textarea', { id: 'b-notes', value: b.notes, maxLength: 2000 }),
  }
  const pay = Object.fromEntries(PAYMENTS.map((p) => [p.key, h('input', { type: 'checkbox', checked: b.payment.includes(p.key) })]))
  const preview = h('span', { class: 'tag' })
  const remaining = h('output', { class: 'remaining', 'aria-live': 'polite' })
  // Suggestions de noms d'assurance (saisie libre possible)
  const insList = h('datalist', { id: 'ins-list' }, ['Locavoyage', 'Macif', 'Matmut', 'MAIF', 'AXA', 'Groupama'].map((n) => h('option', { value: n })))

  const refresh = () => {
    const p = platformOf(f.platform.value)
    preview.className = `tag ${p ? p.cls : ''}`
    preview.textContent = p ? p.name : ''
    const num = (el) => Number(parseAmount(el.value)) || 0
    const left = f.paid.checked ? 0 : num(f.rental) - num(f.deposit)
    remaining.textContent = eur(Math.round(left * 100))
    remaining.classList.toggle('neg', left < 0)
  }
  for (const el of [f.platform, f.rental, f.deposit, f.paid]) el.addEventListener('input', refresh)
  refresh()

  // ── Disponibilité en direct : grise le matin / l'après-midi déjà pris ─────
  const avail = h('div', { class: 'avail', 'aria-live': 'polite', hidden: true })
  const ISO = /^\d{4}-\d{2}-\d{2}$/
  const HALF_NAME = { am: 'Matin', pm: 'Après-midi' }
  let availToken = 0
  const optionOf = (sel, half) => sel.querySelector(`option[value=${half}]`)
  const setOption = (sel, half, reason) => {
    const o = optionOf(sel, half)
    o.disabled = !!reason
    o.textContent = reason ? `${HALF_NAME[half]} — ${reason}` : HALF_NAME[half]
  }
  // Si le choix actuel vient d'être grisé et que l'autre moitié est libre, on bascule dessus.
  const fixSelection = (sel) => {
    if (optionOf(sel, sel.value).disabled) {
      const other = sel.value === 'am' ? 'pm' : 'am'
      if (!optionOf(sel, other).disabled) sel.value = other
    }
  }
  const clientOverlaps = (a, c) => slotOf(a.start_date, a.start_half) <= slotOf(c.end_date, c.end_half)
    && slotOf(c.start_date, c.start_half) <= slotOf(a.end_date, a.end_half)

  async function refreshAvailability() {
    const token = ++availToken
    const start = f.start.value
    const end = f.end.value || start
    // Seules les locations confirmées et les indisponibilités bloquent le calendrier (comme côté serveur).
    if (!ISO.test(start) || !ISO.test(end) || !BLOCKING_STATUS.includes(f.status.value)) {
      for (const sel of [f.startHalf, f.endHalf]) for (const half of ['am', 'pm']) setOption(sel, half, null)
      avail.hidden = true
      return
    }
    const [from, to] = start <= end ? [start, end] : [end, start]
    let others
    try {
      others = (await api('GET', `/bookings?from=${from}&to=${to}`)).filter((r) => r.id !== b.id && BLOCKING_STATUS.includes(r.status))
    } catch { return }
    if (token !== availToken) return // une réponse plus récente est déjà arrivée
    const takenBy = (ds, half) => others.find((r) => covers(r, ds, half))
    const who = (r) => (r.status === 'blocked' ? 'indisponible' : `loué (${fullName(r)})`)

    // 1) créneaux déjà pris -> grisés
    for (const [sel, ds] of [[f.startHalf, start], [f.endHalf, end]]) {
      for (const half of ['am', 'pm']) setOption(sel, half, takenBy(ds, half) ? 'pris' : null)
      fixSelection(sel)
    }
    // 2) même jour : un retour le matin est impossible avec un départ l'après-midi (et inversement)
    if (start === end) {
      if (f.startHalf.value === 'pm' && !optionOf(f.endHalf, 'am').disabled) setOption(f.endHalf, 'am', 'impossible')
      if (f.endHalf.value === 'am' && !optionOf(f.startHalf, 'pm').disabled) setOption(f.startHalf, 'pm', 'impossible')
      fixSelection(f.endHalf); fixSelection(f.startHalf)
    }

    // 3) récapitulatif lisible
    const line = (title, ds) => {
      const am = takenBy(ds, 'am')
      const pm = takenBy(ds, 'pm')
      const part = (name, r) => [`${name} : `, h('span', { class: r ? 'taken' : 'free' }, r ? who(r) : 'libre')]
      return h('div', {}, h('strong', {}, `${title} ${fmtDate(ds)}`), ' — ', ...part('matin', am), ' · ', ...part('après-midi', pm))
    }
    const candidate = { start_date: start, start_half: f.startHalf.value, end_date: end, end_half: f.endHalf.value }
    const clash = others.find((r) => clientOverlaps(candidate, r))
    avail.className = clash ? 'avail warn' : 'avail'
    avail.replaceChildren(
      start === end ? line('Le', start) : h('div', {}, line('Départ le', start), line('Retour le', end)),
      clash
        ? h('div', { class: 'taken' }, `⚠ Cette période chevauche ${clash.status === 'blocked' ? 'une indisponibilité' : `la location de ${fullName(clash)}`} (du ${describeBooking(clash)}). Ajustez les dates ou les demi-journées.`)
        : h('div', { class: 'free' }, '✓ Ce créneau est libre.'))
    avail.hidden = false
  }
  let availTimer
  const scheduleAvailability = () => { clearTimeout(availTimer); availTimer = setTimeout(refreshAvailability, 200) }
  for (const el of [f.start, f.end]) { el.addEventListener('input', scheduleAvailability); el.addEventListener('change', scheduleAvailability) }
  for (const el of [f.startHalf, f.endHalf, f.status]) el.addEventListener('change', refreshAvailability)

  const field = (label, key) => h('div', { class: 'field' }, h('label', { for: f[key].id }, label), f[key])
  const dlg = h('dialog', {},
    h('form', {
      method: 'dialog',
      onsubmit: async (e) => {
        e.preventDefault()
        err.show('')
        const body = {
          status: f.status.value, start_date: f.start.value, end_date: f.end.value || f.start.value,
          start_half: f.startHalf.value, end_half: f.endHalf.value,
          customer_name: f.name.value, first_name: f.first.value, email: f.email.value, phone: f.phone.value,
          notes: f.notes.value, people: f.people.value, booked_on: f.booked.value, platform: f.platform.value,
          rental_amount: parseAmount(f.rental.value), deposit_amount: parseAmount(f.deposit.value),
          insurance_name: f.insName.value,
          payment: PAYMENTS.filter((p) => pay[p.key].checked).map((p) => p.key),
          paid: f.paid.checked,
        }
        try {
          await (b.id ? api('PUT', `/bookings/${b.id}`, body) : api('POST', '/bookings', body))
          dlg.close()
          await onSaved()
        } catch (ex) { err.show(ex) }
      },
    },
    h('h2', {}, b.id ? 'Modifier la location' : 'Nouvelle location'),
    err,
    field('Statut', 'status'),
    h('div', { class: 'row' }, field('Nom', 'name'), field('Prénom', 'first')),
    h('div', { class: 'row' }, field('Nombre de personnes', 'people'), field('Date de réservation', 'booked')),
    h('div', { class: 'row keep' }, field('Début de location', 'start'), field('Départ', 'startHalf')),
    h('div', { class: 'row keep' }, field('Fin de location', 'end'), field('Retour', 'endHalf')),
    h('p', { class: 'muted small hint-halves' }, 'Départ l\'après-midi : le matin reste libre. Retour le matin : l\'après-midi reste libre.'),
    avail,
    h('div', { class: 'field' }, h('label', { for: 'b-platform' }, 'Plateforme de réservation'),
      h('div', { class: 'inline' }, f.platform, preview)),
    h('div', { class: 'row keep' }, field('Location (€)', 'rental'), field('Acompte (€)', 'deposit')),
    field('Assurance (nom)', 'insName'),
    insList,
    h('div', { class: 'field' }, h('label', {}, 'Règlement'),
      h('div', { class: 'checks' }, PAYMENTS.map((p) => h('label', { class: 'check chip' }, pay[p.key], ` ${p.icon} ${p.label}`)))),
    h('div', { class: 'field' }, h('label', { class: 'check' }, f.paid, ' Location payée en totalité')),
    h('div', { class: 'total' }, 'Montant restant : ', remaining),
    h('details', {}, h('summary', {}, 'Coordonnées et notes (facultatif)'),
      h('div', { class: 'row' }, field('Email', 'email'), field('Téléphone', 'phone')),
      field('Notes', 'notes')),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', type: 'submit' }, 'Enregistrer'),
      h('button', { class: 'btn secondary', type: 'button', onclick: () => dlg.close() }, 'Annuler'),
      b.id && h('button', {
        class: 'btn danger', type: 'button',
        onclick: async () => {
          if (!confirm('Supprimer cette location ?')) return
          try { await api('DELETE', `/bookings/${b.id}`); dlg.close(); await onSaved() } catch (ex) { err.show(ex) }
        },
      }, 'Supprimer'))))
  dlg.addEventListener('close', () => dlg.remove())
  document.body.append(dlg)
  dlg.showModal()
  refreshAvailability()
}

// « 10/06/2031 matin au 12/06/2031 matin » pour un message
const describeBooking = (r) => `${fmtDate(r.start_date)} ${HALF_LABEL[r.start_half]} au ${fmtDate(r.end_date)} ${HALF_LABEL[r.end_half]}`

// ── Locations : liste filtrée par année, triée par date de début ─────────
async function rentals(main) {
  const holder = h('div', { class: 'card tablecard' })
  const picker = await yearPicker(() => rentals(main))
  main.replaceChildren(
    h('div', { class: 'toolbar' }, h('h1', {}, 'Locations'),
      h('button', { class: 'btn', onclick: () => bookingDialog({}, () => rentals(main)) }, 'Nouvelle location')),
    h('div', { class: 'toolbar' }, picker),
    holder)

  const rows = await api('GET', `/bookings?year=${state.year}`)
  if (!rows.length) {
    holder.replaceChildren(h('p', { class: 'muted' }, `Aucune location commençant en ${state.year}.`))
    return
  }
  const counted = rows.filter((r) => ['confirmed', 'pending'].includes(r.status))
  const sum = (key) => counted.reduce((t, r) => t + (key === 'remaining_cents' ? Math.max(r[key], 0) : r[key]), 0)
  const heads = ['Début', 'Fin', 'Client', 'Pers.', 'Plateforme', 'Location', 'Assurance', 'Acompte', 'Restant', 'Règlement', 'Statut', '']
  // data-label : sur téléphone, chaque ligne devient une carte et ce libellé précède la valeur (voir admin.css)
  const L = (i) => ({ 'data-label': heads[i] })
  holder.replaceChildren(h('div', { class: 'scroll' }, h('table', { class: 'rentals stack' },
    h('thead', {}, h('tr', {}, heads.map((t) => h('th', {}, t)))),
    h('tbody', {}, rows.map((r) => h('tr', { class: r.status === 'cancelled' ? 'cancelled' : '' },
      h('td', { ...L(0), class: 'c-start' }, fmtDate(r.start_date), h('div', { class: 'muted small' }, `départ ${HALF_LABEL[r.start_half] || 'matin'}`)),
      h('td', { ...L(1), class: 'c-end' }, fmtDate(r.end_date), h('div', { class: 'muted small' }, `retour ${HALF_LABEL[r.end_half] || 'après-midi'}`)),
      h('td', { class: 'c-name' }, r.status === 'blocked' ? h('em', { class: 'muted' }, 'Indisponible') : fullName(r),
        r.booked_on ? h('div', { class: 'muted small' }, `réservé le ${fmtDate(r.booked_on)}`) : null),
      h('td', L(3), r.people ?? '—'),
      h('td', L(4), platformTag(r.platform)),
      h('td', { ...L(5), class: 'num' }, r.status === 'blocked' ? '' : eur(r.rental_cents)),
      h('td', L(6), r.insurance_name || '—'),
      h('td', { ...L(7), class: 'num' }, r.status === 'blocked' ? '' : eur(r.deposit_cents)),
      h('td', { ...L(8), class: `num ${!r.paid && r.remaining_cents > 0 ? 'due' : ''}` },
        r.status === 'blocked' ? '' : r.paid ? badge('confirmed', '✓ Payé') : eur(r.remaining_cents)),
      h('td', L(9), paymentIcons(r.payment)),
      h('td', { ...L(10), class: 'c-status' }, badge(r.status, BOOKING_LABEL[r.status])),
      h('td', { class: 'row-actions' },
        !['blocked', 'cancelled'].includes(r.status) && h('button', {
          class: 'btn small', 'aria-label': r.paid ? 'Marquer non payé' : 'Marquer payé',
          title: r.paid ? 'Marquer non payé' : 'Marquer comme payé en totalité',
          onclick: async () => { await api('PATCH', `/bookings/${r.id}/paid`, { paid: !r.paid }); await rentals(main) },
        }, r.paid ? '↩ Non payé' : '✓ Payé'),
        h('button', { class: 'btn secondary small', onclick: () => bookingDialog(r, () => rentals(main)) }, 'Modifier'))))),
    h('tfoot', {}, h('tr', {},
      h('td', { colspan: 5, class: 'c-name' }, `Total ${state.year} (${counted.length} location${counted.length > 1 ? 's' : ''}, hors annulées)`),
      h('td', { ...L(5), class: 'num' }, eur(counted.reduce((t, r) => t + r.rental_cents, 0))),
      h('td', { class: 'c-empty' }),
      h('td', { ...L(7), class: 'num' }, eur(sum('deposit_cents'))),
      h('td', { ...L(8), class: 'num' }, eur(sum('remaining_cents'))),
      h('td', { colspan: 3, class: 'c-empty' }))))))
}

// ── Calendrier ───────────────────────────────────────────────────────────
// Chaque case est coupée en deux, dans l'ordre de la journée : bande du haut = matin, bande du bas = après-midi.
// Quand les deux moitiés n'ont pas le même état, chaque bande porte son nom (« matin », « après-midi »).
const CAL_COLOR = { confirmed: '#bfe0bf', pending: '#ffe2a8', blocked: '#c7dcf2' }
const CAL_STATE = { confirmed: 'loué', pending: 'en attente', blocked: 'indisponible' }
const STATUS_PRIORITY = ['confirmed', 'blocked', 'pending']
const BLOCKING_STATUS = ['confirmed', 'blocked'] // comme côté serveur : seuls ceux-là empêchent un chevauchement

async function calendar(main) {
  const grid = h('div', { class: 'cal' })
  const table = h('div', { class: 'card' })
  const hint = h('p', { class: 'hint', role: 'status' })
  let blockMode = false
  let pick = null // premier jour choisi en mode « bloquer »
  let rows = []   // locations touchant le mois affiché

  const goto = (d) => { state.month = monthStart(d); load() }
  const shift = (n) => goto(new Date(state.month.getFullYear(), state.month.getMonth() + n, 1))

  // Années proposées : celles des locations + l'année en cours et la suivante (+ celle affichée).
  const known = await api('GET', '/bookings/years')
  const now = new Date().getFullYear()
  const years = [...new Set([...known, now, now + 1, state.month.getFullYear()])].sort((a, b) => a - b)
  const monthSel = h('select', { 'aria-label': 'Mois', onchange: () => goto(new Date(Number(yearSel.value), Number(monthSel.value), 1)) },
    MONTH_NAMES.map((name, i) => h('option', { value: i }, name)))
  const yearSel = h('select', { 'aria-label': 'Année', onchange: () => goto(new Date(Number(yearSel.value), Number(monthSel.value), 1)) },
    years.map((y) => h('option', { value: y }, y)))

  const setHint = (text, isError = false) => {
    hint.textContent = text
    hint.className = isError ? 'hint error' : 'hint'
    hint.hidden = !text
  }
  const blockBtn = h('button', { class: 'btn secondary', type: 'button', 'aria-pressed': 'false', onclick: () => toggleBlock() }, '🚫 Bloquer des jours')
  function toggleBlock() {
    blockMode = !blockMode
    pick = null
    blockBtn.setAttribute('aria-pressed', String(blockMode))
    blockBtn.textContent = blockMode ? '✓ Terminer' : '🚫 Bloquer des jours'
    blockBtn.classList.toggle('on', blockMode)
    setHint(blockMode ? 'Touchez le premier jour à rendre indisponible, puis le dernier (un seul jour : touchez-le deux fois). Touchez un jour déjà bloqué pour le libérer.' : '')
    draw()
  }

  const swatch = (color) => h('span', { class: 'sw', style: `background:${color}` })
  // Mini-case d'exemple pour la légende : matin pris (haut), après-midi libre (bas)
  const sample = () => h('span', { class: 'sw-split', 'aria-hidden': 'true' },
    h('span', { style: `background:${CAL_COLOR.confirmed}` }), h('span', { style: 'background:#fff' }))
  main.replaceChildren(
    h('div', { class: 'toolbar' }, h('h1', {}, 'Calendrier'),
      h('div', { class: 'actions' }, blockBtn,
        h('button', { class: 'btn', onclick: () => bookingDialog({}, load) }, 'Nouvelle location'))),
    h('div', { class: 'card' },
      h('div', { class: 'toolbar cal-nav' },
        h('button', { class: 'btn secondary small', 'aria-label': 'Mois précédent', onclick: () => shift(-1) }, '←'),
        h('div', { class: 'cal-pick' }, monthSel, yearSel,
          h('button', { class: 'btn secondary small', onclick: () => goto(new Date()) }, 'Aujourd\'hui')),
        h('button', { class: 'btn secondary small', 'aria-label': 'Mois suivant', onclick: () => shift(1) }, '→')),
      hint,
      grid,
      h('div', { class: 'legend' },
        h('span', { class: 'lg' }, swatch(CAL_COLOR.confirmed), 'Loué'),
        h('span', { class: 'lg' }, swatch(CAL_COLOR.pending), 'En attente'),
        h('span', { class: 'lg' }, swatch(CAL_COLOR.blocked), 'Indisponible'),
        h('span', { class: 'lg' }, swatch('#fff'), 'Libre')),
      h('div', { class: 'howto' }, sample(),
        h('p', {}, h('strong', {}, 'Comment lire une case : '), 'le ', h('strong', {}, 'haut'), ' est le ', h('strong', {}, 'matin'), ', le ',
          h('strong', {}, 'bas'), ' est l\'', h('strong', {}, 'après-midi'), '. Ci-contre : matin pris, après-midi libre.'))),
    table)
  setHint('')

  const statusAt = (ds, half) => STATUS_PRIORITY.find((st) => rows.some((r) => r.status === st && covers(r, ds, half)))
  const occupied = (list, ds, half) => list.some((r) => BLOCKING_STATUS.includes(r.status) && covers(r, ds, half))

  async function onDay(ds, ev) {
    const box = ev.currentTarget.getBoundingClientRect()
    const clicked = ev.clientY - box.top >= box.height / 2 ? 'pm' : 'am' // moitié haute = matin, basse = après-midi
    const cover = (half) => rows.filter((r) => r.status !== 'cancelled' && covers(r, ds, half))

    if (!blockMode) {
      // Une location sur la moitié touchée : on l'ouvre. Sinon nouvelle location sur la moitié libre.
      if (cover(clicked).length) return bookingDialog(cover(clicked)[0], load)
      return bookingDialog({
        start_date: ds, end_date: ds,
        start_half: cover('am').length ? 'pm' : 'am',
        end_half: cover('pm').length ? 'am' : 'pm',
      }, load)
    }

    // Mode « bloquer des jours »
    const blocked = rows.find((r) => r.status === 'blocked' && (covers(r, ds, 'am') || covers(r, ds, 'pm')))
    if (blocked) {
      if (!confirm(`Retirer l'indisponibilité du ${range(blocked.start_date, blocked.end_date)} ?`)) return
      pick = null
      try { await api('DELETE', `/bookings/${blocked.id}`); setHint('Indisponibilité retirée.') } catch (e) { setHint(e.message, true) }
      return load()
    }
    if (!pick) {
      pick = ds
      setHint(`Premier jour : ${fmtDate(ds)}. Touchez le dernier jour de la période.`)
      return draw()
    }
    const [a, b] = pick <= ds ? [pick, ds] : [ds, pick]
    pick = null
    try {
      // Les demi-journées déjà prises aux deux bouts (retour le matin, départ l'après-midi…) restent telles quelles.
      const around = await api('GET', `/bookings?from=${a}&to=${b}`)
      const startHalf = occupied(around, a, 'am') ? 'pm' : 'am'
      const endHalf = occupied(around, b, 'pm') ? 'am' : 'pm'
      if (a === b && startHalf === 'pm' && endHalf === 'am') throw new Error('Ce jour est déjà pris (location ou indisponibilité) : choisissez un jour libre.')
      await api('POST', '/bookings', { status: 'blocked', start_date: a, end_date: b, start_half: startHalf, end_half: endHalf })
      setHint(`Indisponible du ${range(a, b)}.`)
    } catch (e) { setHint(e.message, true) }
    return load()
  }

  function draw() {
    const y = state.month.getFullYear()
    const m = state.month.getMonth()
    const days = new Date(y, m + 1, 0).getDate()
    const lead = (new Date(y, m, 1).getDay() + 6) % 7 // lundi = 0
    const cells = ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d) => h('div', { class: 'dow' }, d))
    for (let i = 0; i < lead; i++) cells.push(h('button', { class: 'empty', tabindex: -1, 'aria-hidden': 'true' }))
    for (let d = 1; d <= days; d++) {
      const ds = iso(y, m, d)
      const am = statusAt(ds, 'am')
      const pm = statusAt(ds, 'pm')
      const label = (st) => (st ? CAL_STATE[st] : 'libre')
      const partial = am !== pm // une moitié libre/prise différemment de l'autre : on écrit le nom de chaque bande
      cells.push(h('button', {
        type: 'button',
        class: ['day', partial && 'partial', ds === todayIso() && 'today', pick === ds && 'picked'].filter(Boolean).join(' '),
        style: `--am:${CAL_COLOR[am] || '#fff'};--pm:${CAL_COLOR[pm] || '#fff'};--head:${am === pm ? CAL_COLOR[am] || '#fff' : '#fff'}`,
        title: `Matin : ${label(am)} · Après-midi : ${label(pm)}`,
        'aria-label': `${d} ${MONTH_NAMES[m].toLowerCase()} : matin ${label(am)}, après-midi ${label(pm)}`,
        onclick: (ev) => onDay(ds, ev),
      },
      // En-tête = numéro du jour (de la couleur de la journée si elle est entière), puis 2 bandes : matin, après-midi
      h('span', { class: 'num' }, String(d)),
      h('span', { class: 'strip am' }, partial && h('i', {}, 'matin')),
      h('span', { class: 'strip pm' }, partial && h('i', {}, h('span', { class: 'full' }, 'après-midi'), h('span', { class: 'short' }, 'aprèm.')))))
    }
    grid.replaceChildren(...cells)
  }

  async function load() {
    const y = state.month.getFullYear()
    const m = state.month.getMonth()
    const days = new Date(y, m + 1, 0).getDate()
    rows = await api('GET', `/bookings?from=${iso(y, m, 1)}&to=${iso(y, m, days)}`)
    monthSel.value = String(m)
    yearSel.value = String(y)
    draw()

    table.replaceChildren(
      h('h2', {}, 'Ce mois-ci'),
      rows.length
        ? h('table', { class: 'stack month' },
          h('thead', {}, h('tr', {}, ['Dates', 'Client', 'Statut', ''].map((t) => h('th', {}, t)))),
          h('tbody', {}, rows.map((r) => h('tr', {},
            h('td', { class: 'c-name' }, range(r.start_date, r.end_date), h('div', { class: 'muted small' }, halvesText(r))),
            h('td', { 'data-label': 'Client' }, r.status === 'blocked' ? '—' : fullName(r), r.phone ? h('div', { class: 'muted' }, r.phone) : null),
            h('td', { 'data-label': 'Statut' }, badge(r.status, BOOKING_LABEL[r.status])),
            h('td', { class: 'row-actions' }, h('button', { class: 'btn secondary small', onclick: () => bookingDialog(r, load) }, 'Modifier'))))))
        : h('p', { class: 'muted' }, 'Rien ce mois-ci.'))
  }
  await load()
}

// ── Démarrage ────────────────────────────────────────────────────────────
try {
  const me = await api('GET', '/me')
  state.csrf = me.csrf
  state.user = me.user
  showApp()
} catch {
  showLogin()
}

// ── Démo : réinitialiser les données ─────────────────────────────────────
document.getElementById('demo-reset')?.addEventListener('click', () => {
  if (!confirm('Remettre la démo à zéro ? Vos modifications seront perdues.')) return
  resetDemo()
  location.reload()
})
