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

/**
 * Libelle affiche : une dimension au niveau `All` n'apporte rien a la lecture,
 * on la tait. Le noeud tout en haut du treillis n'a plus alors aucun niveau a
 * montrer -- il reste `All`, qui dit bien ce qu'il est : le total.
 *
 * Reste injectif tant que deux dimensions ne partagent pas un nom de niveau :
 * deux noeuds distincts different sur au moins une dimension, et la taire d'un
 * cote la laisse visible de l'autre.
 */
export function displayLabel(node, dimensions) {
  const vus = node
    .map((_, d) => levelName(node, dimensions, d))
    .filter((name) => name !== ALL)
  return vus.length ? vus.join(', ') : ALL
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

/** Ordre canonique d'une selection d'agregats. C'est celui dont
 *  `aggregateNames` tire Agg1, Agg2... : trier la selection avec lui garde
 *  toute liste affichee dans le meme ordre que les noms. */
export const sortKeys = (keys) => [...keys].sort(byRankThenKey)

/**
 * Treillis partiel (p.35) : chaque agregat materialise se calcule depuis son
 * plus proche ancetre materialise, pas depuis les donnees detaillees --
 * c'est ce qui donne Agg2 <- Agg1 <- VENTES plutot que Agg2 <- VENTES.
 * Le noeud de base est toujours materialise : c'est la table de faits.
 */
export function derivations(materializedKeys, dimensions, sources = {}) {
  const keys = [...new Set([...materializedKeys, baseKey(dimensions)])].sort(byRankThenKey)
  const present = new Set(keys)
  const links = []
  for (const to of keys) {
    const target = parseKey(to)

    // source imposee a la main. Elle doit rester plus fine que sa cible : cet
    // ordre etant strict, un cycle est impossible -- inutile de le verifier.
    const forced = sources[to]
    if (forced && forced !== to && present.has(forced) && canDerive(parseKey(forced), target)) {
      links.push({ from: forced, to, forced: true })
      continue
    }

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
    if (best !== null) links.push({ from: best, to, forced: false })
  }
  return links
}

/** Sources admissibles pour un agregat : les noeuds materialises strictement
 *  plus fins que lui, table de faits comprise. Rien d'autre ne peut le
 *  produire par agregation. */
export function validSources(key, materializedKeys, dimensions) {
  const target = parseKey(key)
  return sortKeys(
    [...new Set([...materializedKeys, baseKey(dimensions)])].filter(
      (k) => k !== key && canDerive(parseKey(k), target),
    ),
  )
}

/**
 * Agregat qui repond a une analyse (p.35 : les fleches A1 -> Agg1, A2 -> Agg2).
 * Une analyse groupant au niveau L se sert de n'importe quel agregat plus fin
 * ou egal ; le meilleur est le plus grossier d'entre eux, celui qui laisse le
 * moins de lignes a parcourir. La table de faits convient toujours -- y
 * atterrir signifie simplement que l'analyse n'est acceleree par rien.
 */
export function analysisSource(levels, materializedKeys, dimensions) {
  let best = null
  let bestRank = -1
  for (const key of new Set([...materializedKeys, baseKey(dimensions)])) {
    const node = parseKey(key)
    if (!canDerive(node, levels)) continue
    const rank = rankOf(node)
    if (rank > bestRank || (rank === bestRank && key < best)) {
      best = key
      bestRank = rank
    }
  }
  return best
}

/**
 * Ce qui empeche un agregat de repondre a une analyse : les dimensions ou il
 * est plus grossier qu'elle. Un agregat au mois ne peut pas repondre au jour,
 * le detail n'existe plus. Tableau vide = rattachement valable.
 *
 * Sert au rattachement impose a la main : on laisse choisir, mais on dit quand
 * le choix ne tient pas -- plutot que de dessiner une fleche qui ment.
 */
export function analysisIssue(levels, targetKey, dimensions) {
  const target = parseKey(targetKey)
  // un niveau absent vaut 0, le plus fin : sans ce defaut, comparer a
  // `undefined` rend toute comparaison fausse et l'incompatibilite passait
  // inapercue au lieu d'etre signalee
  return dimensions
    .map((d, i) => ((target[i] ?? 0) > (levels[i] ?? 0) ? d.name : null))
    .filter(Boolean)
}

/**
 * Attributs faibles utilisables par une analyse. Un attribut faible depend de
 * SON parametre (p.8 : "dont la valeur depend de la valeur du parametre
 * associe"), mais la dependance remonte la hierarchie : si l'analyse groupe
 * par CodeE, chaque groupe est UN employe, donc UNE societe, donc un seul
 * NomSOC. L'attribut est donc utilisable des que l'analyse est au niveau de
 * son parametre ou PLUS FIN -- on peut afficher NomSOC sans CodeSOC, le code
 * restant dans l'agregat. Au niveau plus grossier (Ville regroupe plusieurs
 * societes) il redeviendrait indetermine : `i <= k` et pas l'inverse.
 *
 * Il n'ajoute aucune granularite -- c'est une colonne de plus, pas un axe --
 * donc il ne change pas quel agregat repond a l'analyse : l'agregat qui sert
 * deja le niveau de l'analyse sert forcement ce qu'il determine.
 */
export function availableWeak(levels, dimensions) {
  return dimensions.flatMap((d, i) =>
    Object.entries(d.weak ?? {}).flatMap(([k, noms]) =>
      // `All` (indice >= levels.length) ne determine plus rien : exclu de fait
      levels[i] <= Number(k)
        ? noms.map((name) => ({ dimension: d.name, level: d.levels[Number(k)], name }))
        : [],
    ),
  )
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
 * Identifiant SQL. On ne met des guillemets QUE si le nom l'exige : sous
 * Oracle, "codeP" entre guillemets devient sensible a la casse et ne designe
 * plus la meme colonne que codeP. Les quoter tous casserait l'usage normal ;
 * n'en quoter aucun produit du SQL invalide des qu'un nom contient un espace.
 */
export function sqlName(name) {
  return /^[A-Za-z][A-Za-z0-9_$#]*$/.test(name) ? name : `"${String(name).replace(/"/g, '""')}"`
}

/**
 * Colonnes de mesures d'une vue agregee.
 *
 * Re-agreger n'utilise pas toujours la fonction de la premiere passe : un
 * COUNT se cumule en SUM. Et une MOYENNE ne se re-agrege pas du tout -- la
 * moyenne des moyennes n'est pas la moyenne (p.7, "generalement numerique et
 * additive"). Plutot que d'emettre un AVG faux avec un commentaire d'excuse,
 * on stocke de quoi la recalculer : sa somme et son effectif, tous deux
 * additifs. La moyenne se lit alors `<mesure>_som / <mesure>_nb`.
 */
function measureColumns(measures, fromDetail) {
  const cols = []
  const notes = []
  for (const m of measures) {
    const nom = sqlName(m.name)
    const som = sqlName(`${m.name}_som`)
    const nb = sqlName(`${m.name}_nb`)
    if (m.agg === 'AVG') {
      cols.push(`       ${fromDetail ? `SUM(${nom})` : `SUM(${som})`} AS ${som}`)
      cols.push(`       ${fromDetail ? `COUNT(${nom})` : `SUM(${nb})`} AS ${nb}`)
      notes.push(`-- ${m.name} : moyenne = ${m.name}_som / ${m.name}_nb (AVG n'est pas additive)`)
    } else if (m.agg === 'COUNT') {
      cols.push(`       ${fromDetail ? 'COUNT' : 'SUM'}(${nom}) AS ${nom}`)
    } else {
      cols.push(`       ${m.agg}(${nom}) AS ${nom}`)
    }
  }
  return { cols, notes }
}

/** Vues materialisees Oracle correspondant au treillis partiel (p.62). */
export function toSql(dimensions, measures, materializedKeys, factName = 'FAITS', sources = {}) {
  const base = baseKey(dimensions)
  const mats = [...new Set([...materializedKeys, base])]
  const names = aggregateNames(mats, dimensions, factName)
  const sourceOf = new Map(derivations(mats, dimensions, sources).map((l) => [l.to, l.from]))
  const aggs = mats.filter((k) => k !== base).sort(byRankThenKey)

  if (aggs.length === 0) return '-- Aucun agregat selectionne : coche des noeuds du treillis.'

  return aggs
    .map((key) => {
      const node = parseKey(key)
      const groupBy = node
        .map((_, d) => levelName(node, dimensions, d))
        .filter((name) => name !== ALL)
        .map(sqlName)
      const from = sourceOf.get(key) ?? base
      const { cols, notes } = measureColumns(measures, from === base)
      const select = [...groupBy.map((g) => `       ${g}`), ...cols].join(',\n')
      const lines = [
        ...notes,
        `CREATE MATERIALIZED VIEW ${sqlName(names.get(key))}`,
        'BUILD IMMEDIATE REFRESH COMPLETE ON DEMAND',
        'AS SELECT',
        select,
        `FROM ${sqlName(names.get(from))}`,
      ]
      if (groupBy.length > 0) lines.push(`GROUP BY ${groupBy.join(', ')};`)
      else lines[lines.length - 1] += ';'
      return lines.join('\n')
    })
    .join('\n\n')
}

/**
 * Elague une selection devenue incoherente avec les dimensions.
 *
 * Les cles de noeuds encodent des indices de niveau : retirer une dimension ou
 * raccourcir une hierarchie les rend caduques. Fonction PURE, pour deux
 * usages : l'appliquer a l'etat courant, et la simuler sur des dimensions
 * hypothetiques afin de chiffrer ce qu'une suppression couterait AVANT de la
 * faire.
 *
 * `dimensions` doit deja etre filtre : une dimension sans niveau n'est pas un
 * axe et ne compte pas dans l'arite des cles.
 */
export function pruneSelection(selection, dimensions) {
  const sizes = dimensions.map((d) => d.levels.length + 1)
  const base = baseKey(dimensions)

  const materialized = sortKeys(
    new Set(
      (selection.materialized ?? []).filter((key) => {
        const node = parseKey(key)
        return (
          key !== base && // la table de faits est implicite, jamais listee
          node.length === sizes.length &&
          node.every((v, i) => Number.isInteger(v) && v >= 0 && v < sizes[i])
        )
      }),
    ),
  )

  const presents = new Set([...materialized, base])

  // une source qui n'est plus materialisee, ou devenue trop grossiere apres un
  // remaniement des niveaux, redevient automatique plutot que de pointer dans
  // le vide
  const sources = Object.fromEntries(
    Object.entries(selection.sources ?? {}).filter(
      ([to, from]) =>
        presents.has(to) &&
        presents.has(from) &&
        validSources(to, materialized, dimensions).includes(from),
    ),
  )

  const analyses = (selection.analyses ?? []).map((a, i) => {
    const { target, ...reste } = a
    const levels = dimensions.map((d, j) => {
      const v = a.levels?.[j]
      return Number.isInteger(v) && v >= 0 && v <= d.levels.length ? v : 0
    })
    const dispo = new Set(availableWeak(levels, dimensions).map((w) => w.name))
    return {
      ...reste,
      id: a.id ?? `an${i}`,
      levels,
      // un attribut faible ne vaut qu'au niveau dont il depend : changer ce
      // niveau le retire de l'analyse
      extras: (a.extras ?? []).filter((x) => dispo.has(x)),
      // un rattachement impose vers un agregat supprime redevient automatique
      ...(target && presents.has(target) ? { target } : {}),
    }
  })

  // une fleche libre dont une extremite a disparu n'a plus de sens
  const ancres = new Set([...presents, ...analyses.map((a) => `A:${a.id}`)])
  const freeArrows = (selection.freeArrows ?? []).filter(
    (f) => ancres.has(f.from) && ancres.has(f.to),
  )

  // un pli designe un lien par ses deux extremites : si l'une disparait, le
  // lien n'est plus trace et le pli n'a plus d'objet
  const lienVivant = ([id]) => {
    const [de, vers] = id.split('>')
    return ancres.has(de) && ancres.has(vers)
  }
  const edgeBends = Object.fromEntries(Object.entries(selection.edgeBends ?? {}).filter(lienVivant))
  const edgeAnchors = Object.fromEntries(
    Object.entries(selection.edgeAnchors ?? {}).filter(lienVivant),
  )

  return { materialized, sources, analyses, freeArrows, edgeBends, edgeAnchors }
}

/** Ce qu'une selection contient de choix explicites -- ce qu'on perdrait a
 *  l'elaguer. Les analyses survivent toujours, mais leur rattachement impose
 *  peut sauter : il compte. */
export function selectionSize(selection) {
  return (
    (selection.materialized?.length ?? 0) +
    Object.keys(selection.sources ?? {}).length +
    (selection.freeArrows?.length ?? 0) +
    (selection.analyses ?? []).filter((a) => a.target).length
  )
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
      // tableau parallele a `levels` : weak[i] liste les attributs faibles du
      // niveau levels[i]. Omis quand il n'y en a aucun.
      ...(Object.keys(d.weak ?? {}).length ? { weak: d.weak } : {}),
      ...(d.hierarchies?.length ? { hierarchies: d.hierarchies } : {}),
    })),
    materialized: state.materialized,
    // omis quand vides : un fichier sans source forcee ni analyse garde la
    // forme qu'il avait avant que ces deux champs existent
    ...(Object.keys(state.sources ?? {}).length ? { sources: state.sources } : {}),
    ...(state.analyses?.length ? { analyses: state.analyses } : {}),
    ...(state.freeArrows?.length ? { freeArrows: state.freeArrows } : {}),
    ...(Object.keys(state.edgeBends ?? {}).length ? { edgeBends: state.edgeBends } : {}),
    ...(Object.keys(state.edgeAnchors ?? {}).length ? { edgeAnchors: state.edgeAnchors } : {}),
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
    const weak = {}
    if (d.weak && typeof d.weak === 'object') {
      for (const [i, liste] of Object.entries(d.weak)) {
        if (Array.isArray(liste)) weak[i] = liste.filter((x) => typeof x === 'string')
      }
    }
    return {
      name: d.name,
      levels: [...d.levels],
      weak,
      hierarchies: Array.isArray(d.hierarchies) ? d.hierarchies : [],
    }
  })

  const measures = (Array.isArray(json.measures) ? json.measures : []).map((m, i) => {
    if (!m || typeof m.name !== 'string') fail(`measures[${i}].name manquant`)
    return { name: m.name, agg: AGGREGATIONS.includes(m.agg) ? m.agg : 'SUM' }
  })

  const sources = {}
  if (json.sources && typeof json.sources === 'object' && !Array.isArray(json.sources)) {
    for (const [to, from] of Object.entries(json.sources)) {
      if (typeof from === 'string') sources[to] = from
    }
  }

  const analyses = (Array.isArray(json.analyses) ? json.analyses : []).map((a, i) => {
    if (!a || typeof a.name !== 'string') fail(`analyses[${i}].name manquant`)
    if (!Array.isArray(a.levels) || !a.levels.every((v) => Number.isInteger(v))) {
      fail(`analyses[${i}].levels doit etre un tableau d’entiers`)
    }
    return {
      name: a.name,
      levels: [...a.levels],
      // une analyse peut porter plusieurs mesures. `measure` au singulier est
      // l'ancien format : relu tel quel, les fichiers deja exportes s'ouvrent.
      measures: Array.isArray(a.measures)
        ? a.measures.filter((m) => typeof m === 'string')
        : typeof a.measure === 'string'
          ? [a.measure]
          : measures[0]
            ? [measures[0].name]
            : [],
      // les attributs faibles affiches par l'analyse : des colonnes de plus,
      // sans effet sur la granularite ni sur le rattachement
      extras: Array.isArray(a.extras) ? a.extras.filter((x) => typeof x === 'string') : [],
      id: typeof a.id === 'string' ? a.id : `an${i}`,
      // rattachement impose ; absent = calcule par analysisSource
      ...(typeof a.target === 'string' ? { target: a.target } : {}),
    }
  })

  return {
    factName: typeof json.factName === 'string' ? json.factName : 'FAITS',
    measures,
    dimensions,
    materialized: (Array.isArray(json.materialized) ? json.materialized : []).filter(
      (k) => typeof k === 'string',
    ),
    sources,
    analyses,
    // fleches tracees a la main, hors semantique du treillis : on ne verifie
    // que la forme, pas que les extremites existent -- pruneSelection s'en
    // charge a chaque rendu
    freeArrows: (Array.isArray(json.freeArrows) ? json.freeArrows : [])
      .filter((a) => a && typeof a.from === 'string' && typeof a.to === 'string')
      .map((a) => ({ from: a.from, to: a.to, label: typeof a.label === 'string' ? a.label : '' })),
    // inflechissement manuel d'un lien, en ecart au milieu du segment
    edgeBends: Object.fromEntries(
      Object.entries(json.edgeBends ?? {}).filter(
        ([, v]) => v && Number.isFinite(v.dx) && Number.isFinite(v.dy),
      ),
    ),
    // ou la fleche se pose sur chaque boite, en fraction de leur largeur.
    // Un nombre nu est l'ancien format, ou seule l'arrivee etait reglable.
    edgeAnchors: Object.fromEntries(
      Object.entries(json.edgeAnchors ?? {})
        .map(([id, v]) => {
          if (Number.isFinite(v)) return [id, { to: v }]
          if (!v || typeof v !== 'object') return null
          const bouts = {}
          for (const bout of ['from', 'to']) {
            if (Number.isFinite(v[bout])) bouts[bout] = v[bout]
          }
          return Object.keys(bouts).length ? [id, bouts] : null
        })
        .filter(Boolean),
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

    // p.8 : un attribut faible complete la semantique d'UN parametre. On
    // indexe par ID et non par nom : deux parametres homonymes dans une meme
    // dimension se marcheraient dessus.
    const weakOf = new Map(
      (d.parameters ?? []).map((p) => [p.id, (p.weakAttributes ?? []).map((w) => w.name)]),
    )

    // plusieurs hierarchies = plusieurs axes possibles ; l'UI laisse choisir,
    // la premiere sert de defaut. Chacune porte SES attributs faibles : ils
    // sont indexes par position dans le chemin, qui change d'une hierarchie
    // a l'autre.
    const hierarchies = (d.hierarchies ?? [])
      .map((h) => {
        const chemin = (h.path ?? []).filter((id) => nameOf.has(id))
        const weak = {}
        chemin.forEach((id, i) => {
          const liste = weakOf.get(id) ?? []
          if (liste.length) weak[i] = liste
        })
        return { name: h.name || 'H', levels: chemin.map((id) => nameOf.get(id)), weak }
      })
      .filter((h) => h.levels.length > 0)

    // une dimension sans hierarchie garde au moins sa cle comme unique niveau
    const cle = d.keyParameterId
    const secours = nameOf.get(cle)
    const levels = hierarchies[0]?.levels ?? (secours ? [secours] : [])
    const weak =
      hierarchies[0]?.weak ?? (secours && weakOf.get(cle)?.length ? { 0: weakOf.get(cle) } : {})

    return { name: d.name, levels, weak, hierarchies }
  })

  // l'autre app ne connait que le schema : tout ce qui est propre au treillis
  // (materialisation, analyses, trace des fleches) demarre vide -- mais DOIT
  // exister, le rendu itere dessus sans garde.
  return {
    factName,
    measures,
    dimensions: dimensions.filter((d) => d.levels.length > 0),
    materialized: [],
    sources: {},
    analyses: [],
    freeArrows: [],
    edgeBends: {},
    edgeAnchors: {},
    mode: 'complete',
  }
}
