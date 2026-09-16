/**
 * Treillis d'agregats OLAP -- logique pure, sans DOM.
 * Formalisme : F. Ravat, "Modelisation Multidimensionnelle" (p.33-35, 61-62).
 *
 * Un noeud du treillis est un tuple d'indices de niveau, un par dimension.
 * L'indice `levels.length` designe le niveau `All`, implicite : il n'est
 * jamais saisi, mais il fait partie du treillis (p.34, "All, All").
 *
 *   dimensions = [{ name: 'PRODUITS', levels: ['codeP', 'sous_categ', 'categorie'] }]
 *   noeud [1]  ->  "sous_categ"        noeud [3] -> "All"
 */

export const ALL = 'All'

/** Le treillis complet croit comme le produit des hauteurs de hierarchie :
 *  4 dimensions de 5 niveaux = 1296 noeuds, illisibles et lents a dessiner. */
export const MAX_NODES = 500

export const AGGREGATIONS = ['SUM', 'COUNT', 'MIN', 'MAX', 'AVG']

export const keyOf = (node) => node.join(',')
export const parseKey = (key) => key.split(',').map(Number)
export const rankOf = (node) => node.reduce((a, b) => a + b, 0)

/** nom du niveau occupe par la dimension `d` dans ce noeud */
export function levelName(node, dimensions, d) {
  const levels = dimensions[d].levels
  return node[d] >= levels.length ? ALL : levels[node[d]]
}

export function labelOf(node, dimensions) {
  return node.map((_, d) => levelName(node, dimensions, d)).join(', ')
}

export function latticeSize(dimensions) {
  return dimensions.reduce((n, d) => n * (d.levels.length + 1), 1)
}

/** le noeud le plus fin : toutes les dimensions a leur niveau cle
 *  (p.35, "donnees detaillees" = la table de faits elle-meme) */
export const baseKey = (dimensions) => keyOf(dimensions.map(() => 0))

/**
 * Treillis complet (p.34) : tous les agregats possibles, relies par les
 * aretes de roll-up. Une arete ne remonte QU'UNE dimension d'UN niveau --
 * les raccourcis diagonaux se deduisent par transitivite et alourdiraient
 * le dessin sans rien ajouter.
 */
export function buildLattice(dimensions) {
  if (dimensions.length === 0) return { nodes: [], edges: [] }

  const total = latticeSize(dimensions)
  if (total > MAX_NODES) {
    throw new RangeError(
      `Treillis de ${total} noeuds (maximum ${MAX_NODES}). ` +
        `Retire une dimension ou un niveau de hierarchie.`,
    )
  }

  const sizes = dimensions.map((d) => d.levels.length + 1)
  let tuples = [[]]
  for (const size of sizes) {
    const next = []
    for (const t of tuples) for (let i = 0; i < size; i++) next.push([...t, i])
    tuples = next
  }

  const nodes = tuples.map((t) => ({
    key: keyOf(t),
    index: t,
    rank: rankOf(t),
    label: labelOf(t, dimensions),
  }))

  const edges = []
  for (const t of tuples) {
    for (let d = 0; d < sizes.length; d++) {
      if (t[d] + 1 >= sizes[d]) continue
      const up = [...t]
      up[d] += 1
      edges.push({ from: keyOf(t), to: keyOf(up) })
    }
  }
  return { nodes, edges }
}

/** `a` est assez fin pour produire `b` par agregation (ordre partiel du treillis) */
export function canDerive(a, b) {
  return a.length === b.length && a.every((v, i) => v <= b[i])
}

/** rang croissant, puis cle -- ordre topologique stable : un agregat ne
 *  precede jamais sa source, dont le rang est strictement plus faible. */
function byRankThenKey(x, y) {
  return rankOf(parseKey(x)) - rankOf(parseKey(y)) || x.localeCompare(y)
}

