'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { CLIENT_ID } from '@/constants'
import type { Customer } from './Clients'

const D = {
  sage: '#2C5F52', gold: '#C8A96E', charcoal: '#4A4A3F',
  page: '#F5F0E8', card: '#FAFAF8', border: '#D9D4C8',
  steel: '#4A7B6A', red: '#B94040', green: '#2E7D52',
  muted: 'rgba(74,74,63,0.55)',
}

const inp: React.CSSProperties = { width: '100%', padding: '7px 10px', border: `1px solid ${D.border}`, borderRadius: 5, fontSize: 12.5, background: '#fff', color: D.charcoal, outline: 'none', boxSizing: 'border-box' }
const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: D.charcoal, marginBottom: 3, display: 'block' }
const fieldVal: React.CSSProperties = { fontSize: 13, color: D.charcoal, marginTop: 2 }
const fieldMuted: React.CSSProperties = { fontSize: 13, color: D.muted, marginTop: 2 }

type TabId = 'profile' | 'appointments' | 'payments'

interface Appt {
  id: string
  appointment_date: string
  start_time: string
  duration_minutes: number
  status: string
  price_charged: number | null
  tip_amount: number
  deposit_paid: number
  payment_method: string | null
  services: { name: string; price: number }[] | null
  staff:    { name: string }[] | null
}

interface FieldDef {
  id: string; label: string; field_key: string
  field_type: 'text' | 'number' | 'date' | 'boolean' | 'select'
  options: string[] | null; is_required: boolean; sort_order: number
}

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  scheduled: { bg: '#1A6EAD12', text: '#1A6EAD', border: '#1A6EAD40' },
  completed:  { bg: '#2E7D5212', text: '#2E7D52', border: '#2E7D5240' },
  no_show:    { bg: '#B8740012', text: '#B87400', border: '#B8740040' },
  cancelled:  { bg: '#88888812', text: '#888888', border: '#88888840' },
}
const STATUS_LABELS: Record<string, string> = { scheduled: 'Scheduled', completed: 'Completed', no_show: 'No Show', cancelled: 'Cancelled' }

const CONTACT_LABELS: Record<string, string> = { whatsapp: 'WhatsApp', sms: 'SMS', call: 'Call', email: 'Email' }

