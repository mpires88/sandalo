// localStorage-backed database that mirrors the Supabase JS query builder API.
// Swap the import alias in any component to switch between local and remote:
//   import { localDb as supabase } from '@/lib/localDb'
//   import { supabase }            from '@/lib/supabase'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>
type DbResponse<T> = { data: T | null; error: { message: string } | null }

function getTable(name: string): Row[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(`sandalo_db_${name}`) ?? '[]')
  } catch { return [] }
}

function setTable(name: string, rows: Row[]): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(`sandalo_db_${name}`, JSON.stringify(rows))
}

function genId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)
}

type Op = 'select' | 'insert' | 'update' | 'upsert' | 'delete'

class QueryBuilder {
  private _table: string
  private _filters: Array<(row: Row) => boolean> = []
  private _orderField?: string
  private _orderAsc = true
  private _rangeFrom?: number
  private _rangeTo?: number
  private _selectFields?: string[]
  private _op: Op = 'select'
  private _writePayload?: Row | Row[]
  private _writeOpts?: { onConflict?: string; ignoreDuplicates?: boolean }

  constructor(table: string) {
    this._table = table
  }

  select(fields?: string): this {
    if (this._op === 'select') {
      if (fields && fields !== '*') {
        this._selectFields = fields.split(',').map(f => f.trim())
      }
    }
    // select() after a write op is a no-op — write already returns affected rows
    return this
  }

  eq(field: string, value: unknown): this {
    this._filters.push(row => row[field] === value)
    return this
  }

  neq(field: string, value: unknown): this {
    this._filters.push(row => row[field] !== value)
    return this
  }

  not(field: string, op: string, value: unknown): this {
    if (op === 'is') this._filters.push(row => row[field] !== value)
    return this
  }

  in(field: string, values: unknown[]): this {
    this._filters.push(row => values.includes(row[field]))
    return this
  }

  order(field: string, opts?: { ascending?: boolean }): this {
    this._orderField = field
    this._orderAsc = opts?.ascending !== false
    return this
  }

  range(from: number, to: number): this {
    this._rangeFrom = from
    this._rangeTo = to
    return this
  }

  insert(data: Row | Row[]): this {
    this._op = 'insert'
    this._writePayload = data
    return this
  }

  update(changes: Row): this {
    this._op = 'update'
    this._writePayload = changes
    return this
  }

  upsert(data: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }): this {
    this._op = 'upsert'
    this._writePayload = data
    this._writeOpts = opts
    return this
  }

  delete(): this {
    this._op = 'delete'
    return this
  }

  private _run(): Row[] | null {
    if (typeof window === 'undefined') return null

    const match = (row: Row) => this._filters.every(f => f(row))
    const table = getTable(this._table)

    if (this._op === 'select') {
      let rows = table.filter(match)
      if (this._orderField) {
        const field = this._orderField, asc = this._orderAsc
        rows = [...rows].sort((a, b) => {
          const av = a[field], bv = b[field]
          if (av === bv) return 0
          if (av == null) return asc ? -1 : 1
          if (bv == null) return asc ? 1 : -1
          return (av < bv ? -1 : 1) * (asc ? 1 : -1)
        })
      }
      if (this._rangeFrom != null && this._rangeTo != null) {
        rows = rows.slice(this._rangeFrom, this._rangeTo + 1)
      }
      if (this._selectFields) {
        const fields = this._selectFields
        return rows.map(row => Object.fromEntries(fields.map(f => [f, row[f]])))
      }
      return rows
    }

    if (this._op === 'insert') {
      const incoming = (Array.isArray(this._writePayload)
        ? this._writePayload : [this._writePayload]) as Row[]
      const stamped = incoming.map(r => ({ id: genId(), ...r }))
      setTable(this._table, [...table, ...stamped])
      return stamped
    }

    if (this._op === 'update') {
      const changes = this._writePayload as Row
      const updated: Row[] = []
      const next = table.map(row => {
        if (match(row)) {
          const u = { ...row, ...changes }
          updated.push(u)
          return u
        }
        return row
      })
      setTable(this._table, next)
      return updated
    }

    if (this._op === 'upsert') {
      const incoming = (Array.isArray(this._writePayload)
        ? this._writePayload : [this._writePayload]) as Row[]
      const conflictFields = this._writeOpts?.onConflict?.split(',').map(s => s.trim()) ?? []
      const ignoreDups = this._writeOpts?.ignoreDuplicates ?? false
      const next = [...table]
      const result: Row[] = []

      for (const newRow of incoming) {
        const idx = conflictFields.length
          ? next.findIndex(r => conflictFields.every(f => r[f] === newRow[f]))
          : -1

        if (idx >= 0) {
          if (!ignoreDups) {
            next[idx] = { ...next[idx], ...newRow }
            result.push(next[idx])
          }
          // ignoreDups: skip silently, no result entry
        } else {
          const stamped = { id: genId(), ...newRow }
          next.push(stamped)
          result.push(stamped)
        }
      }

      setTable(this._table, next)
      return result
    }

    if (this._op === 'delete') {
      setTable(this._table, table.filter(row => !match(row)))
      return null
    }

    return null
  }

  // PromiseLike — makes `await localDb.from(...).select(...)` work
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  then<R1 = { data: any; error: any }, R2 = never>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onFulfilled?: ((v: { data: any; error: any }) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((r: unknown) => R2 | PromiseLike<R2>) | null
  ): Promise<R1 | R2> {
    return Promise.resolve()
      .then(() => {
        try {
          return { data: this._run(), error: null }
        } catch (e) {
          return { data: null, error: { message: String(e) } }
        }
      })
      .then(onFulfilled as never, onRejected as never)
  }
}

export const localDb = {
  from(table: string): QueryBuilder {
    return new QueryBuilder(table)
  },
}