/**
 * Treillis partiel (p.35) : chaque agregat materialise se calcule depuis son
 * plus proche ancetre materialise, pas depuis les donnees detaillees --
 * c'est ce qui donne Agg2 <- Agg1 <- VENTES plutot que Agg2 <- VENTES.
 * Le noeud de base est toujours materialise : c'est la table de faits.
 */
export function derivations(materializedKeys, dimensions) {
  const keys = [...new Set([...materializedKeys, baseKey(dimensions)])].sort(byRankThenKey)
  const links = []
  for (const to of keys) {
    const target = parseKey(to)
    let best = null
    let bestRank = -1
    for (const from of keys) {
      if (from === to) continue
      const source = parseKey(from)
      if (!canDerive(source, target)) continue
      const rank = rankOf(source)
      // rang maximal = ancetre le plus proche ; a rang egal la cle tranche,
      // pour que deux executions produisent le meme graphe
      if (rank > bestRank || (rank === bestRank && from < best)) {
        best = from
        bestRank = rank
      }
    }
    if (best !== null) links.push({ from: best, to })
  }
  return links
}

/** Agg1, Agg2... dans l'ordre topologique ; la base garde le nom du fait. */
export function aggregateNames(materializedKeys, dimensions, factName = 'FAITS') {
  const base = baseKey(dimensions)
  const names = new Map([[base, factName]])
  const aggs = [...new Set(materializedKeys)].filter((k) => k !== base).sort(byRankThenKey)
  aggs.forEach((k, i) => names.set(k, `Agg${i + 1}`))
  return names
}

/**
 * Re-agreger un agregat n'utilise pas toujours la fonction de la premiere
 * passe : un COUNT se re-agrege en SUM, et une moyenne ne se re-agrege pas
 * du tout -- mesure non additive (p.7, "generalement numerique et additive").
 */
function reaggregate(agg, fromDetail) {
  if (fromDetail) return { fn: agg, note: null }
  if (agg === 'COUNT') return { fn: 'SUM', note: null }
  if (agg === 'AVG') {
    return {
      fn: 'AVG',
      note: 'AVG n’est pas additive : a recalculer depuis les donnees detaillees',
    }
  }
  return { fn: agg, note: null }
}

/** Vues materialisees Oracle correspondant au treillis partiel (p.62). */
export function toSql(dimensions, measures, materializedKeys, factName = 'FAITS') {
  const base = baseKey(dimensions)
  const mats = [...new Set([...materializedKeys, base])]
  const names = aggregateNames(mats, dimensions, factName)
  const sourceOf = new Map(derivations(mats, dimensions).map((l) => [l.to, l.from]))
  const aggs = mats.filter((k) => k !== base).sort(byRankThenKey)

  if (aggs.length === 0) return '-- Aucun agregat selectionne : coche des noeuds du treillis.'

  return aggs
    .map((key) => {
      const node = parseKey(key)
      const groupBy = node
        .map((_, d) => levelName(node, dimensions, d))
        .filter((name) => name !== ALL)
      const from = sourceOf.get(key) ?? base
      const notes = []
      const cols = measures.map((m) => {
        const { fn, note } = reaggregate(m.agg, from === base)
        if (note) notes.push(`-- ${m.name} : ${note}`)
        return `       ${fn}(${m.name}) AS ${m.name}`
      })
      const select = [...groupBy.map((g) => `       ${g}`), ...cols].join(',\n')
      const lines = [
        ...notes,
        `CREATE MATERIALIZED VIEW ${names.get(key)}`,
        'BUILD IMMEDIATE REFRESH COMPLETE ON DEMAND',
        'AS SELECT',
        select,
        `FROM ${names.get(from)}`,
      ]
      if (groupBy.length > 0) lines.push(`GROUP BY ${groupBy.join(', ')};`)
      else lines[lines.length - 1] += ';'
      return lines.join('\n')
    })
    .join('\n\n')
}

/* ------------------------------------------------------------------ */
/* Format de travail de l'app (export / import)                        */
/* ------------------------------------------------------------------ */

