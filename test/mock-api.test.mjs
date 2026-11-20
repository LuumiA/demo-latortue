import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { handle, buildSeed, resetDemo } from '../site/mock-api.js'

const login = () => handle('POST', '/login', { username: 'demo', password: 'demo' })
const booking = (o = {}) => ({
  status: 'confirmed', customer_name: 'Test', start_date: '2031-06-10', end_date: '2031-06-12',
  start_half: 'am', end_half: 'pm', rental_amount: 300, deposit_amount: 100, ...o,
})

beforeEach(async () => {
  resetDemo()
  await handle('POST', '/logout', {}).catch(() => {})
})

test('les données de départ ne se chevauchent pas (à la demi-journée près)', () => {
  const rows = buildSeed().filter((r) => ['confirmed', 'blocked'].includes(r.status))
  const slot = (d, h) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86400000) * 2 + (h === 'pm' ? 1 : 0)
  rows.sort((a, b) => slot(a.start_date, a.start_half) - slot(b.start_date, b.start_half))
  for (let i = 1; i < rows.length; i++) {
    assert.ok(slot(rows[i].start_date, rows[i].start_half) > slot(rows[i - 1].end_date, rows[i - 1].end_half),
      `chevauchement : ${rows[i - 1].start_date} / ${rows[i].start_date}`)
  }
})

test('aucune donnée réelle : emails example.com et numéros fictifs', () => {
  for (const r of buildSeed().filter((x) => x.email)) assert.match(r.email, /@example\.com$/)
  for (const r of buildSeed().filter((x) => x.phone)) assert.match(r.phone, /^06 39 98 /)
})

test('la démo contient des locations passées, à venir et en attente', () => {
  const today = new Date().toISOString().slice(0, 10)
  const rows = buildSeed()
  assert.ok(rows.some((r) => r.end_date < today && r.status === 'confirmed'))
  assert.ok(rows.some((r) => r.start_date > today && r.status === 'confirmed'))
  assert.ok(rows.some((r) => r.start_date > today && r.status === 'pending'))
})

test('refuse tout sans connexion, et un mauvais mot de passe', async () => {
  await assert.rejects(handle('GET', '/bookings'), (e) => e.status === 401)
  await assert.rejects(handle('POST', '/login', { username: 'demo', password: 'x' }), (e) => e.status === 401)
})

test('création, chevauchement refusé, demi-journées compatibles', async () => {
  await login()
  await handle('POST', '/bookings', booking())
  await assert.rejects(handle('POST', '/bookings', booking({ start_date: '2031-06-11', end_date: '2031-06-14' })), (e) => e.status === 409)
  // Retour le matin du 12 impossible car la première occupe jusqu'au soir du 12 ; mais départ le 13 est libre
  await handle('POST', '/bookings', booking({ start_date: '2031-06-13', end_date: '2031-06-15' }))
  const rows = await handle('GET', '/bookings?year=2031')
  assert.equal(rows.length, 2)
})

test('validation : fin avant début, nom requis, email invalide', async () => {
  await login()
  await assert.rejects(handle('POST', '/bookings', booking({ end_date: '2031-06-01' })), (e) => e.status === 400)
  await assert.rejects(handle('POST', '/bookings', booking({ customer_name: '' })), (e) => e.status === 400)
  await assert.rejects(handle('POST', '/bookings', booking({ email: 'pas-un-email' })), (e) => e.status === 400)
})

test('statistiques : chiffre d\'affaires, encaissé et restant', async () => {
  await login()
  await handle('POST', '/bookings', booking({ rental_amount: 500, deposit_amount: 150 }))
  const { id } = await handle('POST', '/bookings', booking({ start_date: '2031-07-01', end_date: '2031-07-03', rental_amount: 200, deposit_amount: 50 }))
  let st = await handle('GET', '/stats?year=2031')
  assert.equal(st.revenue_cents, 70000)
  assert.equal(st.collected_cents, 20000)
  assert.equal(st.remaining_cents, 50000)
  await handle('PATCH', `/bookings/${id}/paid`, { paid: true })
  st = await handle('GET', '/stats?year=2031')
  assert.equal(st.collected_cents, 15000 + 20000)
})

test('modification et suppression', async () => {
  await login()
  const { id } = await handle('POST', '/bookings', booking())
  await handle('PUT', `/bookings/${id}`, booking({ customer_name: 'Autre' }))
  assert.equal((await handle('GET', '/bookings?year=2031'))[0].customer_name, 'Autre')
  await handle('DELETE', `/bookings/${id}`)
  assert.equal((await handle('GET', '/bookings?year=2031')).length, 0)
})
