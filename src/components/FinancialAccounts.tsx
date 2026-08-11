'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

const CLIENT_ID = '00000000-0000-0000-0000-000000000001'

const D = {
  sage: '#2C5F52',
  gold: '#C8A96E',
  page: '#F5F0E8',
  border: '#E5DDD0',
  card: '#FFFFFF',
  muted: '#9B8FA0',
  charcoal: '#4A4A3F',
  green: '#16a34a',
  red: '#dc2626',
  steel: '#6B7280',
}

export type AccountType = 'checking' | 'savings' | 'credit_card' | 'line_of_credit' | 'other'

export interface FinancialAccount {
  id: string
  client_id: string
  name: string
  institution: string | null
  last_four: string | null
  account_type: AccountType
  parent_category: string | null
  sort_order: number
  created_at: string
}

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: 'Checking',
  savings: 'Savings',
  credit_card: 'Credit Card',
  line_of_credit: 'Line of Credit',
  other: 'Other',
}

export function accountSection(type: AccountType): 'asset' | 'liability' {
  return type === 'credit_card' || type === 'line_of_credit' ? 'liability' : 'asset'
}

const ASSET_SECTIONS = ['Current Assets', 'Non-Current Assets']
const LIAB_SECTIONS = ['Current Liabilities', 'Non-Current Liabilities']

const EMPTY_FORM = {
  name: '',
  institution: '',
  last_four: '',
  account_type: 'checking' as AccountType,
  parent_category: '',
}

const lbl: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: D.charcoal,
  textTransform: 'uppercase',
  letterSpacing: '0.4px',
  marginBottom: 4,
  display: 'block',
}
const inp: React.CSSProperties = {
  width: '100%',
  padding: '7px 10px',
  border: `1px solid ${D.border}`,
  borderRadius: 5,
  fontSize: 13,
  color: D.charcoal,
  background: '#fff',
  boxSizing: 'border-box',
}

