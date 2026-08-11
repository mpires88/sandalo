'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { CLIENT_ID } from '@/constants'
import { useLanguage } from '@/lib/language'
import { usePermissions } from '@/lib/usePermissions'

const D = {
  sage: '#2C5F52', gold: '#C8A96E', charcoal: '#4A4A3F',
  page: '#F5F0E8', card: '#FAFAF8', border: '#D9D4C8',
  red: '#B94040', green: '#2E7D52',
  muted: 'rgba(74,74,63,0.55)',
}

function TimeSelect({ value, onChange, style, after }: { value: string; onChange: (v: string) => void; style?: React.CSSProperties; after?: string }) {
  const normalized = value ? value.slice(0, 5) : ''
  const min = after ? after.slice(0, 5) : null
  const slots: string[] = []
  for (let h = 0; h < 24; h++)
    for (let m = 0; m < 60; m += 15) {
      const s = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
      if (!min || s > min) slots.push(s)
    }
  return (
    <select value={normalized} onChange={e => onChange(e.target.value)} style={style}>
      <option value="">— Select —</option>
      {slots.map(s => {
        const [h, m] = s.split(':').map(Number)
        const ampm = h < 12 ? 'AM' : 'PM'
        const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
        return <option key={s} value={s}>{`${h12}:${String(m).padStart(2, '0')} ${ampm}`}</option>
      })}
    </select>
  )
}

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string; solid: string }> = {
  scheduled: { bg: '#1A6EAD12', text: '#1A6EAD', border: '#1A6EAD40', solid: '#1A6EAD' },
  checked_in: { bg: '#0E7C7B14', text: '#0E7C7B', border: '#0E7C7B45', solid: '#0E7C7B' },
  completed:  { bg: '#2E7D5212', text: '#2E7D52', border: '#2E7D5240', solid: '#2E7D52' },
  no_show:    { bg: '#B8740012', text: '#B87400', border: '#B8740040', solid: '#B87400' },
  cancelled:  { bg: '#88888812', text: '#888888', border: '#88888840', solid: '#888888' },
}

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Scheduled', checked_in: 'Checked In', completed: 'Completed',
  no_show: 'No Show', cancelled: 'Cancelled',
}
const STATUS_LABELS_ES: Record<string, string> = {
  scheduled: 'Programado', checked_in: 'Registrado', completed: 'Completado',
  no_show: 'No Apareció', cancelled: 'Cancelado',
}

// Fallback labels for codes that predate the payment_methods table
const PAYMENT_LABELS_FALLBACK: Record<string, string> = {
  square: 'Square', cash: 'Cash', insurance: 'Insurance', other: 'Other',
}

// Day view grid constants
const TIME_COL_W       = 52   // px for the time label column
const COL_MIN_W        = 168  // min px per staff column
const SLOT_H           = 56   // comfortable: px per 30-min slot (= 112px/hour)
const SLOT_H_COMPACT   = 28   // compact: px per 30-min slot (= 56px/hour)
const DAY_START  = 8    // 8 AM
const DAY_END    = 21   // 9 PM

const TIME_SLOTS = (() => {
  const slots: { minutes: number; label: string; isHour: boolean }[] = []
  for (let m = DAY_START * 60; m < DAY_END * 60; m += 30) {
    const h = Math.floor(m / 60), min = m % 60
    const isHour = min === 0
    const h12 = h % 12 || 12
    slots.push({ minutes: m, label: isHour ? `${h12}${h >= 12 ? 'pm' : 'am'}` : '', isHour })
  }
  return slots
})()

function timeToPx(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return ((h * 60 + m - DAY_START * 60) / 30) * SLOT_H
}
function durationToPx(min: number): number { return (min / 30) * SLOT_H }

type ApptStatus = 'scheduled' | 'checked_in' | 'completed' | 'no_show' | 'cancelled'
type ViewMode   = 'calendar' | 'day' | 'log'

interface Appt {
  id: string; customer_id: string; staff_id: string; service_id: string
  appointment_date: string; start_time: string; duration_minutes: number
  status: ApptStatus; group_id: string | null
  price_charged: number | null; tip_amount: number; deposit_paid: number
  payment_method: string | null; square_transaction_id: string | null; notes: string | null
  checked_in_at?: string | null; checked_out_at?: string | null
  customers: { first_name: string; middle_name: string | null; last_name: string } | null
  services:  { name: string; price: number; duration_minutes: number } | null
  staff:     { name: string } | null
}

interface BillLine { label: string; amount: number }

interface Customer { id: string; first_name: string; middle_name: string | null; last_name: string }
interface Service  { id: string; name: string; price: number; duration_minutes: number; buffer_before_minutes: number; buffer_after_minutes: number; category: string; category_id: string | null; resource_id: string | null; staff_count: number; customer_count: number }
interface ServiceAddon { id: string; name: string; price: number; duration_minutes: number }
interface StaffRow     { id: string; name: string; status: string }
interface Resource     { id: string; name: string; quantity: number }
interface PaymentMethod { id: string; name: string; code: string; sort_order: number }

interface ApptForm {
  id?: string
  customer_id: string; staff_id: string; service_id: string; resource_id: string
  appointment_date: string; start_time: string; duration_minutes: string
  status: ApptStatus
  price_charged: string; tip_amount: string; deposit_paid: string
  payment_method: string; square_transaction_id: string; notes: string
  // Multi-party (couples / group bookings)
  extra_customers: string[]
  extra_staff: string[]
  group_id?: string
  addonIds: string[]
}

interface TimeBlock {
  id: string; staff_id: string; block_date: string
  start_time: string; end_time: string; label: string; notes: string | null
}
interface BlockForm {
  id?: string; staff_id: string; block_date: string
  start_time: string; end_time: string; label: string; notes: string
}

interface FindTimeCtx {
  customer_id: string; service_id: string; staff_id: string
  duration_minutes: number; customerName: string; serviceName: string
}

const BLANK: ApptForm = {
  customer_id: '', staff_id: '', service_id: '', resource_id: '',
  appointment_date: '', start_time: '', duration_minutes: '',
  status: 'scheduled',
  price_charged: '', tip_amount: '0', deposit_paid: '0',
  payment_method: 'square', square_transaction_id: '', notes: '',
  extra_customers: [], extra_staff: [],
  addonIds: [],
}

// Is an appointment's start in the past (relative to now)?
function isPastAppt(date: string, startTime: string): boolean {
  if (!date || !startTime) return false
  const [h, m] = startTime.split(':').map(Number)
  const dt = new Date(date + 'T00:00:00')
  dt.setHours(h, m, 0, 0)
  return dt.getTime() <= Date.now()
}

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}
function fmtDateLong(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })
}
function fmtTime(t: string) {
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}
function fmtMoney(n: number | null | undefined) {
  if (n == null) return '—'
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function custName(c: Appt['customers']) {
  if (!c) return '—'
  return `${c.first_name}${c.middle_name ? ` ${c.middle_name[0]}.` : ''} ${c.last_name}`
}
function custShort(c: Appt['customers']) {
  if (!c) return '—'
  return `${c.first_name} ${c.last_name[0]}.`
}
// Format a Date as YYYY-MM-DD in *local* time — toISOString() converts to UTC,
// which shifts the calendar day near midnight (e.g. evenings in US timezones)
function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function isoToday() { return isoDate(new Date()) }
function addDays(iso: string, n: number) {
  const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n)
  return isoDate(d)
}