export function toOwnFormat(state) {
  return {
    version: 1,
    factName: state.factName,
    measures: state.measures,
    dimensions: state.dimensions.map((d) => ({
      name: d.name,
      levels: d.levels,
      ...(d.hierarchies?.length ? { hierarchies: d.hierarchies } : {}),
    })),
    materialized: state.materialized,
    mode: state.mode,
  }
}

/** Verification structurelle seulement, mais elle nomme le champ fautif :
 *  sans elle une forme inattendue casserait au fond du rendu avec un
 *  "Cannot read properties of undefined". */
export function fromOwnFormat(json) {
  const fail = (why) => {
    throw new Error(`fichier JSON invalide — ${why}`)
  }
  if (!json || typeof json !== 'object') fail('le contenu n’est pas un objet')
  if (!Array.isArray(json.dimensions)) fail('"dimensions" doit etre un tableau')

  const dimensions = json.dimensions.map((d, i) => {
    if (!d || typeof d.name !== 'string') fail(`dimensions[${i}].name manquant`)
    if (!Array.isArray(d.levels) || !d.levels.every((l) => typeof l === 'string')) {
      fail(`dimensions[${i}].levels doit etre un tableau de chaines`)
    }
    return {
      name: d.name,
      levels: [...d.levels],
      hierarchies: Array.isArray(d.hierarchies) ? d.hierarchies : [],
    }
  })

  const measures = (Array.isArray(json.measures) ? json.measures : []).map((m, i) => {
    if (!m || typeof m.name !== 'string') fail(`measures[${i}].name manquant`)
    return { name: m.name, agg: AGGREGATIONS.includes(m.agg) ? m.agg : 'SUM' }
  })

  return {
    factName: typeof json.factName === 'string' ? json.factName : 'FAITS',
    measures,
    dimensions,
    materialized: (Array.isArray(json.materialized) ? json.materialized : []).filter(
      (k) => typeof k === 'string',
    ),
    mode: json.mode === 'partial' ? 'partial' : 'complete',
  }
}

/* ------------------------------------------------------------------ */
/* Import du JSON de l'app de modelisation OLAP (appmodelisationolap)  */
/* ------------------------------------------------------------------ */

/** Le format de l'autre app porte le chemin de chaque hierarchie dans
 *  `hierarchies[].path` (ids de parametres, du plus fin au plus general) :
 *  c'est exactement un axe de treillis. */
export function isOlapSchema(json) {
  return (
    !!json &&
    typeof json === 'object' &&
    Array.isArray(json.dimensions) &&
    json.dimensions.some((d) => Array.isArray(d?.hierarchies))
  )
}

export function fromOlapSchema(json) {
  if (!isOlapSchema(json)) throw new Error('Ce fichier n’est pas un schema OLAP exportable.')

  const facts = Array.isArray(json.facts) ? json.facts : json.fact ? [json.fact] : []
  const fact = facts[0]
  const factName = fact?.name || 'FAITS'
  const measures = (fact?.measures ?? []).map((m) => ({ name: m.name, agg: 'SUM' }))

  const dimensions = json.dimensions.map((d) => {
    const nameOf = new Map((d.parameters ?? []).map((p) => [p.id, p.name]))
    // plusieurs hierarchies = plusieurs axes possibles ; l'UI laisse choisir,
    // la premiere sert de defaut
    const hierarchies = (d.hierarchies ?? [])
      .map((h) => ({
        name: h.name || 'H',
        levels: (h.path ?? []).map((id) => nameOf.get(id)).filter(Boolean),
      }))
      .filter((h) => h.levels.length > 0)

    // une dimension sans hierarchie garde au moins sa cle comme unique niveau
    const fallbackKey = nameOf.get(d.keyParameterId)
    const levels = hierarchies[0]?.levels ?? (fallbackKey ? [fallbackKey] : [])

    return { name: d.name, levels, hierarchies }
  })

  return { factName, measures, dimensions: dimensions.filter((d) => d.levels.length > 0) }
}
