export function normKey(desc: string): string {
  return (desc || '')
    .toLowerCase()
    .replace(/#\w+/g, '')
    .replace(/\*\w+/g, '')
    .replace(/\b\d+\b/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function wordSim(a: string, b: string): number {
  const words = (s: string) => new Set(s.split(/\s+/).filter(w => w.length > 2))
  const wa = words(a), wb = words(b)
  if (!wa.size || !wb.size) return 0
  let inter = 0
  wa.forEach(w => { if (wb.has(w)) inter++ })
  return inter / Math.max(wa.size, wb.size)
}

export function buildCatIndex(descCatMap: Record<string, string>): Record<string, Array<{ key: string; cat: string }>> {
  const idx: Record<string, Array<{ key: string; cat: string }>> = {}
  for (const [key, cat] of Object.entries(descCatMap)) {
    key.split(/\s+/).filter(w => w.length > 2).forEach(w => {
      if (!idx[w]) idx[w] = []
      idx[w].push({ key, cat })
    })
  }
  return idx
}

export function suggestCat(key: string, idx: Record<string, Array<{ key: string; cat: string }>>, threshold = 0.4): string {
  const candidates = new Map<string, string>()
  key.split(/\s+/).filter(w => w.length > 2).forEach(w => {
    ;(idx[w] || []).forEach(({ key: k, cat }) => candidates.set(k, cat))
  })
  let bestScore = 0, bestCat = ''
  candidates.forEach((cat, k) => {
    const score = wordSim(key, k)
    if (score > bestScore) { bestScore = score; bestCat = cat }
  })
  return bestScore >= threshold ? bestCat : ''
}

export interface MerchantGroup {
  key: string
  displayDesc: string
  txns: unknown[]
  total: number
  suggestedCat: string
  variants?: string[]
  isSeparated?: boolean
}

export function suggestCatByAmount(
  amount: number,
  existingTxns: Array<{ amount: string | number; category: string | null }>,
  tolerance = 0.15,
): string {
  if (amount === 0) return ''
  const counts: Record<string, number> = {}
  existingTxns.forEach(t => {
    if (!t.category) return
    const a = typeof t.amount === 'number' ? t.amount : parseFloat(String(t.amount))
    if (isNaN(a) || a === 0) return
    if (Math.abs(a - amount) / Math.abs(amount) <= tolerance) {
      counts[t.category] = (counts[t.category] || 0) + 1
    }
  })
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
}

export function clusterGroups(groups: MerchantGroup[], threshold = 0.45): { clusters: MerchantGroup[]; keyToCluster: Record<string, string> } {
  if (!groups.length) return { clusters: [], keyToCluster: {} }

  const parent = groups.map((_, i) => i)
  const rank = new Array(groups.length).fill(0)
  function find(i: number): number { return parent[i] === i ? i : (parent[i] = find(parent[i])) }
  function union(i: number, j: number) {
    const [pi, pj] = [find(i), find(j)]
    if (pi === pj) return
    if (rank[pi] < rank[pj])       parent[pi] = pj
    else if (rank[pi] > rank[pj])  parent[pj] = pi
    else                         { parent[pj] = pi; rank[pi]++ }
  }

  const buckets: Record<string, number[]> = {}
  groups.forEach((g, i) => {
    const lead = g.key.split(/\s+/).find(w => w.length > 3) ?? g.key.split(/\s+/)[0] ?? ''
    if (!lead) return
    ;(buckets[lead] ??= []).push(i)
  })

  for (const idxs of Object.values(buckets)) {
    for (let a = 0; a < idxs.length; a++)
      for (let b = a + 1; b < idxs.length; b++)
        if (wordSim(groups[idxs[a]].key, groups[idxs[b]].key) >= threshold)
          union(idxs[a], idxs[b])
  }

  const clusterMap: Record<number, number[]> = {}
  groups.forEach((_, i) => {
    const root = find(i)
    if (!clusterMap[root]) clusterMap[root] = []
    clusterMap[root].push(i)
  })

  const keyToCluster: Record<string, string> = {}
  const clusters: MerchantGroup[] = Object.values(clusterMap).map(memberIdxs => {
    const repIdx = memberIdxs.reduce((best, i) =>
      (groups[i].txns as unknown[]).length > (groups[best].txns as unknown[]).length ? i : best, memberIdxs[0]
    )
    const rep = groups[repIdx]
    const allTxns = memberIdxs.flatMap(i => groups[i].txns)
    const total = memberIdxs.reduce((s, i) => s + groups[i].total, 0)
    const sugCat = rep.suggestedCat || memberIdxs.map(i => groups[i].suggestedCat).find(Boolean) || ''
    const variants = memberIdxs.length > 1
      ? memberIdxs.filter(i => i !== repIdx).map(i => groups[i].displayDesc)
      : []
    memberIdxs.forEach(i => { keyToCluster[groups[i].key] = rep.key })
    return { key: rep.key, displayDesc: rep.displayDesc, txns: allTxns, total, suggestedCat: sugCat, variants }
  })

  return {
    clusters: clusters.sort((a, b) => a.key.localeCompare(b.key)),
    keyToCluster,
  }
}