function fmtPhone(p: string | null) {
  if (!p) return null
  const d = p.replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 11 && d[0] === '1') return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  return p
}
function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtTime(t: string) {
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}
function fmtMoney(n: number | null | undefined) {
  if (n == null) return '—'
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtBirthday(s: string | null) {
  if (!s) return null
  const [, m, d] = s.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[parseInt(m) - 1]} ${parseInt(d)}`
}

export default function ClientProfile({ customerId }: { customerId: string }) {
  const [customer,   setCustomer]   = useState<Customer | null>(null)
  const [appts,      setAppts]      = useState<Appt[]>([])
  const [fieldDefs,  setFieldDefs]  = useState<FieldDef[]>([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState('')
  const [tab,        setTab]        = useState<TabId>('profile')
  const [apptFilter, setApptFilter] = useState<string>('all')

  // Edit modal state
  const [editing,  setEditing]  = useState(false)
  const [editForm, setEditForm] = useState<Record<string, unknown>>({})
  const [saving,   setSaving]   = useState(false)
  const [formErr,  setFormErr]  = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [cRes, aRes, fRes] = await Promise.all([
        supabase.from('customers').select('*').eq('id', customerId).single(),
        supabase.from('appointments')
          .select('id, appointment_date, start_time, duration_minutes, status, price_charged, tip_amount, deposit_paid, payment_method, services(name, price), staff(name)')
          .eq('client_id', CLIENT_ID).eq('customer_id', customerId)
          .order('appointment_date', { ascending: false }).order('start_time', { ascending: false })
          .limit(500),
        supabase.from('customer_field_defs').select('*').eq('client_id', CLIENT_ID).eq('is_active', true).order('sort_order'),
      ])
      if (cRes.error) { setError('Client not found.'); return }
      setCustomer(cRes.data as Customer)
      setAppts(aRes.data ?? [])
      setFieldDefs((fRes.data ?? []) as FieldDef[])
    } finally { setLoading(false) }
  }, [customerId])

  useEffect(() => { load() }, [load])

  function openEdit() {
    if (!customer) return
    setEditForm({
      first_name: customer.first_name, middle_name: customer.middle_name ?? '',
      last_name: customer.last_name, birthday: customer.birthday ?? '',
      email: customer.email ?? '', phone: customer.phone ?? '',
      phone_whatsapp: customer.phone_whatsapp, phone_alt: customer.phone_alt ?? '',
      preferred_contact: customer.preferred_contact ?? 'whatsapp',
      preferred_language: customer.preferred_language ?? 'en',
      address_street: customer.address_street ?? '', address_city: customer.address_city ?? '',
      address_state: customer.address_state ?? '', address_zip: customer.address_zip ?? '',
      allergies: customer.allergies ?? '', preferences: customer.preferences ?? '',
      is_active: customer.is_active,
      ...Object.fromEntries(fieldDefs.map(f => [`cf_${f.field_key}`, String(customer.custom_fields?.[f.field_key] ?? '')])),
    })
    setFormErr(''); setEditing(true)
  }

  async function saveEdit() {
    if (!customer) return
    if (!String(editForm.first_name ?? '').trim()) { setFormErr('First name is required.'); return }
    if (!String(editForm.last_name ?? '').trim())  { setFormErr('Last name is required.'); return }
    setSaving(true); setFormErr('')
    const cf: Record<string, unknown> = {}
    fieldDefs.forEach(f => { const v = String(editForm[`cf_${f.field_key}`] ?? ''); if (v) cf[f.field_key] = v })
    const { error: err } = await supabase.from('customers').update({
      first_name: String(editForm.first_name).trim(), middle_name: String(editForm.middle_name).trim() || null,
      last_name: String(editForm.last_name).trim(), birthday: String(editForm.birthday) || null,
      email: String(editForm.email).trim() || null, phone: String(editForm.phone).trim() || null,
      phone_whatsapp: Boolean(editForm.phone_whatsapp), phone_alt: String(editForm.phone_alt).trim() || null,
      preferred_contact: String(editForm.preferred_contact) || null, preferred_language: String(editForm.preferred_language),
      address_street: String(editForm.address_street).trim() || null, address_city: String(editForm.address_city).trim() || null,
      address_state: String(editForm.address_state).trim() || null, address_zip: String(editForm.address_zip).trim() || null,
      allergies: String(editForm.allergies).trim() || null, preferences: String(editForm.preferences).trim() || null,
      is_active: Boolean(editForm.is_active), custom_fields: cf,
    }).eq('id', customer.id)
    setSaving(false)
    if (err) { setFormErr(err.message); return }
    setEditing(false); await load()
  }

  // Derived stats
  const completedAppts = appts.filter(a => a.status === 'completed')
  const totalCharged   = completedAppts.reduce((s, a) => s + (Number(a.price_charged) || 0), 0)
  const totalTips      = completedAppts.reduce((s, a) => s + (Number(a.tip_amount) || 0), 0)
  const totalDeposits  = appts.reduce((s, a) => s + (Number(a.deposit_paid) || 0), 0)
  const lastVisit      = completedAppts[0]?.appointment_date ?? null
  const upcoming       = appts.filter(a => a.status === 'scheduled').length

  const filteredAppts = apptFilter === 'all' ? appts : appts.filter(a => a.status === apptFilter)

  // Payment rows: one row per appointment that has any financial activity
  const paymentRows = appts.filter(a => Number(a.deposit_paid) > 0 || Number(a.price_charged) > 0)

  if (loading) return (
    <div style={{ padding: '48px 32px', background: D.page, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ color: D.muted, fontSize: 13 }}>Loading…</span>
    </div>
  )
  if (error || !customer) return (
    <div style={{ padding: '48px 32px', background: D.page, minHeight: '100vh' }}>
      <Link href="/clients" style={{ color: D.steel, fontSize: 12.5, textDecoration: 'none' }}>← Back to Clients</Link>
      <div style={{ marginTop: 24, color: D.red, fontSize: 13 }}>{error || 'Client not found.'}</div>
    </div>
  )

  const fullName = `${customer.first_name}${customer.middle_name ? ` ${customer.middle_name}` : ''} ${customer.last_name}`

  return (
    <div style={{ background: D.page, minHeight: '100vh' }}>

      {/* Header */}
      <div style={{ background: D.card, borderBottom: `1px solid ${D.border}`, padding: '16px 28px' }}>
        <Link href="/clients" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: D.muted, fontSize: 11.5, textDecoration: 'none', marginBottom: 12 }}>
          ← Clients
        </Link>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: D.charcoal }}>{fullName}</h1>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 3,
                background: customer.preferred_language === 'es' ? '#FDF6EC' : '#EEF4F1',
                color: customer.preferred_language === 'es' ? D.gold : D.sage,
                border: `1px solid ${customer.preferred_language === 'es' ? D.gold + '60' : D.sage + '40'}`,
              }}>{customer.preferred_language === 'es' ? 'ES' : 'EN'}</span>
              {!customer.is_active && <span style={{ fontSize: 10, color: D.muted, background: '#88888820', border: '1px solid #88888840', borderRadius: 3, padding: '2px 6px' }}>Inactive</span>}
              {customer.allergies && <span style={{ fontSize: 11, color: D.red, background: '#B9404012', border: `1px solid ${D.red}30`, borderRadius: 3, padding: '2px 7px' }}>⚠ Allergies</span>}
            </div>
            <div style={{ marginTop: 5, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {customer.phone && <span style={{ fontSize: 12, color: D.muted }}>{fmtPhone(customer.phone)}</span>}
              {customer.email && <span style={{ fontSize: 12, color: D.muted }}>{customer.email}</span>}
            </div>
          </div>

          {/* Quick stats */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {[
              { label: 'Appointments', value: appts.length },
              { label: 'Upcoming',     value: upcoming },
              { label: 'Total Paid',   value: fmtMoney(totalCharged + totalTips) },
              { label: 'Last Visit',   value: lastVisit ? fmtDate(lastVisit) : '—' },
            ].map(s => (
              <div key={s.label} style={{ background: D.page, border: `1px solid ${D.border}`, borderRadius: 6, padding: '7px 14px', textAlign: 'center', minWidth: 90 }}>
                <div style={{ fontSize: 10, color: D.muted, marginBottom: 1 }}>{s.label}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: D.charcoal }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, marginTop: 16, borderBottom: `1px solid ${D.border}`, marginBottom: -1 }}>
          {([['profile', 'Profile'], ['appointments', 'Appointments'], ['payments', 'Payments']] as [TabId, string][]).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{
              background: 'none', border: 'none', padding: '8px 18px', fontSize: 13, cursor: 'pointer',
              fontWeight: tab === id ? 600 : 400,
              color: tab === id ? D.sage : D.muted,
              borderBottom: tab === id ? `2px solid ${D.sage}` : '2px solid transparent',
              marginBottom: -1,
            }}>{label}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: '24px 28px' }}>

        {/* ── Profile tab ─────────────────────────────────────────────────── */}
        {tab === 'profile' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

            {/* Contact card */}
            <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 8, padding: '18px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: D.muted, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Contact</span>
                <button onClick={openEdit} style={{ background: D.sage, color: '#fff', border: 'none', borderRadius: 5, padding: '4px 12px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>Edit Profile</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px' }}>
                <Field label="Phone" value={fmtPhone(customer.phone) ?? '—'} />
                <Field label="Alt Phone" value={fmtPhone(customer.phone_alt) ?? '—'} />
                <Field label="Email" value={customer.email ?? '—'} />
                <Field label="Birthday" value={fmtBirthday(customer.birthday) ?? '—'} />
                <Field label="Preferred Contact" value={CONTACT_LABELS[customer.preferred_contact ?? ''] ?? customer.preferred_contact ?? '—'} />
                <Field label="Language" value={customer.preferred_language === 'es' ? 'Español' : 'English'} />
              </div>
            </div>

            {/* Address card */}
            <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 8, padding: '18px 20px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: D.muted, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 14 }}>Address</div>
              {customer.address_street || customer.address_city ? (
                <div style={{ fontSize: 13, color: D.charcoal, lineHeight: 1.7 }}>
                  {customer.address_street && <div>{customer.address_street}</div>}
                  {(customer.address_city || customer.address_state || customer.address_zip) && (
                    <div>{[customer.address_city, customer.address_state, customer.address_zip].filter(Boolean).join(', ')}</div>
                  )}
                </div>
              ) : <div style={fieldMuted}>No address on file</div>}
            </div>

            {/* Health & Preferences card */}
            <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 8, padding: '18px 20px', gridColumn: '1 / -1' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: D.muted, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 14 }}>Health &amp; Preferences</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 40px' }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: customer.allergies ? D.red : D.muted, marginBottom: 3 }}>
                    {customer.allergies ? '⚠ Allergies / Sensitivities' : 'Allergies / Sensitivities'}
                  </div>
                  <div style={{ ...fieldVal, color: customer.allergies ? D.charcoal : D.muted }}>
                    {customer.allergies ?? 'None noted'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: D.muted, marginBottom: 3 }}>Standing Preferences</div>
                  <div style={{ ...fieldVal, color: customer.preferences ? D.charcoal : D.muted, lineHeight: 1.5 }}>
                    {customer.preferences ?? '—'}
                  </div>
                </div>
              </div>
            </div>

            {/* Custom fields card */}
            {fieldDefs.length > 0 && (
              <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 8, padding: '18px 20px', gridColumn: '1 / -1' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: D.muted, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 14 }}>Additional Info</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px 24px' }}>
                  {fieldDefs.map(fd => {
                    const raw = customer.custom_fields?.[fd.field_key]
                    const val = raw != null && raw !== '' ? (fd.field_type === 'boolean' ? (raw ? 'Yes' : 'No') : String(raw)) : null
                    return <Field key={fd.field_key} label={fd.label} value={val ?? '—'} />
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Appointments tab ────────────────────────────────────────────── */}
        {tab === 'appointments' && (
          <>
            {/* Stats */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
              {[
                { label: 'Total',     value: appts.length },
                { label: 'Completed', value: completedAppts.length },
                { label: 'Upcoming',  value: upcoming },
                { label: 'No Shows',  value: appts.filter(a => a.status === 'no_show').length },
              ].map(s => (
                <div key={s.label} style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 7, padding: '8px 16px' }}>
                  <div style={{ fontSize: 10, color: D.muted, marginBottom: 1 }}>{s.label}</div>
                  <div style={{ fontSize: 17, fontWeight: 700, color: D.charcoal }}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Filter */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
              {(['all', 'scheduled', 'completed', 'no_show', 'cancelled'] as const).map(s => (
                <button key={s} onClick={() => setApptFilter(s)} style={{
                  background: apptFilter === s ? D.charcoal : 'transparent',
                  color: apptFilter === s ? '#fff' : D.muted,
                  border: `1px solid ${apptFilter === s ? D.charcoal : D.border}`,
                  borderRadius: 5, padding: '4px 10px', fontSize: 11.5,
                  fontWeight: apptFilter === s ? 600 : 400, cursor: 'pointer',
                }}>
                  {s === 'all' ? 'All' : STATUS_LABELS[s]}
                </button>
              ))}
            </div>

            <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 8, overflow: 'hidden' }}>
              {filteredAppts.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: D.muted, fontSize: 13 }}>No appointments{apptFilter !== 'all' ? ` with status "${STATUS_LABELS[apptFilter]}"` : ''} on record.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ background: '#F0EBE0', borderBottom: `1px solid ${D.border}` }}>
                      {['Date', 'Time', 'Service', 'Provider', 'Status', 'Deposit', 'Charged', 'Tip'].map(h => (
                        <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontWeight: 600, color: D.charcoal, fontSize: 11, whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAppts.map((a, i) => {
                      const sc = STATUS_COLORS[a.status] ?? STATUS_COLORS.scheduled
                      return (
                        <tr key={a.id} style={{ borderBottom: i < filteredAppts.length - 1 ? `1px solid ${D.border}` : 'none', background: i % 2 === 0 ? D.card : '#F7F4EE' }}>
                          <td style={{ padding: '9px 14px', whiteSpace: 'nowrap', color: D.charcoal }}>{fmtDate(a.appointment_date)}</td>
                          <td style={{ padding: '9px 14px', whiteSpace: 'nowrap', color: D.muted }}>{fmtTime(a.start_time)}</td>
                          <td style={{ padding: '9px 14px', color: D.charcoal, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.services?.[0]?.name ?? '—'}</td>
                          <td style={{ padding: '9px 14px', color: D.muted, whiteSpace: 'nowrap' }}>{a.staff?.[0]?.name ?? '—'}</td>
                          <td style={{ padding: '9px 14px' }}>
                            <span style={{ background: sc.bg, color: sc.text, border: `1px solid ${sc.border}`, borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 500 }}>
                              {STATUS_LABELS[a.status] ?? a.status}
                            </span>
                          </td>
                          <td style={{ padding: '9px 14px', color: Number(a.deposit_paid) > 0 ? D.charcoal : D.muted, whiteSpace: 'nowrap' }}>{Number(a.deposit_paid) > 0 ? fmtMoney(a.deposit_paid) : '—'}</td>
                          <td style={{ padding: '9px 14px', color: a.price_charged != null ? D.charcoal : D.muted, whiteSpace: 'nowrap' }}>{fmtMoney(a.price_charged)}</td>
                          <td style={{ padding: '9px 14px', color: Number(a.tip_amount) > 0 ? D.charcoal : D.muted, whiteSpace: 'nowrap' }}>{Number(a.tip_amount) > 0 ? fmtMoney(a.tip_amount) : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

        {/* ── Payments tab ────────────────────────────────────────────────── */}
        {tab === 'payments' && (
          <>
            {/* Stats */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
              {[
                { label: 'Total Deposits',  value: fmtMoney(totalDeposits) },
                { label: 'Total Charged',   value: fmtMoney(totalCharged) },
                { label: 'Total Tips',      value: fmtMoney(totalTips) },
                { label: 'Grand Total',     value: fmtMoney(totalCharged + totalTips) },
              ].map(s => (
                <div key={s.label} style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 7, padding: '8px 16px' }}>
                  <div style={{ fontSize: 10, color: D.muted, marginBottom: 1 }}>{s.label}</div>
                  <div style={{ fontSize: 17, fontWeight: 700, color: D.charcoal }}>{s.value}</div>
                </div>
              ))}
            </div>

            <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 8, overflow: 'hidden' }}>
              {paymentRows.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: D.muted, fontSize: 13 }}>No payment records yet.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ background: '#F0EBE0', borderBottom: `1px solid ${D.border}` }}>
                      {['Date', 'Service', 'Provider', 'Deposit', 'Charged', 'Tip', 'Total', 'Method'].map(h => (
                        <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontWeight: 600, color: D.charcoal, fontSize: 11, whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {paymentRows.map((a, i) => {
                      const total = (Number(a.price_charged) || 0) + (Number(a.tip_amount) || 0)
                      return (
                        <tr key={a.id} style={{ borderBottom: i < paymentRows.length - 1 ? `1px solid ${D.border}` : 'none', background: i % 2 === 0 ? D.card : '#F7F4EE' }}>
                          <td style={{ padding: '9px 14px', whiteSpace: 'nowrap', color: D.charcoal }}>{fmtDate(a.appointment_date)}</td>
                          <td style={{ padding: '9px 14px', color: D.charcoal, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.services?.[0]?.name ?? '—'}</td>
                          <td style={{ padding: '9px 14px', color: D.muted, whiteSpace: 'nowrap' }}>{a.staff?.[0]?.name ?? '—'}</td>
                          <td style={{ padding: '9px 14px', color: Number(a.deposit_paid) > 0 ? D.charcoal : D.muted, whiteSpace: 'nowrap' }}>{Number(a.deposit_paid) > 0 ? fmtMoney(a.deposit_paid) : '—'}</td>
                          <td style={{ padding: '9px 14px', color: a.price_charged != null ? D.charcoal : D.muted, whiteSpace: 'nowrap' }}>{fmtMoney(a.price_charged)}</td>
                          <td style={{ padding: '9px 14px', color: Number(a.tip_amount) > 0 ? D.charcoal : D.muted, whiteSpace: 'nowrap' }}>{Number(a.tip_amount) > 0 ? fmtMoney(a.tip_amount) : '—'}</td>
                          <td style={{ padding: '9px 14px', fontWeight: 600, color: D.charcoal, whiteSpace: 'nowrap' }}>{total > 0 ? fmtMoney(total) : '—'}</td>
                          <td style={{ padding: '9px 14px', color: D.muted, fontSize: 11.5, whiteSpace: 'nowrap', textTransform: 'capitalize' }}>{a.payment_method ?? '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#F0EBE0', borderTop: `1px solid ${D.border}` }}>
                      <td colSpan={3} style={{ padding: '9px 14px', fontWeight: 600, color: D.charcoal, fontSize: 11.5 }}>Totals</td>
                      <td style={{ padding: '9px 14px', fontWeight: 600, color: D.charcoal, whiteSpace: 'nowrap' }}>{fmtMoney(totalDeposits)}</td>
                      <td style={{ padding: '9px 14px', fontWeight: 600, color: D.charcoal, whiteSpace: 'nowrap' }}>{fmtMoney(totalCharged)}</td>
                      <td style={{ padding: '9px 14px', fontWeight: 600, color: D.charcoal, whiteSpace: 'nowrap' }}>{fmtMoney(totalTips)}</td>
                      <td style={{ padding: '9px 14px', fontWeight: 700, color: D.sage, whiteSpace: 'nowrap' }}>{fmtMoney(totalCharged + totalTips)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </>
        )}
      </div>

      {/* Edit modal */}
      {editing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={e => { if (e.target === e.currentTarget) setEditing(false) }}>
          <div style={{ background: '#fff', borderRadius: 10, padding: '26px 26px 20px', width: 560, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: D.charcoal, margin: '0 0 20px' }}>Edit Client</h2>
            <EditForm form={editForm} setForm={setEditForm} fieldDefs={fieldDefs} />
            {formErr && <div style={{ fontSize: 11.5, color: D.red, marginTop: 12, padding: '6px 10px', background: '#FEF2F2', borderRadius: 4 }}>{formErr}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button onClick={() => setEditing(false)} style={{ background: 'none', border: `1px solid ${D.border}`, borderRadius: 5, padding: '7px 16px', fontSize: 12.5, cursor: 'pointer', color: D.charcoal }}>Cancel</button>
              <button onClick={saveEdit} disabled={saving} style={{ background: D.sage, color: '#fff', border: 'none', borderRadius: 5, padding: '7px 18px', fontSize: 12.5, fontWeight: 600, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1 }}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: D.muted, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: value === '—' ? D.muted : D.charcoal }}>{value}</div>
    </div>
  )
}

function EditForm({ form, setForm, fieldDefs }: { form: Record<string, unknown>; setForm: React.Dispatch<React.SetStateAction<Record<string, unknown>>>; fieldDefs: FieldDef[] }) {
  const f = (key: string) => String(form[key] ?? '')
  const set = (key: string, val: unknown) => setForm(p => ({ ...p, [key]: val }))
  const sectionHead: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: D.muted, textTransform: 'uppercase', letterSpacing: '0.8px', gridColumn: '1 / -1', marginTop: 6, paddingBottom: 6, borderBottom: `1px solid ${D.border}` }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px' }}>
      <div style={sectionHead}>Name</div>
      <div><label style={lbl}>First Name <span style={{ color: D.red }}>*</span></label><input style={inp} value={f('first_name')} onChange={e => set('first_name', e.target.value)} /></div>
      <div><label style={lbl}>Middle Name</label><input style={inp} value={f('middle_name')} onChange={e => set('middle_name', e.target.value)} /></div>
      <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>Last Name <span style={{ color: D.red }}>*</span></label><input style={inp} value={f('last_name')} onChange={e => set('last_name', e.target.value)} /></div>

      <div style={sectionHead}>Contact</div>
      <div>
        <label style={lbl}>Phone</label>
        <input style={inp} value={f('phone')} onChange={e => set('phone', e.target.value)} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 12, color: D.charcoal, cursor: 'pointer' }}>
          <input type="checkbox" checked={Boolean(form.phone_whatsapp)} onChange={e => set('phone_whatsapp', e.target.checked)} /> On WhatsApp
        </label>
      </div>
      <div><label style={lbl}>Phone (Alt)</label><input style={inp} value={f('phone_alt')} onChange={e => set('phone_alt', e.target.value)} /></div>
      <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>Email</label><input style={inp} type="email" value={f('email')} onChange={e => set('email', e.target.value)} /></div>
      <div>
        <label style={lbl}>Preferred Contact</label>
        <select style={inp} value={f('preferred_contact')} onChange={e => set('preferred_contact', e.target.value)}>
          <option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="call">Call</option><option value="email">Email</option>
        </select>
      </div>
      <div>
        <label style={lbl}>Preferred Language</label>
        <select style={inp} value={f('preferred_language')} onChange={e => set('preferred_language', e.target.value)}>
          <option value="en">English</option><option value="es">Español</option>
        </select>
      </div>

      <div style={sectionHead}>Address</div>
      <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>Street</label><input style={inp} value={f('address_street')} onChange={e => set('address_street', e.target.value)} /></div>
      <div><label style={lbl}>City</label><input style={inp} value={f('address_city')} onChange={e => set('address_city', e.target.value)} /></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div><label style={lbl}>State</label><input style={inp} value={f('address_state')} onChange={e => set('address_state', e.target.value)} maxLength={2} /></div>
        <div><label style={lbl}>ZIP</label><input style={inp} value={f('address_zip')} onChange={e => set('address_zip', e.target.value)} /></div>
      </div>

      <div style={sectionHead}>Health &amp; Preferences</div>
      <div><label style={lbl}>Birthday</label><input style={inp} type="date" value={f('birthday')} onChange={e => set('birthday', e.target.value)} /></div>
      <div style={{ gridColumn: '1 / -1' }}>
        <label style={{ ...lbl, color: D.red }}>Allergies / Sensitivities</label>
        <input style={{ ...inp, borderColor: f('allergies') ? D.red + '80' : D.border }} value={f('allergies')} onChange={e => set('allergies', e.target.value)} placeholder="e.g. lavender oil, nut oils" />
      </div>
      <div style={{ gridColumn: '1 / -1' }}>
        <label style={lbl}>Standing Preferences</label>
        <textarea style={{ ...inp, height: 64, resize: 'vertical' }} value={f('preferences')} onChange={e => set('preferences', e.target.value)} />
      </div>

      {fieldDefs.length > 0 && <div style={sectionHead}>Additional Info</div>}
      {fieldDefs.map(fd => (
        <div key={fd.field_key}>
          <label style={lbl}>{fd.label}</label>
          {fd.field_type === 'boolean' ? (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
              <input type="checkbox" checked={form[`cf_${fd.field_key}`] === 'true'} onChange={e => set(`cf_${fd.field_key}`, String(e.target.checked))} /> Yes
            </label>
          ) : fd.field_type === 'select' ? (
            <select style={inp} value={String(form[`cf_${fd.field_key}`] ?? '')} onChange={e => set(`cf_${fd.field_key}`, e.target.value)}>
              <option value="">— select —</option>
              {(fd.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input style={inp} type={fd.field_type === 'number' ? 'number' : fd.field_type === 'date' ? 'date' : 'text'} value={String(form[`cf_${fd.field_key}`] ?? '')} onChange={e => set(`cf_${fd.field_key}`, e.target.value)} />
          )}
        </div>
      ))}

      <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
        <input type="checkbox" id="edit-active" checked={Boolean(form.is_active)} onChange={e => set('is_active', e.target.checked)} />
        <label htmlFor="edit-active" style={{ fontSize: 12.5, color: D.charcoal }}>Active</label>
      </div>
    </div>
  )
}