export default function FinancialAccounts() {
  const [accounts, setAccounts] = useState<FinancialAccount[]>([])
  const [txnCounts, setTxnCounts] = useState<Record<string, number>>({})
  const [categories, setCategories] = useState<{ name: string; pl_section: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<FinancialAccount | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: accts }, { data: cats }] = await Promise.all([
      supabase.from('financial_accounts').select('*').eq('client_id', CLIENT_ID).order('sort_order'),
      supabase
        .from('categories')
        .select('name, pl_section')
        .eq('client_id', CLIENT_ID)
        .in('pl_section', [...ASSET_SECTIONS, ...LIAB_SECTIONS])
        .order('sort_order'),
    ])
    setAccounts(accts ?? [])
    setCategories(cats ?? [])
    // Count per account via HEAD requests — avoids row-limit issues
    const countResults = await Promise.all(
      (accts ?? []).map(a =>
        supabase
          .from('bank_transactions')
          .select('*', { count: 'exact', head: true })
          .eq('client_id', CLIENT_ID)
          .eq('source_account_id', a.id)
          .then(({ count }) => ({ id: a.id, count: count ?? 0 })),
      ),
    )
    const counts: Record<string, number> = {}
    countResults.forEach(({ id, count }) => {
      counts[id] = count
    })
    setTxnCounts(counts)
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function openAdd() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setErr('')
    setModal(true)
  }
  function openEdit(a: FinancialAccount) {
    setEditing(a)
    setForm({
      name: a.name,
      institution: a.institution ?? '',
      last_four: a.last_four ?? '',
      account_type: a.account_type,
      parent_category: a.parent_category ?? '',
    })
    setErr('')
    setModal(true)
  }

  async function save() {
    if (!form.name.trim()) {
      setErr('Name is required')
      return
    }
    setSaving(true)
    setErr('')
    const section = accountSection(form.account_type)
    const sectionAccts = accounts.filter(a => accountSection(a.account_type) === section)
    const maxOrder = sectionAccts.reduce((m, a) => Math.max(m, a.sort_order ?? 0), -1)
    const payload = {
      client_id: CLIENT_ID,
      name: form.name.trim(),
      institution: form.institution.trim() || null,
      last_four: form.last_four.trim() || null,
      account_type: form.account_type,
      parent_category: form.parent_category || null,
      ...(!editing ? { sort_order: maxOrder + 1 } : {}),
    }
    const { error } = editing
      ? await supabase.from('financial_accounts').update(payload).eq('id', editing.id).eq('client_id', CLIENT_ID)
      : await supabase.from('financial_accounts').insert(payload)
    if (error) {
      setErr(error.message)
      setSaving(false)
      return
    }
    setModal(false)
    await load()
    setSaving(false)
  }

  async function del(id: string) {
    const count = txnCounts[id] ?? 0
    const msg =
      count > 0
        ? `This account has ${count} linked transaction${count > 1 ? 's' : ''}. Deleting it will unlink them. Continue?`
        : 'Delete this account?'
    if (!confirm(msg)) return
    await supabase.from('financial_accounts').delete().eq('id', id).eq('client_id', CLIENT_ID)
    await load()
  }

  async function move(id: string, direction: 'up' | 'down') {
    const acct = accounts.find(a => a.id === id)
    if (!acct) return
    const section = accountSection(acct.account_type)
    const sectionAccts = accounts.filter(a => accountSection(a.account_type) === section).slice() // already sorted by sort_order from DB
    const idx = sectionAccts.findIndex(a => a.id === id)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= sectionAccts.length) return
    const a = sectionAccts[idx]
    const b = sectionAccts[swapIdx]
    await Promise.all([
      supabase
        .from('financial_accounts')
        .update({ sort_order: b.sort_order })
        .eq('id', a.id)
        .eq('client_id', CLIENT_ID),
      supabase
        .from('financial_accounts')
        .update({ sort_order: a.sort_order })
        .eq('id', b.id)
        .eq('client_id', CLIENT_ID),
    ])
    await load()
  }

  const assets = accounts.filter(a => accountSection(a.account_type) === 'asset')
  const liabilities = accounts.filter(a => accountSection(a.account_type) === 'liability')

  function AccountTable({ rows, section }: { rows: FinancialAccount[]; section: 'asset' | 'liability' }) {
    const color = section === 'asset' ? D.green : D.red
    return (
      <section style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2
            style={{
              margin: 0,
              fontSize: 13,
              fontWeight: 700,
              color: D.charcoal,
              textTransform: 'uppercase',
              letterSpacing: '0.6px',
            }}
          >
            {section === 'asset' ? 'Bank Accounts — Assets' : 'Credit & Lines of Credit — Liabilities'}
          </h2>
          <button
            onClick={openAdd}
            style={{
              background: D.sage,
              color: '#fff',
              border: 'none',
              borderRadius: 5,
              padding: '5px 12px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            + Add
          </button>
        </div>

        {rows.length === 0 ? (
          <div
            style={{
              background: D.card,
              border: `1px solid ${D.border}`,
              borderRadius: 8,
              padding: '20px 16px',
              color: D.muted,
              fontSize: 13,
              textAlign: 'center',
            }}
          >
            No {section === 'asset' ? 'bank accounts' : 'credit accounts'} yet
          </div>
        ) : (
          <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: D.page }}>
                  {['', 'Account', 'Institution', 'Last 4', 'Type', 'BS Position', 'Transactions', ''].map((h, i) => (
                    <th
                      key={i}
                      style={{
                        padding: '8px 14px',
                        textAlign: h === 'Transactions' ? 'right' : 'left',
                        fontSize: 10.5,
                        fontWeight: 700,
                        color: D.muted,
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                        borderBottom: `1px solid ${D.border}`,
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((a, idx) => (
                  <tr key={a.id} style={{ borderBottom: `1px solid ${D.border}` }}>
                    <td style={{ padding: '6px 8px 6px 14px', whiteSpace: 'nowrap' }}>
                      <button
                        onClick={() => move(a.id, 'up')}
                        disabled={idx === 0}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: idx === 0 ? D.border : D.muted,
                          cursor: idx === 0 ? 'default' : 'pointer',
                          fontSize: 10,
                          padding: '1px 3px',
                          lineHeight: 1,
                        }}
                      >
                        ▲
                      </button>
                      <button
                        onClick={() => move(a.id, 'down')}
                        disabled={idx === rows.length - 1}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: idx === rows.length - 1 ? D.border : D.muted,
                          cursor: idx === rows.length - 1 ? 'default' : 'pointer',
                          fontSize: 10,
                          padding: '1px 3px',
                          lineHeight: 1,
                        }}
                      >
                        ▼
                      </button>
                    </td>
                    <td style={{ padding: '10px 14px', fontWeight: 600, color: D.charcoal }}>{a.name}</td>
                    <td style={{ padding: '10px 14px', color: D.steel }}>{a.institution ?? '—'}</td>
                    <td style={{ padding: '10px 14px', color: D.steel, fontFamily: 'monospace' }}>
                      {a.last_four ? `••••${a.last_four}` : '—'}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span
                        style={{
                          background: `${color}15`,
                          color,
                          fontSize: 11,
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: 10,
                        }}
                      >
                        {ACCOUNT_TYPE_LABELS[a.account_type]}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', color: a.parent_category ? D.charcoal : D.muted, fontSize: 12 }}>
                      {a.parent_category ?? '— Default —'}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', color: D.muted, fontSize: 12 }}>
                      {txnCounts[a.id] ?? 0}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        onClick={() => openEdit(a)}
                        style={{
                          background: 'none',
                          border: `1px solid ${D.border}`,
                          color: D.steel,
                          borderRadius: 4,
                          padding: '3px 8px',
                          fontSize: 11,
                          cursor: 'pointer',
                          marginRight: 6,
                        }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => del(a.id)}
                        style={{
                          background: 'none',
                          border: `1px solid ${D.border}`,
                          color: D.red,
                          borderRadius: 4,
                          padding: '3px 8px',
                          fontSize: 11,
                          cursor: 'pointer',
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    )
  }

  const validParents = categories.filter(c => {
    const s = accountSection(form.account_type)
    return s === 'asset' ? ASSET_SECTIONS.includes(c.pl_section) : LIAB_SECTIONS.includes(c.pl_section)
  })

  const parentsBySection = validParents.reduce<Record<string, string[]>>((acc, c) => {
    if (!acc[c.pl_section]) acc[c.pl_section] = []
    acc[c.pl_section].push(c.name)
    return acc
  }, {})

  return (
    <div style={{ padding: '28px 32px', maxWidth: 960, margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 24px', fontSize: 20, fontWeight: 700, color: D.charcoal }}>Financial Accounts</h1>

      {loading ? (
        <div style={{ color: D.muted, fontSize: 13 }}>Loading…</div>
      ) : (
        <>
          <AccountTable rows={assets} section="asset" />
          <AccountTable rows={liabilities} section="liability" />
        </>
      )}

      {modal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={e => {
            if (e.target === e.currentTarget) setModal(false)
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 10,
              padding: '26px 26px 18px',
              width: 440,
              boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
            }}
          >
            <h2 style={{ margin: '0 0 18px', fontSize: 15, fontWeight: 700, color: D.sage }}>
              {editing ? 'Edit Account' : 'Add Account'}
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={lbl}>Account Name *</label>
                <input
                  style={inp}
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Chase Business Checking"
                />
              </div>
              <div>
                <label style={lbl}>Type *</label>
                <select
                  style={inp}
                  value={form.account_type}
                  onChange={e =>
                    setForm(f => ({ ...f, account_type: e.target.value as AccountType, parent_category: '' }))
                  }
                >
                  <optgroup label="Assets">
                    <option value="checking">Checking</option>
                    <option value="savings">Savings</option>
                    <option value="other">Other</option>
                  </optgroup>
                  <optgroup label="Liabilities">
                    <option value="credit_card">Credit Card</option>
                    <option value="line_of_credit">Line of Credit</option>
                  </optgroup>
                </select>
              </div>
              <div>
                <label style={lbl}>Balance Sheet Position</label>
                <select
                  style={inp}
                  value={form.parent_category}
                  onChange={e => setForm(f => ({ ...f, parent_category: e.target.value }))}
                >
                  <option value="">— Default section —</option>
                  {Object.entries(parentsBySection).map(([section, names]) => (
                    <optgroup key={section} label={section}>
                      {names.map(n => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={lbl}>Institution</label>
                  <input
                    style={inp}
                    value={form.institution}
                    onChange={e => setForm(f => ({ ...f, institution: e.target.value }))}
                    placeholder="e.g. Chase"
                  />
                </div>
                <div>
                  <label style={lbl}>Last 4 digits</label>
                  <input
                    style={inp}
                    value={form.last_four}
                    onChange={e => setForm(f => ({ ...f, last_four: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                    placeholder="1234"
                    maxLength={4}
                  />
                </div>
              </div>
            </div>
            {err && <div style={{ marginTop: 10, color: D.red, fontSize: 12 }}>{err}</div>}
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8,
                marginTop: 20,
                paddingTop: 14,
                borderTop: `1px solid ${D.border}`,
              }}
            >
              <button
                onClick={() => setModal(false)}
                style={{
                  background: 'none',
                  border: `1px solid ${D.border}`,
                  color: D.steel,
                  borderRadius: 5,
                  padding: '6px 14px',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                style={{
                  background: D.sage,
                  color: '#fff',
                  border: 'none',
                  borderRadius: 5,
                  padding: '6px 16px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: saving ? 'not-allowed' : 'pointer',
                  opacity: saving ? 0.7 : 1,
                }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