export default function Appointments() {
  const { t, lang } = useLanguage()
  const { can } = usePermissions()
  const canWrite = can('appointments', 'write')

  const [month,    setMonth]    = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1) })
  const [view,     setView]     = useState<ViewMode>('day')
  const [statusFilter, setStatusFilter] = useState<ApptStatus | 'all'>('all')
  const [staffFilter,  setStaffFilter]  = useState('all')
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [dayDate,  setDayDate]  = useState(isoToday)

  const [allAppts,  setAllAppts]  = useState<Appt[]>([])
  const [dayAppts,  setDayAppts]  = useState<Appt[]>([])
  const [customers,  setCustomers]  = useState<Customer[]>([])
  const [services,   setServices]   = useState<Service[]>([])
  const [staffList,  setStaffList]  = useState<StaffRow[]>([])
  const [resources,       setResources]       = useState<Resource[]>([])
  const [paymentMethods,  setPaymentMethods]  = useState<PaymentMethod[]>([])
  const [loading,   setLoading]   = useState(true)
  const [dayLoading,setDayLoading]= useState(false)
  const [error,     setError]     = useState('')

  const [modal,   setModal]   = useState(false)
  const [form,    setForm]    = useState<ApptForm>({ ...BLANK })
  const [saving,  setSaving]  = useState(false)
  const [formErr, setFormErr] = useState('')
  const [dblBookWarn, setDblBookWarn] = useState<string | null>(null)

  const [editingAppt,   setEditingAppt]   = useState<Appt | null>(null)
  const [addons,        setAddons]        = useState<ServiceAddon[]>([])
  const [addonCatMap,   setAddonCatMap]   = useState<Map<string, Set<string>>>(new Map())

  // Visit details (shown right after Check In)
  const [visitAppt,   setVisitAppt]   = useState<Appt | null>(null)
  const [visitAddons, setVisitAddons] = useState<ServiceAddon[]>([])

  // Checkout / bill (the ticket shown at Check Out)
  const [billAppt,    setBillAppt]    = useState<Appt | null>(null)
  const [billLines,   setBillLines]   = useState<BillLine[]>([])
  const [billTip,     setBillTip]     = useState('0')
  const [billPayment, setBillPayment] = useState('square')
  const [billNotes,   setBillNotes]   = useState('')
  const [billSaving,  setBillSaving]  = useState(false)

  const [findTime, setFindTime] = useState<FindTimeCtx | null>(null)

  const [dayBlocks,        setDayBlocks]        = useState<TimeBlock[]>([])
  const [blockModal,       setBlockModal]       = useState(false)
  const [blockForm,        setBlockForm]        = useState<BlockForm>({ staff_id: '', block_date: '', start_time: '', end_time: '', label: 'Blocked', notes: '' })
  const [blockSaving,      setBlockSaving]      = useState(false)
  const [blockErr,         setBlockErr]         = useState('')
  const [confirmDelBlock,  setConfirmDelBlock]  = useState<TimeBlock | null>(null)
  const [deletingBlock,    setDeletingBlock]    = useState(false)
  const [bizHours,         setBizHours]         = useState<Record<number, { open_time: string; close_time: string; is_open: boolean }>>({})

  useEffect(() => {
    supabase.from('business_hours').select('day_of_week,is_open,open_time,close_time').eq('client_id', CLIENT_ID)
      .then(({ data }) => {
        if (!data) return
        const map: Record<number, { open_time: string; close_time: string; is_open: boolean }> = {}
        data.forEach((r: { day_of_week: number; is_open: boolean; open_time: string; close_time: string }) => {
          map[r.day_of_week] = { is_open: r.is_open, open_time: (r.open_time ?? '').slice(0, 5), close_time: (r.close_time ?? '').slice(0, 5) }
        })
        setBizHours(map)
      })
  }, [])
  const [dayDensity, setDayDensity] = useState<'comfortable' | 'compact'>('compact')

  // Current time for the "now" indicator in day view
  const [nowMinutes, setNowMinutes] = useState(() => { const n = new Date(); return n.getHours() * 60 + n.getMinutes() })
  const nowRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  useEffect(() => {
    if (view === 'day') {
      nowRef.current = setInterval(() => {
        const n = new Date(); setNowMinutes(n.getHours() * 60 + n.getMinutes())
      }, 60000)
    }
    return () => clearInterval(nowRef.current)
  }, [view])

  const loadRef = useCallback(async () => {
    const [cRes, sRes, stRes, rRes, pmRes, aRes, acRes] = await Promise.all([
      supabase.from('customers').select('id, first_name, middle_name, last_name')
        .eq('client_id', CLIENT_ID).eq('is_active', true).order('last_name').limit(1000),
      supabase.from('services').select('id, name, price, duration_minutes, buffer_before_minutes, buffer_after_minutes, category, category_id, resource_id, staff_count, customer_count')
        .eq('client_id', CLIENT_ID).eq('is_active', true).order('sort_order'),
      supabase.from('staff').select('id, name, status')
        .eq('client_id', CLIENT_ID).order('name'),
      supabase.from('resources').select('id, name, quantity')
        .eq('client_id', CLIENT_ID).order('name'),
      supabase.from('payment_methods').select('id, name, code, sort_order')
        .eq('client_id', CLIENT_ID).eq('is_active', true).order('sort_order'),
      supabase.from('service_addons').select('id, name, price, duration_minutes')
        .eq('client_id', CLIENT_ID).eq('is_active', true).order('sort_order').order('name'),
      supabase.from('service_addon_categories').select('addon_id, category_id'),
    ])
    setCustomers(cRes.data ?? [])
    setServices(sRes.data ?? [])
    setStaffList(stRes.data ?? [])
    setResources(rRes.data ?? [])
    setPaymentMethods(pmRes.data ?? [])
    setAddons(aRes.data ?? [])
    const m = new Map<string, Set<string>>()
    ;(acRes.data ?? []).forEach((r: { addon_id: string; category_id: string }) => {
      if (!m.has(r.addon_id)) m.set(r.addon_id, new Set())
      m.get(r.addon_id)!.add(r.category_id)
    })
    setAddonCatMap(m)
  }, [])

  // Add-ons available for a given service: those with no category restriction,
  // or restricted to the service's category.
  const addonsForService = useCallback((serviceId: string): ServiceAddon[] => {
    const svc = services.find(s => s.id === serviceId)
    const catId = svc?.category_id ?? null
    return addons.filter(a => {
      const cats = addonCatMap.get(a.id)
      if (!cats || cats.size === 0) return true        // applies to all services
      return catId != null && cats.has(catId)
    })
  }, [services, addons, addonCatMap])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const start = isoDate(month)
      const end   = isoDate(new Date(month.getFullYear(), month.getMonth() + 1, 0))
      const { data, error: err } = await supabase
        .from('appointments')
        .select('*, customers(first_name, middle_name, last_name), services(name, price, duration_minutes), staff(name)')
        .eq('client_id', CLIENT_ID)
        .gte('appointment_date', start).lte('appointment_date', end)
        .order('appointment_date', { ascending: false })
        .order('start_time', { ascending: false })
        .limit(500)
      if (err) { setError(err.message); return }
      setAllAppts(data ?? [])
    } finally { setLoading(false) }
  }, [month])

  const loadDayBlocks = useCallback(async () => {
    const { data } = await supabase
      .from('time_blocks')
      .select('id, staff_id, block_date, start_time, end_time, label, notes')
      .eq('client_id', CLIENT_ID)
      .eq('block_date', dayDate)
      .order('start_time')
      .limit(200)
    setDayBlocks(data ?? [])
  }, [dayDate])

  const loadDay = useCallback(async () => {
    setDayLoading(true)
    try {
      const { data, error: err } = await supabase
        .from('appointments')
        .select('*, customers(first_name, middle_name, last_name), services(name, price, duration_minutes), staff(name)')
        .eq('client_id', CLIENT_ID)
        .eq('appointment_date', dayDate)
        .order('start_time')
        .limit(200)
      if (!err) setDayAppts(data ?? [])
    } finally { setDayLoading(false) }
  }, [dayDate])

  useEffect(() => { loadRef() }, [loadRef])
  // The month query (with embeds, up to 500 rows) only feeds the calendar/log views and
  // the stats bar — none of which render in day view. Defer it until one of those is active.
  useEffect(() => { if (view !== 'day') load() }, [load, view])
  useEffect(() => { if (view === 'day') { loadDay(); loadDayBlocks() } }, [view, loadDay, loadDayBlocks])
  useEffect(() => { setSelectedDate(null) }, [month])

  function switchToDay(date?: string) {
    if (date) setDayDate(date)
    setView('day')
  }

  // Month calendar helpers
  const byDate: Record<string, Appt[]> = {}
  for (const a of allAppts) {
    if (!byDate[a.appointment_date]) byDate[a.appointment_date] = []
    byDate[a.appointment_date].push(a)
  }
  for (const d of Object.keys(byDate)) byDate[d].sort((a, b) => a.start_time.localeCompare(b.start_time))

  const filtered = allAppts
    .filter(a => statusFilter === 'all' || a.status === statusFilter)
    .filter(a => staffFilter  === 'all' || a.staff_id  === staffFilter)

  const completedAppts = allAppts.filter(a => a.status === 'completed')
  const revenue = completedAppts.reduce((s, a) => s + (Number(a.price_charged) || 0) + (Number(a.tip_amount) || 0), 0)

  const isCurrentMonth = (() => { const n = new Date(); return month.getFullYear() === n.getFullYear() && month.getMonth() === n.getMonth() })()
  const monthLabel = month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const today = isoToday()

  // An existing appointment whose start is already in the past cannot be rescheduled
  const apptIsPast = !!form.id && editingAppt != null && isPastAppt(editingAppt.appointment_date, editingAppt.start_time.slice(0, 5))

  function openAdd(date?: string, staffId?: string, startTime?: string) {
    setEditingAppt(null)
    setForm({ ...BLANK, appointment_date: date ?? today, staff_id: staffId ?? '', start_time: startTime ?? '' })
    setFormErr(''); setDblBookWarn(null); setModal(true)
  }
  async function openEdit(a: Appt) {
    const svc = services.find(s => s.id === a.service_id)
    setEditingAppt(a)
    setForm({
      id: a.id, customer_id: a.customer_id, staff_id: a.staff_id, service_id: a.service_id,
      resource_id: svc?.resource_id ?? '',
      appointment_date: a.appointment_date, start_time: a.start_time.slice(0, 5),
      duration_minutes: String(a.duration_minutes), status: a.status,
      price_charged: a.price_charged != null ? String(a.price_charged) : '',
      tip_amount: String(a.tip_amount ?? 0), deposit_paid: String(a.deposit_paid ?? 0),
      payment_method: a.payment_method ?? '', square_transaction_id: a.square_transaction_id ?? '',
      notes: a.notes ?? '',
      extra_customers: [], extra_staff: [],
      group_id: a.group_id ?? undefined,
      addonIds: [],
    })
    setFormErr(''); setDblBookWarn(null); setModal(true)
    // Load existing add-ons for this appointment
    const { data } = await supabase.from('appointment_addons').select('addon_id').eq('appointment_id', a.id)
    setForm(f => f.id === a.id ? { ...f, addonIds: (data ?? []).map((r: { addon_id: string }) => r.addon_id) } : f)
  }
  function startFindTime() {
    const customer = customers.find(c => c.id === form.customer_id)
    const service  = services.find(s => s.id === form.service_id)
    setFindTime({
      customer_id: form.customer_id,
      service_id: form.service_id,
      staff_id: form.staff_id,
      duration_minutes: parseInt(form.duration_minutes) || 60,
      customerName: customer ? `${customer.first_name} ${customer.last_name[0]}.` : '',
      serviceName: service?.name ?? '',
    })
    setModal(false)
    setView('day')
  }

  function onServiceChange(id: string) {
    const svc = services.find(s => s.id === id)
    const extraStaff = svc ? Array(Math.max(0, svc.staff_count - 1)).fill('') : []
    const extraCust  = svc ? Array(Math.max(0, svc.customer_count - 1)).fill('') : []
    setForm(f => ({
      ...f, service_id: id,
      duration_minutes: svc ? String(svc.duration_minutes) : f.duration_minutes,
      price_charged: svc ? String(svc.price) : f.price_charged,
      resource_id: svc?.resource_id ?? '',
      extra_staff: extraStaff,
      extra_customers: extraCust,
    }))
  }
  async function save(force = false) {
    if (!form.customer_id)      { setFormErr(t('Select a customer.', 'Seleccione un cliente.')); return }
    if (!form.service_id)       { setFormErr(t('Select a service.', 'Seleccione un servicio.')); return }
    if (!form.staff_id)         { setFormErr(t('Select a provider.', 'Seleccione un proveedor.')); return }
    if (!form.appointment_date) { setFormErr(t('Date is required.', 'La fecha es requerida.')); return }
    if (!form.start_time)       { setFormErr(t('Time is required.', 'La hora es requerida.')); return }
    setSaving(true); setFormErr(''); setDblBookWarn(null)
    try {
      const durMin   = parseInt(form.duration_minutes) || 60
      if (durMin <= 0) { setFormErr(t('Duration must be a positive number of minutes.', 'La duración debe ser un número positivo de minutos.')); return }
      const [sh, sm] = form.start_time.split(':').map(Number)
      const newStart = sh * 60 + sm, newEnd = newStart + durMin
      // How many resource slots this booking will consume (1 per party member)
      const slotsNeeded = !form.id ? 1 + form.extra_staff.length : 1
      // Cancelling / marking no-show frees the slot — conflict checks must not block it
      const isActiveBooking = form.status !== 'cancelled' && form.status !== 'no_show'

      // Resource availability check — accounts for all slots in a multi-party booking
      if (isActiveBooking && form.resource_id && form.appointment_date && form.start_time) {
        const resource = resources.find(r => r.id === form.resource_id)
        const { data: existing } = await supabase
          .from('appointments')
          .select('id, start_time, duration_minutes, group_id')
          .eq('client_id', CLIENT_ID)
          .eq('appointment_date', form.appointment_date)
          .eq('resource_id', form.resource_id)
          .in('status', ['scheduled', 'checked_in', 'completed'])
          .limit(200)
        const overlapping = (existing ?? []).filter(a => {
          // Exclude all records from the same group when editing
          if (form.id && (a.id === form.id || (form.group_id && a.group_id === form.group_id))) return false
          const [ah, am] = a.start_time.split(':').map(Number)
          const aStart = ah * 60 + am, aEnd = aStart + a.duration_minutes
          return newStart < aEnd && newEnd > aStart
        })
        // Compare peak *concurrent* usage against capacity — counting every overlap
        // rejects bookings when back-to-back appointments never actually coexist
        const starts = overlapping.map(a => { const [ah, am] = a.start_time.split(':').map(Number); return ah * 60 + am })
        const peak = [newStart, ...starts.filter(p => p > newStart && p < newEnd)].reduce((max, p) => {
          const busy = overlapping.filter((a, i) => starts[i] <= p && p < starts[i] + a.duration_minutes).length
          return Math.max(max, busy)
        }, 0)
        if (resource && peak + slotsNeeded > resource.quantity) {
          const avail = Math.max(0, resource.quantity - peak)
          setFormErr(t(
            `${resource.name} only has ${avail} of ${resource.quantity} slot${resource.quantity !== 1 ? 's' : ''} available — this booking needs ${slotsNeeded}.`,
            `${resource.name} solo tiene ${avail} de ${resource.quantity} espacio${resource.quantity !== 1 ? 's' : ''} disponible — esta reserva necesita ${slotsNeeded}.`
          ))
          setSaving(false); return
        }
      }

      // Time block check — runs for every provider in the booking
      const allStaffIds = [form.staff_id, ...form.extra_staff.filter(Boolean)]
      if (isActiveBooking && form.appointment_date && form.start_time) {
        const { data: blocks } = await supabase
          .from('time_blocks')
          .select('staff_id, start_time, end_time, label')
          .eq('client_id', CLIENT_ID)
          .eq('block_date', form.appointment_date)
          .in('staff_id', allStaffIds)
          .limit(200)
        const blockHit = (blocks ?? []).find(b => {
          const [bsh, bsm] = b.start_time.split(':').map(Number)
          const [beh, bem] = b.end_time.split(':').map(Number)
          return newStart < (beh * 60 + bem) && newEnd > (bsh * 60 + bsm)
        })
        if (blockHit) {
          const staff = staffList.find(s => s.id === blockHit.staff_id)
          setFormErr(t(
            `${staff?.name ?? 'Provider'} is blocked during this time (${blockHit.label}: ${fmtTime(blockHit.start_time)} – ${fmtTime(blockHit.end_time)}).`,
            `${staff?.name ?? 'Proveedor'} está bloqueado durante este horario (${blockHit.label}: ${fmtTime(blockHit.start_time)} – ${fmtTime(blockHit.end_time)}).`
          ))
          setSaving(false); return
        }
      }

      // A multi-party booking needs a distinct provider per slot
      if (new Set(allStaffIds).size !== allStaffIds.length) {
        setFormErr(t('Each party member needs a different provider.', 'Cada miembro del grupo necesita un proveedor diferente.'))
        setSaving(false); return
      }

      // Staff double-booking check — warns, but the user can explicitly double-book
      if (!force && isActiveBooking) {
        const { data: sameDay } = await supabase
          .from('appointments')
          .select('id, staff_id, start_time, duration_minutes, group_id, customers(first_name, middle_name, last_name)')
          .eq('client_id', CLIENT_ID)
          .eq('appointment_date', form.appointment_date)
          .in('staff_id', allStaffIds)
          .in('status', ['scheduled', 'checked_in', 'completed'])
          .limit(200)
        const clash = (sameDay ?? []).find(a => {
          if (form.id && (a.id === form.id || (form.group_id && a.group_id === form.group_id))) return false
          const [ah, am] = a.start_time.split(':').map(Number)
          const aStart = ah * 60 + am, aEnd = aStart + a.duration_minutes
          return newStart < aEnd && newEnd > aStart
        })
        if (clash) {
          const staff = staffList.find(s => s.id === clash.staff_id)
          // supabase-js types a to-one embed as an array without generated DB types
          const cust = (Array.isArray(clash.customers) ? clash.customers[0] ?? null : clash.customers) as Appt['customers']
          const [ch, cm] = clash.start_time.split(':').map(Number)
          const cEnd = ch * 60 + cm + clash.duration_minutes
          const endStr = `${String(Math.floor(cEnd / 60) % 24).padStart(2, '0')}:${String(cEnd % 60).padStart(2, '0')}`
          setDblBookWarn(t(
            `${staff?.name ?? 'This provider'} already has ${custName(cust)} from ${fmtTime(clash.start_time)} to ${fmtTime(endStr)}.`,
            `${staff?.name ?? 'El proveedor'} ya tiene a ${custName(cust)} de ${fmtTime(clash.start_time)} a ${fmtTime(endStr)}.`
          ))
          setSaving(false); return
        }
      }

      const isMulti = !form.id && form.extra_staff.length > 0
      const groupId = isMulti ? crypto.randomUUID() : (form.group_id ?? null)

      const basePayload = {
        client_id: CLIENT_ID, service_id: form.service_id,
        resource_id: form.resource_id || null,
        appointment_date: form.appointment_date, start_time: form.start_time,
        duration_minutes: durMin, status: form.status,
        price_charged: form.price_charged ? parseFloat(form.price_charged) : null,
        tip_amount: parseFloat(form.tip_amount) || 0, deposit_paid: parseFloat(form.deposit_paid) || 0,
        payment_method: form.payment_method || null,
        square_transaction_id: form.square_transaction_id.trim() || null,
        notes: form.notes.trim() || null,
        group_id: groupId,
      }

      if (form.id) {
        // Edit existing single record
        const { error: err } = await supabase.from('appointments')
          .update({ ...basePayload, customer_id: form.customer_id, staff_id: form.staff_id })
          .eq('id', form.id)
        if (err) { setFormErr(err.message); return }
        await syncApptAddons(form.id, form.addonIds)
      } else if (isMulti) {
        // Insert all linked records together
        const records = [
          { ...basePayload, customer_id: form.customer_id, staff_id: form.staff_id },
          ...form.extra_staff.map((sid, i) => ({
            ...basePayload,
            customer_id: form.extra_customers[i] || form.customer_id,
            staff_id: sid,
            // The form's price/tip/deposit cover the whole booking — only the primary
            // record carries them, or monthly revenue counts the sale once per guest
            price_charged: null,
            tip_amount: 0,
            deposit_paid: 0,
          })),
        ]
        // Validate that all extra staff are selected
        if (records.some(r => !r.staff_id)) { setFormErr(t('Select a provider for each slot.', 'Seleccione un proveedor para cada espacio.')); return }
        const { data: inserted, error: err } = await supabase.from('appointments').insert(records).select('id')
        if (err) { setFormErr(err.message); return }
        // Attach add-ons to the primary (first) record only
        if (inserted?.[0]?.id) await syncApptAddons(inserted[0].id, form.addonIds)
      } else {
        const { data: inserted, error: err } = await supabase.from('appointments')
          .insert({ ...basePayload, customer_id: form.customer_id, staff_id: form.staff_id })
          .select('id').single()
        if (err) { setFormErr(err.message); return }
        if (inserted?.id) await syncApptAddons(inserted.id, form.addonIds)
      }

      setModal(false)
      setFindTime(null)
      await (view === 'day' ? loadDay() : load())
    } finally { setSaving(false) }
  }
  // Replace the add-on rows for an appointment with the given selection
  async function syncApptAddons(apptId: string, addonIds: string[]) {
    await supabase.from('appointment_addons').delete().eq('appointment_id', apptId)
    if (addonIds.length) {
      const rows = addonIds.map(id => ({
        client_id: CLIENT_ID, appointment_id: apptId, addon_id: id,
        price_charged: addons.find(a => a.id === id)?.price ?? 0,
      }))
      await supabase.from('appointment_addons').insert(rows)
    }
  }

  // Load the add-ons attached to an appointment (full ServiceAddon objects)
  async function loadApptAddons(apptId: string): Promise<ServiceAddon[]> {
    const { data } = await supabase.from('appointment_addons').select('addon_id').eq('appointment_id', apptId)
    const ids = new Set((data ?? []).map((r: { addon_id: string }) => r.addon_id))
    return addons.filter(a => ids.has(a.id))
  }

  // Phase 1 — Check In: mark the guest as arrived, then show their visit details
  async function checkIn(a: Appt) {
    await supabase.from('appointments')
      .update({ status: 'checked_in', checked_in_at: new Date().toISOString() })
      .eq('id', a.id)
    await (view === 'day' ? loadDay() : load())
    const addonList = await loadApptAddons(a.id)
    setVisitAddons(addonList)
    setVisitAppt({ ...a, status: 'checked_in' })
  }

  // Show the visit details window for an already-checked-in appointment
  async function openVisit(a: Appt) {
    setVisitAddons(await loadApptAddons(a.id))
    setVisitAppt(a)
  }

  // Phase 2 — Check Out: build the ticket/bill and open the checkout window
  async function openBill(a: Appt) {
    const svc = services.find(s => s.id === a.service_id)
    const { data: addonRows } = await supabase
      .from('appointment_addons').select('addon_id, price_charged').eq('appointment_id', a.id)
    const lines: BillLine[] = []
    // Bill what was agreed at booking (price_charged), not today's catalog prices.
    // Secondary records of a group booking carry no charge — the primary holds it.
    const isGroupExtra = a.group_id != null && a.price_charged == null
    lines.push({
      label: a.services?.name ?? svc?.name ?? 'Service',
      amount: isGroupExtra ? 0 : Number(a.price_charged ?? a.services?.price ?? svc?.price ?? 0),
    })
    ;(addonRows ?? []).forEach((r: { addon_id: string; price_charged: number | null }) => {
      const ad = addons.find(x => x.id === r.addon_id)
      lines.push({ label: ad?.name ?? 'Add-on', amount: Number(r.price_charged ?? ad?.price ?? 0) })
    })
    setBillLines(lines)
    setBillTip(String(a.tip_amount ?? 0))
    setBillPayment(a.payment_method ?? 'square')
    setBillNotes(a.notes ?? '')
    setVisitAppt(null)
    setBillAppt(a)
  }

  // Mark the bill paid → records the transaction and closes out the appointment
  async function markPaid() {
    if (!billAppt) return
    setBillSaving(true)
    try {
      const subtotal = Math.round(billLines.reduce((s, l) => s + l.amount, 0) * 100) / 100
      const tip = Math.round((parseFloat(billTip) || 0) * 100) / 100
      await supabase.from('appointments').update({
        status: 'completed',
        price_charged: subtotal,
        tip_amount: tip,
        payment_method: billPayment || null,
        notes: billNotes.trim() || null,
        checked_out_at: new Date().toISOString(),
      }).eq('id', billAppt.id)
      setBillAppt(null)
      await (view === 'day' ? loadDay() : load())
    } finally { setBillSaving(false) }
  }

  async function quickNoShow(id: string) {
    await supabase.from('appointments').update({ status: 'no_show' }).eq('id', id)
    await (view === 'day' ? loadDay() : load())
  }

  function openBlock(staffId?: string, startTime?: string) {
    const endTime = startTime ? (() => {
      const [h, m] = startTime.split(':').map(Number)
      const em = h * 60 + m + 60
      return `${String(Math.floor(em / 60)).padStart(2, '0')}:${String(em % 60).padStart(2, '0')}`
    })() : ''
    setBlockForm({ staff_id: staffId ?? '', block_date: dayDate, start_time: startTime ?? '', end_time: endTime, label: 'Blocked', notes: '' })
    setBlockErr('')
    setBlockModal(true)
  }
  function openEditBlock(b: TimeBlock) {
    setBlockForm({ id: b.id, staff_id: b.staff_id, block_date: b.block_date, start_time: b.start_time.slice(0, 5), end_time: b.end_time.slice(0, 5), label: b.label, notes: b.notes ?? '' })
    setBlockErr('')
    setBlockModal(true)
  }
  async function saveBlock() {
    if (!blockForm.staff_id)   { setBlockErr(t('Select a provider.', 'Seleccione un proveedor.')); return }
    if (!blockForm.start_time) { setBlockErr(t('Start time is required.', 'La hora de inicio es requerida.')); return }
    if (!blockForm.end_time)   { setBlockErr(t('End time is required.', 'La hora de fin es requerida.')); return }
    if (blockForm.end_time <= blockForm.start_time) { setBlockErr(t('End time must be after start time.', 'La hora de fin debe ser después de la hora de inicio.')); return }
    setBlockSaving(true); setBlockErr('')
    try {
      const payload = {
        client_id: CLIENT_ID, staff_id: blockForm.staff_id,
        block_date: blockForm.block_date, start_time: blockForm.start_time, end_time: blockForm.end_time,
        label: blockForm.label.trim() || 'Blocked', notes: blockForm.notes.trim() || null,
      }
      const { error: err } = blockForm.id
        ? await supabase.from('time_blocks').update(payload).eq('id', blockForm.id)
        : await supabase.from('time_blocks').insert(payload)
      if (err) { setBlockErr(err.message); return }
      setBlockModal(false)
      await loadDayBlocks()
    } finally { setBlockSaving(false) }
  }
  async function deleteBlock() {
    if (!confirmDelBlock) return
    setDeletingBlock(true)
    try {
      await supabase.from('time_blocks').delete().eq('id', confirmDelBlock.id)
      setConfirmDelBlock(null)
      await loadDayBlocks()
    } finally { setDeletingBlock(false) }
  }

  // ── Day View ───────────────────────────────────────────────────────────────
  function DayView() {
    const slotH = dayDensity === 'compact' ? SLOT_H_COMPACT : SLOT_H
    // shadow module-level helpers so all pixel math uses the current density
    const timeToPx = (time: string) => {
      const [h, m] = time.split(':').map(Number)
      return ((h * 60 + m - DAY_START * 60) / 30) * slotH
    }
    const durationToPx = (min: number) => (min / 30) * slotH

    const activeStaff = staffList.filter(s => s.status === 'Active')
    const isDayToday  = dayDate === today
    const nowTop      = isDayToday && nowMinutes >= DAY_START * 60 && nowMinutes < DAY_END * 60
      ? ((nowMinutes - DAY_START * 60) / 30) * slotH
      : null
    const totalHeight = TIME_SLOTS.length * slotH

    return (
      <>
        {/* Find-a-time banner */}
        {findTime && (
          <div style={{
            marginBottom: 10, padding: '10px 16px',
            background: '#1A6EAD12', border: '1px solid #1A6EAD40',
            borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1A6EAD' }}>
                  {t('Finding time for', 'Buscando hora para')} {findTime.customerName}
                </div>
                <div style={{ fontSize: 11.5, color: '#1A6EAD', opacity: 0.8 }}>
                  {findTime.serviceName} · {findTime.duration_minutes} min &mdash; {t('click any open slot to book', 'haz clic en un espacio disponible para reservar')}
                </div>
              </div>
            </div>
            <button
              onClick={() => setFindTime(null)}
              style={{ background: 'transparent', border: '1px solid #1A6EAD40', borderRadius: 5, padding: '4px 12px', fontSize: 12, cursor: 'pointer', color: '#1A6EAD', whiteSpace: 'nowrap' }}
            >
              Cancel
            </button>
          </div>
        )}

        <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: activeStaff.length * COL_MIN_W + TIME_COL_W }}>

              {/* Sticky header row: time gutter + staff names */}
              <div style={{
                display: 'flex', position: 'sticky', top: 0, zIndex: 10,
                background: '#F0EBE0', borderBottom: `1px solid ${D.border}`,
              }}>
                <div style={{ width: TIME_COL_W, flexShrink: 0 }} />
                {activeStaff.map(s => (
                  <div key={s.id} style={{
                    flex: 1, minWidth: COL_MIN_W, padding: '10px 12px',
                    fontWeight: 600, fontSize: 13, textAlign: 'center',
                    borderLeft: `1px solid ${D.border}`,
                    color: findTime?.staff_id === s.id ? '#1A6EAD' : D.charcoal,
                    background: findTime?.staff_id === s.id ? '#1A6EAD08' : 'transparent',
                  }}>
                    {s.name}
                    {dayAppts.filter(a => a.staff_id === s.id).length > 0 && (
                      <span style={{ marginLeft: 6, fontSize: 10.5, color: D.muted, fontWeight: 400 }}>
                        {dayAppts.filter(a => a.staff_id === s.id).length} {t(
                          dayAppts.filter(a => a.staff_id === s.id).length !== 1 ? 'appts' : 'appt',
                          dayAppts.filter(a => a.staff_id === s.id).length !== 1 ? 'citas' : 'cita'
                        )}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {/* Grid body */}
              <div style={{ display: 'flex', position: 'relative' }}>

                {/* Time label column */}
                <div style={{ width: TIME_COL_W, flexShrink: 0 }}>
                  {TIME_SLOTS.map(slot => (
                    <div key={slot.minutes} style={{
                      height: slotH,
                      display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end',
                      padding: slot.isHour ? '3px 8px 0 0' : '0 8px 0 0',
                      borderBottom: `1px solid ${slot.isHour ? D.border : 'transparent'}`,
                    }}>
                      {slot.isHour && (
                        <span style={{ fontSize: 10.5, fontWeight: 500, color: D.muted, lineHeight: 1 }}>
                          {slot.label}
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                {/* Staff columns */}
                {activeStaff.map(s => {
                  const staffAppts = dayAppts.filter(a => a.staff_id === s.id)
                  return (
                    <div key={s.id}
                      onClick={(e) => {
                        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
                        const offsetY = e.clientY - rect.top
                        const slotIndex = Math.max(0, Math.floor(offsetY / slotH))
                        const slotMinutes = DAY_START * 60 + slotIndex * 30
                        const h = Math.floor(slotMinutes / 60), m = slotMinutes % 60
                        const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
                        if (findTime) {
                          const svc = services.find(sv => sv.id === findTime.service_id)
                          setForm({
                            ...BLANK,
                            customer_id: findTime.customer_id,
                            service_id:  findTime.service_id,
                            staff_id:    s.id,
                            resource_id: svc?.resource_id ?? '',
                            appointment_date: dayDate,
                            start_time: timeStr,
                            duration_minutes: String(findTime.duration_minutes),
                            price_charged: svc ? String(svc.price) : '',
                          })
                          setFormErr(''); setDblBookWarn(null); setModal(true)
                        } else {
                          openAdd(dayDate, s.id, timeStr)
                        }
                      }}
                      style={{
                        flex: 1, minWidth: COL_MIN_W, position: 'relative',
                        borderLeft: `1px solid ${D.border}`, cursor: 'cell',
                      }}
                    >
                      {/* Background slot lines */}
                      {TIME_SLOTS.map(slot => (
                        <div key={slot.minutes} style={{
                          height: slotH,
                          borderBottom: `1px ${slot.isHour ? 'solid' : 'dashed'} ${slot.isHour ? D.border : D.border + '70'}`,
                          boxSizing: 'border-box',
                        }} />
                      ))}

                      {/* Time block overlays */}
                      {dayBlocks.filter(b => b.staff_id === s.id).map(b => {
                        const [eh, em] = b.end_time.split(':').map(Number)
                        const [sh, sm] = b.start_time.split(':').map(Number)
                        const durMin = (eh * 60 + em) - (sh * 60 + sm)
                        // Render the portion inside the grid — a block starting before
                        // 8 AM must still cover its in-view hours, not vanish
                        const rawTop = timeToPx(b.start_time)
                        const topPx = Math.max(rawTop, 0)
                        const hPx = Math.min(rawTop + Math.max(durationToPx(durMin), 8), totalHeight) - topPx
                        if (hPx <= 0) return null
                        return (
                          <div
                            key={b.id}
                            onClick={(e) => { e.stopPropagation(); openEditBlock(b) }}
                            title={`${b.label}${b.notes ? ` — ${b.notes}` : ''}\n${fmtTime(b.start_time)} – ${fmtTime(b.end_time)}`}
                            style={{
                              position: 'absolute', top: topPx, height: hPx,
                              left: 0, right: 0, zIndex: 1, cursor: 'pointer',
                              boxSizing: 'border-box',
                              background: 'repeating-linear-gradient(45deg, rgba(74,74,63,0.07) 0px, rgba(74,74,63,0.07) 4px, transparent 4px, transparent 10px)',
                              backgroundColor: 'rgba(74,74,63,0.05)',
                              borderTop: '1px solid rgba(74,74,63,0.18)',
                              borderBottom: '1px solid rgba(74,74,63,0.18)',
                              display: 'flex', alignItems: 'flex-start',
                              padding: '3px 7px', overflow: 'hidden',
                            }}
                          >
                            <span style={{ fontSize: 10, fontWeight: 600, color: 'rgba(74,74,63,0.5)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: '0.3px', textTransform: 'uppercase' }}>
                              {b.label}
                            </span>
                          </div>
                        )
                      })}

                      {/* Appointment blocks */}
                      {staffAppts.map(a => {
                        const hPx   = Math.max(durationToPx(a.duration_minutes), slotH)
                        const sc    = STATUS_COLORS[a.status] ?? STATUS_COLORS.scheduled
                        // Clamp off-grid bookings to the nearest edge — an early/late
                        // appointment must stay visible or staff will miss the guest
                        const topPx = Math.min(Math.max(timeToPx(a.start_time), 0), totalHeight - slotH)
                        return (
                          <div
                            key={a.id}
                            onClick={(e) => { e.stopPropagation(); openEdit(a) }}
                            style={{
                              position: 'absolute', top: topPx, height: hPx,
                              left: 3, right: 3,
                              background: sc.bg,
                              border: `1px solid ${sc.border}`,
                              borderLeft: `3px solid ${sc.solid}`,
                              borderRadius: 4, padding: '4px 7px',
                              overflow: 'hidden', cursor: 'pointer', zIndex: 2,
                              boxSizing: 'border-box',
                            }}
                          >
                            {/* Top-right action — Check In (today's scheduled) → Check Out (checked in) */}
                            {((a.status === 'scheduled' && a.appointment_date === today) || a.status === 'checked_in') && (
                              <button
                                onClick={(e) => { e.stopPropagation(); a.status === 'checked_in' ? openBill(a) : checkIn(a) }}
                                style={{
                                  position: 'absolute', top: 4, right: 4, zIndex: 3,
                                  background: a.status === 'checked_in' ? '#0E7C7B' : D.green, color: '#fff', border: 'none', borderRadius: 3,
                                  padding: '1px 6px', fontSize: 9.5, fontWeight: 700, cursor: 'pointer',
                                }}
                              >{a.status === 'checked_in' ? t('Check Out', 'Finalizar') : t('Check In', 'Registrar')}</button>
                            )}
                            <div style={{ fontSize: 11.5, fontWeight: 700, color: sc.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4, paddingRight: ((a.status === 'scheduled' && a.appointment_date === today) || a.status === 'checked_in') ? 62 : 0 }}>
                              {custName(a.customers)}
                              {a.group_id && <span title="Group booking" style={{ fontSize: 9, background: '#7B4A8A', color: '#fff', borderRadius: 3, padding: '1px 4px', fontWeight: 600, flexShrink: 0 }}>2+</span>}
                            </div>
                            <div style={{ fontSize: 10.5, color: sc.text, opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
                              {a.services?.name ?? ''}
                            </div>
                            {hPx >= slotH * 2 && (
                              <div style={{ fontSize: 10, color: sc.text, opacity: 0.7, marginTop: 2 }}>
                                {fmtTime(a.start_time)} · {a.duration_minutes} min
                              </div>
                            )}
                          </div>
                        )
                      })}

                      {/* "Now" indicator line */}
                      {nowTop !== null && (
                        <div style={{
                          position: 'absolute', top: nowTop, left: 0, right: 0,
                          height: 2, background: D.red, zIndex: 5, pointerEvents: 'none',
                        }}>
                          <div style={{
                            position: 'absolute', left: -1, top: -4,
                            width: 10, height: 10, borderRadius: '50%', background: D.red,
                          }} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {dayLoading && (
            <div style={{ padding: '12px 16px', borderTop: `1px solid ${D.border}`, fontSize: 12.5, color: D.muted }}>
              {t('Loading…', 'Cargando…')}
            </div>
          )}
        </div>
      </>
    )
  }

  // ── Calendar month view ────────────────────────────────────────────────────
  function CalendarView() {
    const firstDow = new Date(month.getFullYear(), month.getMonth(), 1).getDay()
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
    const cells: (string | null)[] = Array(firstDow).fill(null)
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(`${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
    }
    while (cells.length % 7 !== 0) cells.push(null)
    const selectedAppts = selectedDate ? (byDate[selectedDate] ?? []) : []

    return (
      <div>
        <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', background: '#F0EBE0', borderBottom: `1px solid ${D.border}` }}>
            {(t('Sun,Mon,Tue,Wed,Thu,Fri,Sat', 'Dom,Lun,Mar,Mié,Jue,Vie,Sáb')).split(',').map(d => (
              <div key={d} style={{ padding: '7px 0', fontSize: 11, fontWeight: 600, color: D.muted, textAlign: 'center', letterSpacing: '0.4px' }}>{d}</div>
            ))}
          </div>
          {Array.from({ length: cells.length / 7 }, (_, week) => (
            <div key={week} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: week < cells.length / 7 - 1 ? `1px solid ${D.border}` : 'none' }}>
              {cells.slice(week * 7, week * 7 + 7).map((dateStr, di) => {
                if (!dateStr) return <div key={di} style={{ background: '#F5F0E880', minHeight: 90, borderRight: di < 6 ? `1px solid ${D.border}` : 'none' }} />
                const dayApptsList = byDate[dateStr] ?? []
                const isToday = dateStr === today, isSelected = dateStr === selectedDate
                const dayNum = parseInt(dateStr.slice(8))
                return (
                  <div key={dateStr} onClick={() => setSelectedDate(isSelected ? null : dateStr)} style={{
                    minHeight: 90, padding: '6px 7px', cursor: 'pointer',
                    background: isSelected ? D.sage + '12' : D.card,
                    borderRight: di < 6 ? `1px solid ${D.border}` : 'none',
                    borderLeft: isSelected ? `3px solid ${D.sage}` : '3px solid transparent',
                    boxSizing: 'border-box',
                  }}>
                    <div style={{
                      width: 22, height: 22, borderRadius: '50%', marginBottom: 4,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: isToday ? 700 : 400,
                      background: isToday ? D.sage : 'transparent',
                      color: isToday ? '#fff' : D.charcoal,
                    }}>{dayNum}</div>
                    {dayApptsList.slice(0, 3).map(a => {
                      const sc = STATUS_COLORS[a.status]
                      return (
                        <div key={a.id} style={{ background: sc.bg, color: sc.text, border: `1px solid ${sc.border}`, borderRadius: 3, padding: '2px 5px', fontSize: 10.5, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {fmtTime(a.start_time)} {custShort(a.customers)}
                        </div>
                      )
                    })}
                    {dayApptsList.length > 3 && <div style={{ fontSize: 10, color: D.muted, paddingLeft: 2 }}>+{dayApptsList.length - 3} {t('more', 'más')}</div>}
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        {/* Day detail panel */}
        {selectedDate && (
          <div style={{ marginTop: 12, background: D.card, border: `1px solid ${D.border}`, borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ padding: '11px 16px', borderBottom: `1px solid ${D.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, color: D.charcoal, fontSize: 14 }}>{fmtDate(selectedDate)}</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 12.5, color: D.muted }}>{selectedAppts.length} {t(selectedAppts.length !== 1 ? 'appointments' : 'appointment', selectedAppts.length !== 1 ? 'citas' : 'cita')}</span>
                <button onClick={() => switchToDay(selectedDate)} style={{ background: 'transparent', border: `1px solid ${D.border}`, borderRadius: 5, padding: '4px 10px', fontSize: 12, cursor: 'pointer', color: D.charcoal }}>{t('Day View', 'Vista Diaria')} →</button>
                <button onClick={() => openAdd(selectedDate)} style={{ background: D.sage, color: '#fff', border: 'none', borderRadius: 5, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>+ {t('Add', 'Agregar')}</button>
              </div>
            </div>
            {selectedAppts.length === 0 ? (
              <div style={{ padding: '20px 16px', color: D.muted, fontSize: 13 }}>{t('No appointments. Click "+ Add" to book one.', 'Sin citas. Haz clic en "+ Agregar" para reservar.')}</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <tbody>
                  {selectedAppts.map((a, i) => {
                    const sc = STATUS_COLORS[a.status]
                    return (
                      <tr key={a.id} style={{ borderBottom: i < selectedAppts.length - 1 ? `1px solid ${D.border}` : 'none', background: i % 2 === 0 ? D.card : '#F7F4EE' }}>
                        <td style={{ padding: '9px 14px', color: D.muted, whiteSpace: 'nowrap', width: 80 }}>{fmtTime(a.start_time)}</td>
                        <td style={{ padding: '9px 14px', fontWeight: 500, color: D.charcoal, whiteSpace: 'nowrap' }}>{custName(a.customers)}</td>
                        <td style={{ padding: '9px 14px', color: D.charcoal, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.services?.name ?? '—'}</td>
                        <td style={{ padding: '9px 14px', color: D.muted, whiteSpace: 'nowrap' }}>{a.staff?.name ?? '—'}</td>
                        <td style={{ padding: '9px 14px' }}><span style={{ background: sc.bg, color: sc.text, border: `1px solid ${sc.border}`, borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 500 }}>{t(STATUS_LABELS[a.status], STATUS_LABELS_ES[a.status])}</span></td>
                        <td style={{ padding: '9px 14px', whiteSpace: 'nowrap' }}>
                          {a.status === 'scheduled' && <button onClick={() => checkIn(a)} style={{ background: D.green, color: '#fff', border: 'none', borderRadius: 4, padding: '3px 8px', fontSize: 11, fontWeight: 600, cursor: 'pointer', marginRight: 5 }}>{t('Check In', 'Registrar')}</button>}
                          {a.status === 'checked_in' && <button onClick={() => openBill(a)} style={{ background: '#0E7C7B', color: '#fff', border: 'none', borderRadius: 4, padding: '3px 8px', fontSize: 11, fontWeight: 600, cursor: 'pointer', marginRight: 5 }}>{t('Check Out', 'Finalizar')}</button>}
                          <button onClick={() => openEdit(a)} style={{ ...actionBtn, fontSize: 11 }}>{t('Edit', 'Editar')}</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── Log view ───────────────────────────────────────────────────────────────
  function LogView() {
    return (
      <>
        <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
          {(['all', 'scheduled', 'completed', 'no_show', 'cancelled'] as const).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} style={{ background: statusFilter === s ? D.charcoal : 'transparent', color: statusFilter === s ? '#fff' : D.muted, border: `1px solid ${statusFilter === s ? D.charcoal : D.border}`, borderRadius: 5, padding: '4px 10px', fontSize: 12, fontWeight: statusFilter === s ? 600 : 400, cursor: 'pointer' }}>
              {s === 'all' ? t('All', 'Todos') : (lang === 'es' ? (STATUS_LABELS_ES[s] ?? STATUS_LABELS[s]) : STATUS_LABELS[s])}
            </button>
          ))}
        </div>
        <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 8, overflow: 'hidden' }}>
          {loading ? <div style={{ padding: 40, textAlign: 'center', color: D.muted, fontSize: 13 }}>{t('Loading…', 'Cargando…')}</div>
          : error   ? <div style={{ padding: 32, color: D.red, fontSize: 13 }}>{error}</div>
          : filtered.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: D.muted, fontSize: 13 }}>{t('No appointments for', 'No hay citas para')} {monthLabel}{statusFilter !== 'all' ? ` · ${lang === 'es' ? (STATUS_LABELS_ES[statusFilter] ?? STATUS_LABELS[statusFilter]) : STATUS_LABELS[statusFilter]}` : ''}.</div>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: '#F0EBE0', borderBottom: `1px solid ${D.border}` }}>
                  {[t('Date','Fecha'), t('Time','Hora'), t('Customer','Cliente'), t('Service','Servicio'), t('Provider','Proveedor'), t('Status','Estado'), t('Charged','Cobrado'), t('Tip','Propina'), t('Payment','Pago'), ''].map(h => (
                    <th key={h} style={{ padding: '9px 12px', textAlign: 'left', fontWeight: 600, color: D.charcoal, fontSize: 11, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((a, i) => {
                  const sc = STATUS_COLORS[a.status] ?? STATUS_COLORS.scheduled
                  return (
                    <tr key={a.id} style={{ borderBottom: i < filtered.length - 1 ? `1px solid ${D.border}` : 'none', background: i % 2 === 0 ? D.card : '#F7F4EE' }}>
                      <td style={{ padding: '9px 12px', color: D.charcoal, whiteSpace: 'nowrap' }}>{fmtDate(a.appointment_date)}</td>
                      <td style={{ padding: '9px 12px', color: D.muted, whiteSpace: 'nowrap' }}>{fmtTime(a.start_time)}</td>
                      <td style={{ padding: '9px 12px', fontWeight: 500, color: D.charcoal, whiteSpace: 'nowrap' }}>{custName(a.customers)}</td>
                      <td style={{ padding: '9px 12px', color: D.charcoal, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.services?.name ?? '—'}</td>
                      <td style={{ padding: '9px 12px', color: D.muted, whiteSpace: 'nowrap' }}>{a.staff?.name ?? '—'}</td>
                      <td style={{ padding: '9px 12px' }}><span style={{ background: sc.bg, color: sc.text, border: `1px solid ${sc.border}`, borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 500 }}>{(lang === 'es' ? (STATUS_LABELS_ES[a.status] ?? STATUS_LABELS[a.status]) : STATUS_LABELS[a.status]) ?? a.status}</span></td>
                      <td style={{ padding: '9px 12px', color: a.price_charged != null ? D.charcoal : D.muted }}>
                        {a.payment_method === 'insurance' ? <span style={{ fontSize: 11, color: '#1A6EAD', fontWeight: 500 }}>{t('Insurance', 'Seguro')}</span> : fmtMoney(a.price_charged)}
                      </td>
                      <td style={{ padding: '9px 12px', color: Number(a.tip_amount) > 0 ? D.charcoal : D.muted }}>{Number(a.tip_amount) > 0 ? fmtMoney(a.tip_amount) : '—'}</td>
                      <td style={{ padding: '9px 12px', color: D.muted, fontSize: 11.5 }}>{a.payment_method ? (paymentMethods.find(pm => pm.code === a.payment_method)?.name ?? PAYMENT_LABELS_FALLBACK[a.payment_method] ?? a.payment_method) : '—'}</td>
                      <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>
                        {a.status === 'scheduled' && (<>
                          <button onClick={() => checkIn(a)} style={{ background: D.green, color: '#fff', border: 'none', borderRadius: 4, padding: '3px 8px', fontSize: 11, fontWeight: 600, cursor: 'pointer', marginRight: 5 }}>{t('Check In', 'Registrar')}</button>
                          <button onClick={() => quickNoShow(a.id)} style={{ ...dangerBtn, marginRight: 5, fontSize: 11 }}>{t('No Show', 'No Asistió')}</button>
                        </>)}
                        {a.status === 'checked_in' && <button onClick={() => openBill(a)} style={{ background: '#0E7C7B', color: '#fff', border: 'none', borderRadius: 4, padding: '3px 8px', fontSize: 11, fontWeight: 600, cursor: 'pointer', marginRight: 5 }}>{t('Check Out', 'Finalizar')}</button>}
                        <button onClick={() => openEdit(a)} style={{ ...actionBtn, fontSize: 11 }}>{t('Edit', 'Editar')}</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '28px 32px', background: D.page, minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: D.charcoal }}>{t('Appointments', 'Citas')}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', border: `1px solid ${D.border}`, borderRadius: 6, overflow: 'hidden' }}>
            {(['calendar', 'day', 'log'] as const).map(v => (
              <button key={v} onClick={() => {
                if (v === 'day' && view !== 'day') switchToDay(selectedDate ?? undefined)
                else setView(v)
              }} style={{
                background: view === v ? D.charcoal : '#fff',
                color: view === v ? '#fff' : D.muted,
                border: 'none', borderRight: v !== 'log' ? `1px solid ${D.border}` : 'none',
                padding: '6px 14px', fontSize: 12.5,
                fontWeight: view === v ? 600 : 400, cursor: 'pointer',
              }}>{v === 'calendar' ? t('Calendar', 'Calendario') : v === 'day' ? t('Day', 'Día') : t('Log', 'Registro')}</button>
            ))}
          </div>
          {view === 'day' && (
            <>
              <div style={{ display: 'flex', border: `1px solid ${D.border}`, borderRadius: 6, overflow: 'hidden' }}>
                {(['comfortable', 'compact'] as const).map(d => (
                  <button key={d} onClick={() => setDayDensity(d)} style={{
                    background: dayDensity === d ? D.charcoal : '#fff',
                    color: dayDensity === d ? '#fff' : D.muted,
                    border: 'none', borderRight: d === 'comfortable' ? `1px solid ${D.border}` : 'none',
                    padding: '6px 12px', fontSize: 12,
                    fontWeight: dayDensity === d ? 600 : 400, cursor: 'pointer',
                  }}>{d === 'comfortable' ? t('Comfortable', 'Cómodo') : t('Compact', 'Compacto')}</button>
                ))}
              </div>
              {canWrite && (
                <button onClick={() => openBlock()} style={{ background: D.card, color: D.charcoal, border: `1px solid ${D.border}`, borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                  {t('Block Time', 'Bloquear Horario')}
                </button>
              )}
            </>
          )}
          {canWrite && (
            <button onClick={() => openAdd(view === 'day' ? dayDate : undefined)} style={{ background: D.sage, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              {t('+ New Appointment', '+ Nueva Cita')}
            </button>
          )}
        </div>
      </div>

      {/* Navigation bar — day nav when in day view, month nav otherwise */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {view === 'day' ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button onClick={() => setDayDate(d => addDays(d, -1))} style={navBtn}>◀</button>
              <span style={{ fontSize: 15, fontWeight: 600, color: D.charcoal, minWidth: 240, textAlign: 'center' }}>
                {fmtDateLong(dayDate)}
              </span>
              <button onClick={() => setDayDate(d => addDays(d, 1))} style={navBtn}>▶</button>
              {dayDate !== today && (
                <button onClick={() => setDayDate(today)} style={{ ...navBtn, padding: '4px 10px', fontSize: 11.5 }}>{t('Today', 'Hoy')}</button>
              )}
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button onClick={() => setMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))} style={navBtn}>◀</button>
              <span style={{ fontSize: 15, fontWeight: 600, color: D.charcoal, minWidth: 148, textAlign: 'center' }}>{monthLabel}</span>
              <button onClick={() => setMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))} style={navBtn}>▶</button>
              {!isCurrentMonth && (
                <button onClick={() => { const n = new Date(); setMonth(new Date(n.getFullYear(), n.getMonth(), 1)) }} style={{ ...navBtn, padding: '4px 10px', fontSize: 11.5 }}>{t('Today', 'Hoy')}</button>
              )}
            </div>
            <select value={staffFilter} onChange={e => setStaffFilter(e.target.value)} style={{ padding: '5px 10px', fontSize: 12.5, border: `1px solid ${D.border}`, borderRadius: 5, background: '#fff', color: D.charcoal, cursor: 'pointer' }}>
              <option value="all">{t('All Providers', 'Todos los Proveedores')}</option>
              {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </>
        )}
      </div>

      {/* Stats (not in day view) */}
      {view !== 'day' && !loading && !error && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          {[
            { label: t('Total', 'Total'),         value: allAppts.length },
            { label: t('Completed', 'Completadas'), value: completedAppts.length },
            { label: t('Upcoming', 'Próximas'),   value: allAppts.filter(a => a.status === 'scheduled').length },
            { label: t('Revenue', 'Ingresos'),    value: fmtMoney(revenue) },
          ].map(c => (
            <div key={c.label} style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 7, padding: '9px 16px' }}>
              <div style={{ fontSize: 10.5, color: D.muted, marginBottom: 1 }}>{c.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: D.charcoal }}>{c.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Content */}
      {view === 'day'      ? <DayView />
       : view === 'calendar' ? (loading ? <div style={{ padding: 40, textAlign: 'center', color: D.muted }}>{t('Loading…', 'Cargando…')}</div> : error ? <div style={{ padding: 32, color: D.red }}>{error}</div> : <CalendarView />)
       : <LogView />}

      {/* Add / Edit modal */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={e => { if (e.target === e.currentTarget) setModal(false) }}>
          <div style={{ background: '#fff', borderRadius: 10, width: 560, maxWidth: '95vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            <div style={{ padding: '20px 24px 14px', borderBottom: `1px solid ${D.border}` }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: D.charcoal }}>{form.id ? t('Edit Appointment', 'Editar Cita') : t('New Appointment', 'Nueva Cita')}</h2>
            </div>
            <div style={{ padding: '18px 24px', overflowY: 'auto', flex: 1 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '13px 16px' }}>
                <div style={secHead}>{t('Client & Service', 'Cliente y Servicio')}</div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={lbl}>{t('Customer *', 'Cliente *')}</label>
                  <select value={form.customer_id} onChange={e => setForm(f => ({ ...f, customer_id: e.target.value }))} style={inp}>
                    <option value="">{t('— Select customer —', '— Seleccionar cliente —')}</option>
                    {customers.map(c => { const mid = c.middle_name ? ` ${c.middle_name[0]}.` : ''; return <option key={c.id} value={c.id}>{c.last_name}, {c.first_name}{mid}</option> })}
                  </select>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={lbl}>{t('Service *', 'Servicio *')}</label>
                  <select value={form.service_id} onChange={e => onServiceChange(e.target.value)} style={inp}>
                    <option value="">{t('— Select service —', '— Seleccionar servicio —')}</option>
                    {services.map(s => <option key={s.id} value={s.id}>{s.name} — ${s.price}</option>)}
                  </select>
                  {form.resource_id && (() => {
                    const r = resources.find(x => x.id === form.resource_id)
                    return r ? <div style={{ marginTop: 5, fontSize: 11.5, color: D.muted }}>{t('Uses', 'Usa')}: {r.name} (max {r.quantity} {t('concurrent', 'concurrentes')})</div> : null
                  })()}
                </div>

                {/* Add-ons available for the selected service */}
                {form.service_id && (() => {
                  const avail = addonsForService(form.service_id)
                  if (avail.length === 0) return null
                  const selectedTotal = form.addonIds.reduce((s, id) => s + (addons.find(a => a.id === id)?.price ?? 0), 0)
                  return (
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={lbl}>{t('Add-ons', 'Complementos')}</label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {avail.map(ad => {
                          const sel = form.addonIds.includes(ad.id)
                          return (
                            <button
                              key={ad.id}
                              type="button"
                              onClick={() => setForm(f => ({ ...f, addonIds: sel ? f.addonIds.filter(x => x !== ad.id) : [...f.addonIds, ad.id] }))}
                              style={{
                                padding: '5px 11px', borderRadius: 16, fontSize: 12, cursor: 'pointer',
                                border: sel ? `1.5px solid ${D.sage}` : `1.5px solid ${D.border}`,
                                background: sel ? `${D.sage}12` : '#fff',
                                color: sel ? D.sage : D.charcoal, fontWeight: sel ? 600 : 400,
                              }}
                            >
                              {`${ad.name} · $${ad.price.toFixed(2)}${ad.duration_minutes > 0 ? ` · +${ad.duration_minutes} min` : ''}`}
                            </button>
                          )
                        })}
                      </div>
                      {form.addonIds.length > 0 && (
                        <div style={{ fontSize: 11.5, color: D.muted, marginTop: 6 }}>
                          {form.addonIds.length} {t('add-on', 'complemento')}{form.addonIds.length !== 1 ? 's' : ''} · +{fmtMoney(selectedTotal)}
                        </div>
                      )}
                    </div>
                  )
                })()}

                {/* Primary provider */}
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={lbl}>{form.extra_staff.length > 0 ? t('Provider 1 *', 'Proveedor 1 *') : t('Provider *', 'Proveedor *')}</label>
                  <select value={form.staff_id} onChange={e => setForm(f => ({ ...f, staff_id: e.target.value }))} style={inp}>
                    <option value="">{t('— Select provider —', '— Seleccionar proveedor —')}</option>
                    {staffList.filter(s => s.status === 'Active').map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>

                {/* Additional providers / customers for multi-party services */}
                {form.extra_staff.map((sid, i) => (
                  <div key={i} style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                    <div style={{ gridColumn: '1 / -1', fontSize: 10, fontWeight: 700, color: 'rgba(74,74,63,0.45)', textTransform: 'uppercase', letterSpacing: '0.8px', paddingBottom: 5, borderBottom: '1px dashed #D9D4C8', marginBottom: 8 }}>
                      {t('Party', 'Grupo')} {i + 2}
                    </div>
                    <div>
                      <label style={lbl}>{t('Provider', 'Proveedor')} {i + 2} *</label>
                      <select value={sid} onChange={e => setForm(f => { const s = [...f.extra_staff]; s[i] = e.target.value; return { ...f, extra_staff: s } })} style={inp}>
                        <option value="">{t('— Select provider —', '— Seleccionar proveedor —')}</option>
                        {staffList.filter(s => s.status === 'Active').map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                    {form.extra_customers.length > i && (
                      <div>
                        <label style={lbl}>{t('Customer', 'Cliente')} {i + 2}</label>
                        <select value={form.extra_customers[i]} onChange={e => setForm(f => { const c = [...f.extra_customers]; c[i] = e.target.value; return { ...f, extra_customers: c } })} style={inp}>
                          <option value="">{t('— Same as Customer 1 —', '— Mismo que Cliente 1 —')}</option>
                          {customers.map(c => { const mid = c.middle_name ? ` ${c.middle_name[0]}.` : ''; return <option key={c.id} value={c.id}>{c.last_name}, {c.first_name}{mid}</option> })}
                        </select>
                      </div>
                    )}
                  </div>
                ))}

                {form.group_id && (
                  <div style={{ gridColumn: '1 / -1', fontSize: 11.5, color: '#7B4A8A', background: '#7B4A8A0A', border: '1px solid #7B4A8A30', borderRadius: 5, padding: '6px 10px' }}>
                    {t('Part of a group booking — editing this appointment only.', 'Parte de una reserva grupal — editando solo esta cita.')}
                  </div>
                )}

                <div style={{ ...secHead, marginTop: 2, display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span>{t('Schedule', 'Horario')}</span>
                  {apptIsPast && <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: D.muted }}>{t('· Past appointment — cannot reschedule', '· Cita pasada — no se puede reprogramar')}</span>}
                </div>
                <div><label style={lbl}>{t('Date *', 'Fecha *')}</label><input type="date" disabled={apptIsPast} value={form.appointment_date} onChange={e => setForm(f => ({ ...f, appointment_date: e.target.value }))} style={{ ...inp, ...(apptIsPast ? { background: '#F3F1EB', color: D.muted, cursor: 'not-allowed' } : {}) }} /></div>
                <div><label style={lbl}>{t('Start Time *', 'Hora de Inicio *')}</label><input type="time" disabled={apptIsPast} value={form.start_time} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} style={{ ...inp, ...(apptIsPast ? { background: '#F3F1EB', color: D.muted, cursor: 'not-allowed' } : {}) }} /></div>
                <div><label style={lbl}>{t('Duration (min)', 'Duración (min)')}</label><input type="number" min={1} value={form.duration_minutes} onChange={e => setForm(f => ({ ...f, duration_minutes: e.target.value }))} placeholder="60" style={inp} /></div>
                <div><label style={lbl}>{t('Status', 'Estado')}</label><select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as ApptStatus }))} style={inp}><option value="scheduled">{t('Scheduled', 'Programado')}</option><option value="completed">{t('Completed', 'Completado')}</option><option value="no_show">{t('No Show', 'No Asistió')}</option><option value="cancelled">{t('Cancelled', 'Cancelado')}</option></select></div>
                <div style={{ ...secHead, marginTop: 2 }}>{t('Payment', 'Pago')}</div>
                <div><label style={lbl}>{t('Price Charged', 'Precio Cobrado')}</label><input type="number" step="0.01" value={form.price_charged} onChange={e => setForm(f => ({ ...f, price_charged: e.target.value }))} placeholder="0.00" style={inp} /></div>
                <div><label style={lbl}>{t('Tip', 'Propina')}</label><input type="number" step="0.01" value={form.tip_amount} onChange={e => setForm(f => ({ ...f, tip_amount: e.target.value }))} placeholder="0.00" style={inp} /></div>
                <div><label style={lbl}>{t('Deposit Paid', 'Depósito Pagado')}</label><input type="number" step="0.01" value={form.deposit_paid} onChange={e => setForm(f => ({ ...f, deposit_paid: e.target.value }))} placeholder="0.00" style={inp} /></div>
                <div><label style={lbl}>{t('Payment Method', 'Método de Pago')}</label><select value={form.payment_method} onChange={e => setForm(f => ({ ...f, payment_method: e.target.value }))} style={inp}><option value="">—</option>{paymentMethods.map(pm => <option key={pm.code} value={pm.code}>{pm.name}</option>)}</select></div>
                <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>{t('Square Transaction ID', 'ID de Transacción Square')}</label><input value={form.square_transaction_id} onChange={e => setForm(f => ({ ...f, square_transaction_id: e.target.value }))} placeholder={t('Optional', 'Opcional')} style={inp} /></div>
                <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>{t('Notes', 'Notas')}</label><textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder={t('Session notes, client feedback, etc.', 'Notas de sesión, comentarios del cliente, etc.')} rows={2} style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }} /></div>
                {formErr && <div style={{ gridColumn: '1 / -1', color: D.red, fontSize: 12 }}>{formErr}</div>}
                {dblBookWarn && (
                  <div style={{ gridColumn: '1 / -1', background: '#B8740010', border: '1px solid #B8740040', borderRadius: 6, padding: '10px 12px' }}>
                    <div style={{ color: '#B87400', fontSize: 12.5, fontWeight: 600 }}>{dblBookWarn}</div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 9 }}>
                      <button onClick={() => save(true)} disabled={saving} style={{ background: '#B87400', color: '#fff', border: 'none', borderRadius: 5, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                        {t('Double-book anyway', 'Reservar doble de todos modos')}
                      </button>
                      <button onClick={() => setDblBookWarn(null)} style={{ background: 'transparent', border: `1px solid ${D.border}`, borderRadius: 5, padding: '5px 12px', fontSize: 12, cursor: 'pointer', color: D.charcoal }}>
                        {t('Change time', 'Cambiar hora')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div style={{ padding: '14px 24px', borderTop: `1px solid ${D.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                {form.id && form.status === 'completed' && (
                  <button
                    onClick={startFindTime}
                    style={{ background: 'transparent', border: `1px solid #1A6EAD40`, borderRadius: 6, padding: '8px 14px', fontSize: 12.5, cursor: 'pointer', color: '#1A6EAD', fontWeight: 500 }}
                  >
                    {t('Book Again →', 'Reservar de Nuevo →')}
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setModal(false)} style={{ background: 'transparent', border: `1px solid ${D.border}`, borderRadius: 6, padding: '8px 18px', fontSize: 13, cursor: 'pointer', color: D.charcoal }}>{t('Cancel', 'Cancelar')}</button>
                {form.id && form.status === 'scheduled' && editingAppt && (
                  <button onClick={() => { setModal(false); checkIn(editingAppt) }} style={{ background: D.green, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                    {t('Check In', 'Registrar')}
                  </button>
                )}
                {form.id && form.status === 'checked_in' && editingAppt && (
                  <button onClick={() => { setModal(false); openBill(editingAppt) }} style={{ background: '#0E7C7B', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                    {t('Check Out', 'Finalizar')}
                  </button>
                )}
                <button onClick={() => save()} disabled={saving} style={{ background: D.sage, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
                  {saving ? t('Saving…', 'Guardando…') : (form.id ? t('Save Changes', 'Guardar Cambios') : t('Book Appointment', 'Reservar Cita'))}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Block Time modal */}
      {blockModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={e => { if (e.target === e.currentTarget) setBlockModal(false) }}>
          <div style={{ background: '#fff', borderRadius: 10, width: 420, maxWidth: '95vw', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            <div style={{ padding: '20px 24px 14px', borderBottom: `1px solid ${D.border}` }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: D.charcoal }}>{blockForm.id ? t('Edit Block', 'Editar Bloqueo') : t('Block Time', 'Bloquear Horario')}</h2>
            </div>
            <div style={{ padding: '18px 24px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '13px 16px' }}>
                <div style={secHead}>{t('Provider & Date', 'Proveedor y Fecha')}</div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={lbl}>{t('Provider *', 'Proveedor *')}</label>
                  <select value={blockForm.staff_id} onChange={e => setBlockForm(f => ({ ...f, staff_id: e.target.value }))} style={inp}>
                    <option value="">{t('— Select provider —', '— Seleccionar proveedor —')}</option>
                    {staffList.filter(s => s.status === 'Active').map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={lbl}>{t('Date', 'Fecha')}</label>
                  <input type="date" value={blockForm.block_date} onChange={e => setBlockForm(f => ({ ...f, block_date: e.target.value }))} style={inp} />
                </div>
                <div style={{ ...secHead, marginTop: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>{t('Time & Reason', 'Horario y Razón')}</span>
                  {(() => {
                    const dow = blockForm.block_date ? new Date(blockForm.block_date + 'T12:00:00').getDay() : -1
                    const biz = dow >= 0 ? bizHours[dow] : null
                    if (!biz?.is_open || !biz.open_time || !biz.close_time) return null
                    return (
                      <button
                        onClick={() => setBlockForm(f => ({ ...f, start_time: biz.open_time, end_time: biz.close_time }))}
                        style={{ background: 'none', border: `1px solid ${D.border}`, borderRadius: 4, padding: '2px 9px', fontSize: 11, color: D.muted, cursor: 'pointer' }}
                        onMouseEnter={e => { e.currentTarget.style.color = D.charcoal; e.currentTarget.style.borderColor = D.charcoal }}
                        onMouseLeave={e => { e.currentTarget.style.color = D.muted; e.currentTarget.style.borderColor = D.border }}
                      >
                        {t('All Day', 'Todo el Día')}
                      </button>
                    )
                  })()}
                </div>
                <div>
                  <label style={lbl}>{t('Start Time *', 'Hora de Inicio *')}</label>
                  <TimeSelect value={blockForm.start_time} onChange={v => setBlockForm(f => ({ ...f, start_time: v, end_time: f.end_time && f.end_time <= v ? '' : f.end_time }))} style={inp} />
                </div>
                <div>
                  <label style={lbl}>{t('End Time *', 'Hora de Fin *')}</label>
                  <TimeSelect value={blockForm.end_time} onChange={v => setBlockForm(f => ({ ...f, end_time: v }))} style={inp} after={blockForm.start_time} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={lbl}>{t('Label', 'Etiqueta')}</label>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 7, flexWrap: 'wrap' }}>
                    {([
                      ['Blocked', 'Bloqueado'], ['Lunch', 'Almuerzo'], ['Break', 'Descanso'],
                      ['Time Off', 'Tiempo Libre'], ['Meeting', 'Reunión'], ['Vacation', 'Vacaciones'],
                    ] as [string, string][]).map(([en, es]) => (
                      <button key={en} onClick={() => setBlockForm(f => ({ ...f, label: t(en, es) }))} style={{ background: blockForm.label === t(en, es) || blockForm.label === en || blockForm.label === es ? D.charcoal : 'transparent', color: blockForm.label === t(en, es) || blockForm.label === en || blockForm.label === es ? '#fff' : D.muted, border: `1px solid ${blockForm.label === t(en, es) || blockForm.label === en || blockForm.label === es ? D.charcoal : D.border}`, borderRadius: 4, padding: '3px 9px', fontSize: 11.5, cursor: 'pointer' }}>
                        {t(en, es)}
                      </button>
                    ))}
                  </div>
                  <input value={blockForm.label} onChange={e => setBlockForm(f => ({ ...f, label: e.target.value }))} placeholder={t('Custom label…', 'Etiqueta personalizada…')} style={inp} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={lbl}>{t('Notes', 'Notas')}</label>
                  <textarea value={blockForm.notes} onChange={e => setBlockForm(f => ({ ...f, notes: e.target.value }))} placeholder={t('Optional details…', 'Detalles opcionales…')} rows={2} style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }} />
                </div>
                {blockErr && <div style={{ gridColumn: '1 / -1', color: D.red, fontSize: 12 }}>{blockErr}</div>}
              </div>
            </div>
            <div style={{ padding: '14px 24px', borderTop: `1px solid ${D.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                {blockForm.id && (
                  <button onClick={() => { setBlockModal(false); setConfirmDelBlock({ id: blockForm.id!, staff_id: blockForm.staff_id, block_date: blockForm.block_date, start_time: blockForm.start_time, end_time: blockForm.end_time, label: blockForm.label, notes: blockForm.notes || null }) }} style={{ background: 'transparent', border: '1px solid rgba(185,64,64,0.35)', borderRadius: 6, padding: '8px 14px', fontSize: 12.5, cursor: 'pointer', color: D.red }}>{t('Delete', 'Eliminar')}</button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setBlockModal(false)} style={{ background: 'transparent', border: `1px solid ${D.border}`, borderRadius: 6, padding: '8px 18px', fontSize: 13, cursor: 'pointer', color: D.charcoal }}>{t('Cancel', 'Cancelar')}</button>
                <button onClick={saveBlock} disabled={blockSaving} style={{ background: D.charcoal, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: blockSaving ? 'not-allowed' : 'pointer', opacity: blockSaving ? 0.7 : 1 }}>
                  {blockSaving ? t('Saving…', 'Guardando…') : (blockForm.id ? t('Save Changes', 'Guardar Cambios') : t('Block Time', 'Bloquear Horario'))}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete block confirmation */}
      {confirmDelBlock && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={e => { if (e.target === e.currentTarget) setConfirmDelBlock(null) }}>
          <div style={{ background: '#fff', borderRadius: 10, width: 340, maxWidth: '95vw', boxShadow: '0 8px 32px rgba(0,0,0,0.18)', padding: '24px' }}>
            <h2 style={{ margin: '0 0 10px', fontSize: 16, fontWeight: 700, color: D.charcoal }}>{t('Remove Time Block?', '¿Eliminar Bloqueo?')}</h2>
            <p style={{ margin: '0 0 20px', fontSize: 13, color: D.charcoal }}>
              <strong>{confirmDelBlock.label}</strong> {t('on', 'el')} {fmtDate(confirmDelBlock.block_date)}, {fmtTime(confirmDelBlock.start_time)} – {fmtTime(confirmDelBlock.end_time)} {t('will be removed.', 'será eliminado.')}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => setConfirmDelBlock(null)} style={{ background: 'transparent', border: `1px solid ${D.border}`, borderRadius: 6, padding: '8px 16px', fontSize: 13, cursor: 'pointer', color: D.charcoal }}>{t('Cancel', 'Cancelar')}</button>
              <button onClick={deleteBlock} disabled={deletingBlock} style={{ background: D.red, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: deletingBlock ? 'not-allowed' : 'pointer', opacity: deletingBlock ? 0.7 : 1 }}>
                {deletingBlock ? t('Removing…', 'Eliminando…') : t('Remove', 'Eliminar')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Visit details — shown right after Check In */}
      {visitAppt && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={e => { if (e.target === e.currentTarget) setVisitAppt(null) }}>
          <div style={{ background: '#fff', borderRadius: 10, width: 420, maxWidth: '95vw', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            <div style={{ padding: '20px 24px 14px', borderBottom: `1px solid ${D.border}`, display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ background: '#0E7C7B14', color: '#0E7C7B', border: '1px solid #0E7C7B45', borderRadius: 20, padding: '3px 11px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>● {t('Checked In', 'Registrado')}</span>
              <div style={{ minWidth: 0 }}>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: D.charcoal, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{custName(visitAppt.customers)}</h2>
                <div style={{ fontSize: 12, color: D.muted }}>{visitAppt.staff?.name ?? ''} · {fmtTime(visitAppt.start_time)} · {visitAppt.duration_minutes} min</div>
              </div>
            </div>
            <div style={{ padding: '18px 24px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: D.muted, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>{t('Service', 'Servicio')}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, color: D.charcoal }}>
                <span style={{ fontWeight: 600 }}>{visitAppt.services?.name ?? '—'}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(visitAppt.services?.price ?? 0)}</span>
              </div>
              {visitAddons.length > 0 && (<>
                <div style={{ fontSize: 10, fontWeight: 700, color: D.muted, textTransform: 'uppercase', letterSpacing: '0.8px', margin: '14px 0 8px' }}>{t('Add-ons', 'Complementos')}</div>
                {visitAddons.map(ad => (
                  <div key={ad.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: D.charcoal, marginBottom: 6 }}>
                    <span>{ad.name}{ad.duration_minutes > 0 ? ` · +${ad.duration_minutes} min` : ''}</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(ad.price)}</span>
                  </div>
                ))}
              </>)}
            </div>
            <div style={{ padding: '14px 24px', borderTop: `1px solid ${D.border}`, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => setVisitAppt(null)} style={{ background: 'transparent', border: `1px solid ${D.border}`, borderRadius: 6, padding: '8px 16px', fontSize: 13, cursor: 'pointer', color: D.charcoal }}>{t('Close', 'Cerrar')}</button>
              <button onClick={() => openBill(visitAppt)} style={{ background: '#0E7C7B', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{t('Check Out', 'Finalizar')} →</button>
            </div>
          </div>
        </div>
      )}

      {/* Checkout / ticket */}
      {billAppt && (() => {
        const subtotal = billLines.reduce((s, l) => s + l.amount, 0)
        const tip = parseFloat(billTip) || 0
        const deposit = Number(billAppt.deposit_paid) || 0
        const total = subtotal + tip - deposit
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={e => { if (e.target === e.currentTarget) setBillAppt(null) }}>
            <div style={{ background: '#fff', borderRadius: 10, width: 440, maxWidth: '95vw', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
              <div style={{ padding: '20px 24px 14px', borderBottom: `1px solid ${D.border}` }}>
                <h2 style={{ margin: '0 0 3px', fontSize: 16, fontWeight: 700, color: D.charcoal }}>{t('Checkout', 'Pago')}</h2>
                <div style={{ fontSize: 12.5, color: D.muted }}>{custName(billAppt.customers)} · {fmtDate(billAppt.appointment_date)} {t('at', 'a las')} {fmtTime(billAppt.start_time)}</div>
              </div>
              <div style={{ padding: '18px 24px' }}>
                {/* Line items */}
                <div style={{ border: `1px solid ${D.border}`, borderRadius: 8, overflow: 'hidden', marginBottom: 14 }}>
                  {billLines.map((l, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 14px', fontSize: 13, color: D.charcoal, borderBottom: `1px solid ${D.border}`, background: i % 2 ? '#F7F4EE' : '#fff' }}>
                      <span>{l.label}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(l.amount)}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 14px', fontSize: 13, color: D.charcoal }}>
                    <span>{t('Subtotal', 'Subtotal')}</span><span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmtMoney(subtotal)}</span>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px' }}>
                  <div><label style={lbl}>{t('Tip', 'Propina')}</label><input type="number" step="0.01" value={billTip} onChange={e => setBillTip(e.target.value)} placeholder="0.00" style={inp} autoFocus /></div>
                  <div><label style={lbl}>{t('Payment Method', 'Método de Pago')}</label><select value={billPayment} onChange={e => setBillPayment(e.target.value)} style={inp}>{paymentMethods.map(pm => <option key={pm.code} value={pm.code}>{pm.name}</option>)}</select></div>
                  <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>{t('Notes', 'Notas')}</label><textarea value={billNotes} onChange={e => setBillNotes(e.target.value)} rows={2} placeholder={t('Optional', 'Opcional')} style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }} /></div>
                </div>
                {/* Total */}
                {deposit > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, fontSize: 13, color: D.charcoal }}>
                    <span>{t('Deposit paid', 'Depósito pagado')}</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>−{fmtMoney(deposit)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: deposit > 0 ? 8 : 14, paddingTop: 12, borderTop: `2px solid ${D.border}` }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: D.charcoal }}>{deposit > 0 ? t('Total Due', 'Total a Pagar') : t('Total', 'Total')}</span>
                  <span style={{ fontSize: 20, fontWeight: 700, color: '#0E7C7B', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(total)}</span>
                </div>
                {/* Square integration — stubbed */}
                <button disabled title={t('Square integration coming soon', 'Integración con Square próximamente')} style={{ width: '100%', marginTop: 14, background: '#F3F1EB', color: D.muted, border: `1px dashed ${D.border}`, borderRadius: 7, padding: '10px', fontSize: 13, fontWeight: 600, cursor: 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  {t('Pay with Square', 'Pagar con Square')} <span style={{ fontSize: 10.5, fontWeight: 500 }}>({t('coming soon', 'próximamente')})</span>
                </button>
              </div>
              <div style={{ padding: '14px 24px', borderTop: `1px solid ${D.border}`, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button onClick={() => setBillAppt(null)} style={{ background: 'transparent', border: `1px solid ${D.border}`, borderRadius: 6, padding: '8px 16px', fontSize: 13, cursor: 'pointer', color: D.charcoal }}>{t('Cancel', 'Cancelar')}</button>
                <button onClick={markPaid} disabled={billSaving} style={{ background: D.green, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: billSaving ? 'not-allowed' : 'pointer', opacity: billSaving ? 0.7 : 1 }}>
                  {billSaving ? t('Saving…', 'Guardando…') : t('Mark as Paid', 'Marcar como Pagado')}
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

const lbl: React.CSSProperties = { display: 'block', fontSize: 11.5, fontWeight: 600, color: 'rgba(74,74,63,0.7)', marginBottom: 4 }
const inp: React.CSSProperties = { width: '100%', padding: '7px 10px', fontSize: 12.5, border: '1px solid #D9D4C8', borderRadius: 5, background: '#fff', color: '#4A4A3F', boxSizing: 'border-box' }
const secHead: React.CSSProperties = { gridColumn: '1 / -1', fontSize: 10, fontWeight: 700, color: 'rgba(74,74,63,0.55)', textTransform: 'uppercase', letterSpacing: '0.8px', paddingBottom: 6, borderBottom: '1px solid #D9D4C8' }
const navBtn: React.CSSProperties = { background: '#fff', border: '1px solid #D9D4C8', borderRadius: 5, padding: '4px 8px', fontSize: 12, cursor: 'pointer', color: '#4A4A3F' }
const actionBtn: React.CSSProperties = { background: 'transparent', border: '1px solid #D9D4C8', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', color: '#4A4A3F' }
const dangerBtn: React.CSSProperties = { background: 'transparent', border: '1px solid rgba(185,64,64,0.35)', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', color: '#B94040' }
