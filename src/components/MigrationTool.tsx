'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { loadPlSections, loadParents } from '@/lib/chartOfAccounts'

const D = {
  sage: '#2C5F52',
  gold: '#C8A96E',
  charcoal: '#4A4A3F',
  page: '#F5F0E8',
  card: '#FAFAF8',
  border: '#D9D4C8',
  red: '#B94040',
  green: '#2E7D52',
  muted: 'rgba(74,74,63,0.55)',
}

interface MigrationResult {
  txnsMigrated: number
  txnsSkipped: number
  categoriesInserted: number
  categoriesUpdated: number
  staffMigrated: number
  loansMigrated: number
  paymentsMigrated: number
  reportsMigrated: number
  errors: string[]
}

export default function MigrationTool({ clientId }: { clientId: string }) {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<MigrationResult | null>(null)
  const [log, setLog] = useState<string[]>([])

  function addLog(msg: string) {
    setLog(prev => [...prev, msg])
  }

  async function runMigration() {
    setRunning(true)
    setResult(null)
    setLog([])

    const errors: string[] = []
    let txnsMigrated = 0
    let txnsSkipped = 0
    let categoriesInserted = 0
    let categoriesUpdated = 0
    let staffMigrated = 0
    let loansMigrated = 0
    let paymentsMigrated = 0
    let reportsMigrated = 0

    // ── 1. Bank transactions ───────────────────────────────────────────────
    addLog('Reading bank transactions from localStorage…')
    try {
      const raw = localStorage.getItem('sandalo_db_bank_transactions')
      const rows: Record<string, unknown>[] = raw ? JSON.parse(raw) : []

      if (rows.length === 0) {
        addLog('  No transactions found.')
      } else {
        addLog(`  Found ${rows.length} transactions. Uploading…`)
        const records = rows.map(r => ({
          client_id: r.client_id ?? clientId,
          transaction_date: r.transaction_date,
          description: r.description,
          amount: r.amount,
          account: r.account ?? null,
          category: r.category ?? null,
          reference_id: r.reference_id ?? null,
        }))

        for (let i = 0; i < records.length; i += 500) {
          const batch = records.slice(i, i + 500)
          const { data, error } = await supabase
            .from('bank_transactions')
            .upsert(batch, { onConflict: 'client_id,transaction_date,description,amount', ignoreDuplicates: true })
            .select()
          if (error) {
            errors.push(`Transactions batch ${i / 500 + 1}: ${error.message}`)
            addLog(`  ✗ Batch ${i / 500 + 1} failed: ${error.message}`)
          } else {
            const inserted = data?.length ?? 0
            txnsMigrated += inserted
            txnsSkipped += batch.length - inserted
            addLog(`  ✓ Batch ${i / 500 + 1}: ${inserted} inserted, ${batch.length - inserted} skipped`)
          }
        }
      }
    } catch (e) {
      const msg = `Failed to read transactions: ${e}`
      errors.push(msg)
      addLog('  ✗ ' + msg)
    }

    // ── 2. Categories (chart of accounts) ─────────────────────────────────
    addLog('Reading categories from localStorage…')
    try {
      // 2a. Full rows from localDb
      const rawCats = localStorage.getItem('sandalo_db_categories')
      const catRows: Record<string, unknown>[] = rawCats ? JSON.parse(rawCats) : []

      if (catRows.length > 0) {
        addLog(`  Found ${catRows.length} category rows. Upserting…`)
        const records = catRows.map(r => ({
          client_id: r.client_id ?? clientId,
          name: r.name,
          sort_order: r.sort_order ?? 0,
          pl_section: r.pl_section ?? null,
          parent: r.parent ?? null,
        }))
        const { data, error } = await supabase
          .from('categories')
          .upsert(records, { onConflict: 'name', ignoreDuplicates: false })
          .select()
        if (error) {
          errors.push(`Categories upsert: ${error.message}`)
          addLog(`  ✗ Categories upsert failed: ${error.message}`)
        } else {
          categoriesInserted = data?.length ?? 0
          addLog(`  ✓ ${categoriesInserted} categories upserted`)
        }
      } else {
        addLog('  No category rows found in localDb.')
      }

      // 2b. pl_section / parent overrides from legacy localStorage keys
      const plSections = loadPlSections()
      const parents = loadParents()
      const names = new Set([...Object.keys(plSections), ...Object.keys(parents)])

      if (names.size > 0) {
        addLog(`  Found ${names.size} pl_section/parent overrides. Updating…`)
        for (const name of names) {
          const updates: Record<string, unknown> = {}
          if (plSections[name]) updates.pl_section = plSections[name]
          if (parents[name]) updates.parent = parents[name]
          const { error } = await supabase.from('categories').update(updates).eq('name', name)
          if (error) {
            errors.push(`Category "${name}": ${error.message}`)
            addLog(`  ✗ "${name}": ${error.message}`)
          } else {
            categoriesUpdated++
          }
        }
        addLog(`  ✓ Updated ${categoriesUpdated} categories`)
      }
    } catch (e) {
      const msg = `Failed to migrate categories: ${e}`
      errors.push(msg)
      addLog('  ✗ ' + msg)
    }

    // ── 3. Staff ───────────────────────────────────────────────────────────
    addLog('Reading staff from localStorage…')
    try {
      const raw = localStorage.getItem('sandalo_db_staff')
      const rows: Record<string, unknown>[] = raw ? JSON.parse(raw) : []

      if (rows.length === 0) {
        addLog('  No staff found.')
      } else {
        addLog(`  Found ${rows.length} staff members. Uploading…`)
        const records = rows.map(r => ({
          id: r.id,
          client_id: r.client_id ?? clientId,
          name: r.name,
          role: r.role ?? 'Staff',
          status: r.status ?? 'Active',
          phone: r.phone ?? null,
          email: r.email ?? null,
          notes: r.notes ?? null,
        }))
        const { data, error } = await supabase
          .from('staff')
          .upsert(records, { onConflict: 'id', ignoreDuplicates: true })
          .select()
        if (error) {
          errors.push(`Staff: ${error.message}`)
          addLog(`  ✗ Staff upload failed: ${error.message}`)
        } else {
          staffMigrated = data?.length ?? 0
          addLog(`  ✓ ${staffMigrated} staff members migrated`)
        }
      }
    } catch (e) {
      const msg = `Failed to migrate staff: ${e}`
      errors.push(msg)
      addLog('  ✗ ' + msg)
    }

    // ── 4. Loans ───────────────────────────────────────────────────────────
    addLog('Reading loans from localStorage…')
    try {
      const raw = localStorage.getItem('sandalo_db_loans')
      const rows: Record<string, unknown>[] = raw ? JSON.parse(raw) : []

      if (rows.length === 0) {
        addLog('  No loans found.')
      } else {
        addLog(`  Found ${rows.length} loans. Uploading…`)
        const records = rows.map(r => ({
          id: r.id,
          client_id: r.client_id ?? clientId,
          name: r.name,
          lender: r.lender ?? null,
          instrument_type: r.instrument_type ?? 'term_loan',
          loan_type: r.loan_type ?? 'amortizing',
          original_principal: r.original_principal,
          interest_rate: r.interest_rate ?? null,
          factor_rate: r.factor_rate ?? null,
          holdback_pct: r.holdback_pct ?? null,
          start_date: r.start_date,
          term_months: r.term_months ?? 0,
          payment_frequency: r.payment_frequency ?? 'monthly',
          payment_amount: r.payment_amount ?? 0,
          balloon_amount: r.balloon_amount ?? null,
          notes: r.notes ?? null,
        }))
        const { data, error } = await supabase
          .from('loans')
          .upsert(records, { onConflict: 'id', ignoreDuplicates: true })
          .select()
        if (error) {
          errors.push(`Loans: ${error.message}`)
          addLog(`  ✗ Loans upload failed: ${error.message}`)
        } else {
          loansMigrated = data?.length ?? 0
          addLog(`  ✓ ${loansMigrated} loans migrated`)
        }
      }
    } catch (e) {
      const msg = `Failed to migrate loans: ${e}`
      errors.push(msg)
      addLog('  ✗ ' + msg)
    }

    // ── 5. Loan payments ───────────────────────────────────────────────────
    addLog('Reading loan payments from localStorage…')
    try {
      const raw = localStorage.getItem('sandalo_db_loan_payments')
      const rows: Record<string, unknown>[] = raw ? JSON.parse(raw) : []

      if (rows.length === 0) {
        addLog('  No loan payments found.')
      } else {
        addLog(`  Found ${rows.length} loan payments. Uploading…`)
        const records = rows.map(r => ({
          id: r.id,
          client_id: r.client_id ?? clientId,
          loan_id: r.loan_id,
          transaction_id: r.transaction_id ?? null,
          payment_date: r.payment_date,
          total_amount: r.total_amount,
          principal_amount: r.principal_amount,
          interest_amount: r.interest_amount,
          fees_amount: r.fees_amount ?? 0,
          notes: r.notes ?? null,
        }))

        for (let i = 0; i < records.length; i += 500) {
          const batch = records.slice(i, i + 500)
          const { data, error } = await supabase
            .from('loan_payments')
            .upsert(batch, { onConflict: 'id', ignoreDuplicates: true })
            .select()
          if (error) {
            errors.push(`Loan payments batch ${i / 500 + 1}: ${error.message}`)
            addLog(`  ✗ Batch ${i / 500 + 1} failed: ${error.message}`)
          } else {
            const inserted = data?.length ?? 0
            paymentsMigrated += inserted
            addLog(`  ✓ Batch ${i / 500 + 1}: ${inserted} payments migrated`)
          }
        }
      }
    } catch (e) {
      const msg = `Failed to migrate loan payments: ${e}`
      errors.push(msg)
      addLog('  ✗ ' + msg)
    }

    // ── 6. Square reports ──────────────────────────────────────────────────
    addLog('Reading Square reports from localStorage…')
    try {
      const raw = localStorage.getItem('sandalo_db_square_reports')
      const rows: Record<string, unknown>[] = raw ? JSON.parse(raw) : []

      if (rows.length === 0) {
        addLog('  No Square reports found.')
      } else {
        addLog(`  Found ${rows.length} reports. Uploading…`)
        const records = rows.map(r => ({
          client_id: r.client_id ?? clientId,
          period: r.period,
          gross_sales: r.gross_sales ?? null,
          returns: r.returns ?? null,
          discounts: r.discounts ?? null,
          net_sales: r.net_sales ?? null,
          tax_collected: r.tax_collected ?? null,
          fees: r.fees ?? null,
          net_total: r.net_total ?? null,
          cash_amount: r.cash_amount ?? null,
          card_amount: r.card_amount ?? null,
          categories: r.categories ?? null,
        }))
        const { data, error } = await supabase
          .from('square_reports')
          .upsert(records, { onConflict: 'client_id,period', ignoreDuplicates: true })
          .select()
        if (error) {
          errors.push(`Square reports: ${error.message}`)
          addLog(`  ✗ Square reports upload failed: ${error.message}`)
        } else {
          reportsMigrated = data?.length ?? 0
          addLog(`  ✓ ${reportsMigrated} reports migrated`)
        }
      }
    } catch (e) {
      const msg = `Failed to migrate Square reports: ${e}`
      errors.push(msg)
      addLog('  ✗ ' + msg)
    }

    addLog('Migration complete.')
    setResult({
      txnsMigrated,
      txnsSkipped,
      categoriesInserted,
      categoriesUpdated,
      staffMigrated,
      loansMigrated,
      paymentsMigrated,
      reportsMigrated,
      errors,
    })
    setRunning(false)
  }

  const stats = result
    ? [
        { label: 'Transactions Inserted', value: result.txnsMigrated, color: D.green },
        { label: 'Transactions Skipped', value: result.txnsSkipped, color: D.muted },
        { label: 'Categories Upserted', value: result.categoriesInserted, color: D.sage },
        { label: 'Categories Updated', value: result.categoriesUpdated, color: D.sage },
        { label: 'Staff', value: result.staffMigrated, color: D.gold },
        { label: 'Loans', value: result.loansMigrated, color: D.gold },
        { label: 'Loan Payments', value: result.paymentsMigrated, color: D.gold },
        { label: 'Square Reports', value: result.reportsMigrated, color: D.charcoal },
      ]
    : []

  return (
    <div style={{ padding: '32px', maxWidth: 720, background: D.page, minHeight: '100vh' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: D.sage, margin: '0 0 6px' }}>
        localStorage → Supabase Migration
      </h1>
      <p style={{ fontSize: 13, color: D.muted, margin: '0 0 28px' }}>
        One-time tool to copy all local data into Supabase. Safe to run multiple times — duplicates are skipped.
      </p>

      <div
        style={{
          background: D.card,
          border: `1px solid ${D.border}`,
          borderRadius: 8,
          padding: '18px 20px',
          marginBottom: 20,
        }}
      >
        <h2 style={{ fontSize: 13, fontWeight: 600, color: D.charcoal, margin: '0 0 10px' }}>What this migrates</h2>
        <ul style={{ fontSize: 12.5, color: D.charcoal, margin: 0, paddingLeft: 20, lineHeight: 1.9 }}>
          <li>
            <strong>Bank transactions</strong> — <code>sandalo_db_bank_transactions</code>
          </li>
          <li>
            <strong>Chart of accounts</strong> — <code>sandalo_db_categories</code>, <code>sandalo_pl_sections</code>,{' '}
            <code>sandalo_parents</code>
          </li>
          <li>
            <strong>Staff</strong> — <code>sandalo_db_staff</code>
          </li>
          <li>
            <strong>Loans</strong> — <code>sandalo_db_loans</code>
          </li>
          <li>
            <strong>Loan payments</strong> — <code>sandalo_db_loan_payments</code>
          </li>
          <li>
            <strong>Square reports</strong> — <code>sandalo_db_square_reports</code>
          </li>
        </ul>
      </div>

      <button
        onClick={runMigration}
        disabled={running}
        style={{
          background: running ? D.muted : D.sage,
          color: '#fff',
          border: 'none',
          borderRadius: 7,
          padding: '10px 24px',
          fontSize: 13.5,
          fontWeight: 600,
          cursor: running ? 'not-allowed' : 'pointer',
          marginBottom: 24,
        }}
      >
        {running ? 'Migrating…' : 'Run Migration'}
      </button>

      {log.length > 0 && (
        <div
          style={{
            background: '#1a1a1a',
            color: '#d4d4d4',
            borderRadius: 7,
            padding: '14px 16px',
            fontSize: 11.5,
            fontFamily: 'monospace',
            lineHeight: 1.7,
            marginBottom: 20,
            maxHeight: 360,
            overflowY: 'auto',
          }}
        >
          {log.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}

      {result && (
        <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 8, padding: '18px 20px' }}>
          <h2 style={{ fontSize: 13, fontWeight: 600, color: D.charcoal, margin: '0 0 12px' }}>Results</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 14 }}>
            {stats.map(c => (
              <div
                key={c.label}
                style={{ background: D.page, borderRadius: 6, padding: '10px 12px', textAlign: 'center' }}
              >
                <div style={{ fontSize: 20, fontWeight: 700, color: c.color }}>{c.value}</div>
                <div style={{ fontSize: 10, color: D.muted, marginTop: 3, lineHeight: 1.4 }}>{c.label}</div>
              </div>
            ))}
          </div>
          {result.errors.length > 0 ? (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '10px 14px' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: D.red, marginBottom: 6 }}>
                {result.errors.length} error(s)
              </div>
              {result.errors.map((e, i) => (
                <div key={i} style={{ fontSize: 11.5, color: D.red }}>
                  {e}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12.5, color: D.green, fontWeight: 500 }}>✓ Migration completed with no errors.</div>
          )}
        </div>
      )}
    </div>
  )
}
