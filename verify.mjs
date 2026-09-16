/**
 * Controle du coeur du treillis : on rejoue les figures du cours.
 *   node verify.mjs
 *
 * Les attendus ne sont pas inventes -- ils sont lus sur les planches
 * p.34 (treillis complet) et p.35 / p.61-62 (treillis partiel + vues).
 */
import assert from 'node:assert/strict'
import {
  MAX_NODES,
  aggregateNames,
  baseKey,
  buildLattice,
  canDerive,
  derivations,
  fromOlapSchema,
  fromOwnFormat,
  labelOf,
  latticeSize,
  parseKey,
  sortKeys,
  toOwnFormat,
  toSql,
} from './lattice.js'

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`  ok  ${name}`)
}

/* --- p.34 : treillis complet VENTES x {PRODUITS, TEMPS} ----------------- */

const p34 = [
  { name: 'PRODUITS', levels: ['codeP', 'sous_categ', 'categorie'] },
  { name: 'TEMPS', levels: ['codeT', 'num_mois', 'annee'] },
]

check('p.34 -- 16 noeuds (4 niveaux x 4 niveaux, All compris)', () => {
  assert.equal(latticeSize(p34), 16)
  assert.equal(buildLattice(p34).nodes.length, 16)
})

check('p.34 -- les 16 libelles sont exactement ceux de la planche', () => {
  const attendu = new Set([
    'codeP, codeT', 'sous_categ, codeT', 'categorie, codeT', 'All, codeT',
    'codeP, num_mois', 'sous_categ, num_mois', 'categorie, num_mois', 'All, num_mois',
    'codeP, annee', 'sous_categ, annee', 'categorie, annee', 'All, annee',
    'codeP, All', 'sous_categ, All', 'categorie, All', 'All, All',
  ])
  const obtenu = new Set(buildLattice(p34).nodes.map((n) => n.label))
  assert.deepEqual(obtenu, attendu)
})

check('p.34 -- une arete ne remonte qu’une dimension d’un niveau', () => {
  const { edges } = buildLattice(p34)
  // 4x4 : 3*4 montees en PRODUITS + 4*3 montees en TEMPS
  assert.equal(edges.length, 24)
  for (const e of edges) {
    const a = parseKey(e.from)
    const b = parseKey(e.to)
    const deltas = a.map((v, i) => b[i] - v)
    assert.equal(deltas.filter((d) => d !== 0).length, 1, `arete diagonale : ${e.from} -> ${e.to}`)
    assert.ok(deltas.every((d) => d === 0 || d === 1), `saut de niveau : ${e.from} -> ${e.to}`)
  }
})

check('p.34 -- le noeud de base est le plus fin, All,All le plus general', () => {
  const { nodes } = buildLattice(p34)
  assert.equal(baseKey(p34), '0,0')
  assert.equal(labelOf([0, 0], p34), 'codeP, codeT')
  const sommet = nodes.find((n) => n.rank === Math.max(...nodes.map((x) => x.rank)))
  assert.equal(sommet.label, 'All, All')
})

check('garde-fou -- au-dela de MAX_NODES noeuds, on refuse au lieu de ramer', () => {
  const enorme = Array.from({ length: 4 }, (_, i) => ({
    name: `D${i}`,
    levels: ['a', 'b', 'c', 'd'],
  }))
  assert.ok(latticeSize(enorme) > MAX_NODES)
  assert.throws(() => buildLattice(enorme), RangeError)
})

/* --- p.35 / p.61 : treillis partiel VENTES x {PRODUITS, TEMPS, CLIENTS} - */

const p35 = [
  { name: 'PRODUITS', levels: ['codeP', 'sous_categ', 'categorie'] },
  { name: 'TEMPS', levels: ['codeT', 'num_mois', 'annee'] },
  { name: 'CLIENTS', levels: ['codeC', 'ville', 'pays'] },
]
const BASE = '0,0,0' //  codeP, codeT,    codeC  -> table de faits VENTES
const AGG1 = '0,1,0' //  codeP, num_mois, codeC
const AGG2 = '3,2,0' //  All,   annee,    codeC  -> "annee, codeC"
const mesures = [
  { name: 'quantite', agg: 'SUM' },
  { name: 'montant', agg: 'SUM' },
]

check('p.35 -- les noeuds choisis portent bien les libelles de la planche', () => {
  assert.equal(labelOf(parseKey(BASE), p35), 'codeP, codeT, codeC')
  assert.equal(labelOf(parseKey(AGG1), p35), 'codeP, num_mois, codeC')
  assert.equal(labelOf(parseKey(AGG2), p35), 'All, annee, codeC')
})

check('p.35 -- Agg2 derive d’Agg1, pas de la table de faits', () => {
  const parCible = (a, b) => a.to.localeCompare(b.to)
  assert.deepEqual(
    derivations([AGG1, AGG2], p35).sort(parCible),
    [
      { from: BASE, to: AGG1 },
      { from: AGG1, to: AGG2 },
    ].sort(parCible),
  )
})

check('p.35 -- l’ordre partiel refuse une source trop grossiere', () => {
  assert.ok(canDerive(parseKey(AGG1), parseKey(AGG2)), 'Agg1 doit pouvoir produire Agg2')
  assert.ok(!canDerive(parseKey(AGG2), parseKey(AGG1)), 'Agg2 ne peut pas reconstituer Agg1')
})

check('p.35 -- numerotation Agg1/Agg2 dans l’ordre topologique', () => {
  const noms = aggregateNames([AGG2, AGG1], p35, 'VENTES')
  assert.equal(noms.get(BASE), 'VENTES')
  assert.equal(noms.get(AGG1), 'Agg1')
  assert.equal(noms.get(AGG2), 'Agg2')
})

check('p.62 -- le SQL chaine Agg2 sur Agg1 et supprime les niveaux All', () => {
  const sql = toSql(p35, mesures, [AGG1, AGG2], 'VENTES')
  const [bloc1, bloc2] = sql.split('\n\n')

  assert.match(bloc1, /CREATE MATERIALIZED VIEW Agg1/)
  assert.match(bloc1, /FROM VENTES/)
  assert.match(bloc1, /GROUP BY codeP, num_mois, codeC;/)

  assert.match(bloc2, /CREATE MATERIALIZED VIEW Agg2/)
  assert.match(bloc2, /FROM Agg1/, 'Agg2 doit se calculer depuis Agg1 (p.62)')
  assert.match(bloc2, /GROUP BY annee, codeC;/)
  assert.ok(!/All/.test(bloc2), 'le niveau All ne se projette pas en colonne')
})

check('p.7 -- COUNT se re-agrege en SUM, AVG est signalee non additive', () => {
  const sql = toSql(
    p35,
    [{ name: 'nb', agg: 'COUNT' }, { name: 'moy', agg: 'AVG' }],
    [AGG1, AGG2],
    'VENTES',
  )
  const [bloc1, bloc2] = sql.split('\n\n')
  assert.match(bloc1, /COUNT\(nb\)/, 'premiere passe : COUNT sur les donnees detaillees')
  assert.match(bloc2, /SUM\(nb\)/, 'seconde passe : le COUNT se cumule en SUM')
  assert.match(bloc2, /-- moy : AVG/, 'AVG doit porter un avertissement')
})

check('panneau -- sortKeys range les agregats comme aggregateNames les nomme', () => {
  // un ordre d'ajout quelconque : le panneau doit tout de meme lire Agg1, Agg2...
  const desordre = ['3,2,0', '2,0,1', '0,1,0']
  const tries = sortKeys(desordre)
  const noms = aggregateNames(desordre, p35, 'VENTES')
  assert.deepEqual(
    tries.map((k) => noms.get(k)),
    ['Agg1', 'Agg2', 'Agg3'],
  )
  assert.deepEqual(sortKeys(desordre), sortKeys(tries), 'le tri doit etre idempotent')
})

/* --- format de travail : export puis import ---------------------------- */

const travail = {
  factName: 'VENTES',
  measures: mesures,
  dimensions: p35.map((d) => ({ ...d, hierarchies: [] })),
  materialized: [AGG1, AGG2],
  mode: 'partial',
}

check('JSON -- le fichier exporte se recharge a l’identique', () => {
  const relu = fromOwnFormat(JSON.parse(JSON.stringify(toOwnFormat(travail))))
  assert.equal(relu.factName, travail.factName)
  assert.deepEqual(relu.measures, travail.measures)
  assert.deepEqual(
    relu.dimensions.map((d) => ({ name: d.name, levels: d.levels })),
    travail.dimensions.map((d) => ({ name: d.name, levels: d.levels })),
  )
  assert.deepEqual(relu.materialized, travail.materialized)
  assert.equal(relu.mode, 'partial')
})

check('JSON -- la selection rechargee redonne le meme treillis partiel', () => {
  const relu = fromOwnFormat(toOwnFormat(travail))
  assert.deepEqual(
    derivations(relu.materialized, relu.dimensions),
    derivations(travail.materialized, travail.dimensions),
  )
})

check('JSON -- un champ mal forme est nomme, pas avale', () => {
  assert.throws(() => fromOwnFormat(null), /n’est pas un objet/)
  assert.throws(() => fromOwnFormat({ dimensions: 'PRODUITS' }), /"dimensions" doit etre/)
  assert.throws(() => fromOwnFormat({ dimensions: [{ name: 'D', levels: [1] }] }), /dimensions\[0\]\.levels/)
  assert.throws(
    () => fromOwnFormat({ dimensions: [], measures: [{ agg: 'SUM' }] }),
    /measures\[0\]\.name/,
  )
})

check('JSON -- une fonction d’agregation inconnue retombe sur SUM', () => {
  const relu = fromOwnFormat({ dimensions: [], measures: [{ name: 'x', agg: 'MEDIAN' }] })
  assert.equal(relu.measures[0].agg, 'SUM')
})

/* --- pont avec appmodelisationolap ------------------------------------- */

const exportOlap = {
  version: 2,
  facts: [
    {
      id: 'f1',
      name: 'VENTES',
      measures: [{ id: 'm1', name: 'quantite' }, { id: 'm2', name: 'montant' }],
      dimensionIds: ['d1'],
    },
  ],
  dimensions: [
    {
      id: 'd1',
      name: 'PRODUITS',
      keyParameterId: 'p1',
      parameters: [
        { id: 'p1', name: 'codeP', weakAttributes: [] },
        { id: 'p2', name: 'sous_categ', weakAttributes: [] },
        { id: 'p3', name: 'categorie', weakAttributes: [] },
        { id: 'p4', name: 'marque', weakAttributes: [] },
      ],
      hierarchies: [
        { id: 'h1', name: 'H_Pro', path: ['p1', 'p2', 'p3'] },
        { id: 'h2', name: 'H_Marque', path: ['p1', 'p4'] },
      ],
    },
  ],
}

check('import OLAP -- hierarchies[].path devient les niveaux du treillis', () => {
  const { factName, measures, dimensions } = fromOlapSchema(exportOlap)
  assert.equal(factName, 'VENTES')
  assert.deepEqual(measures.map((m) => m.name), ['quantite', 'montant'])
  assert.equal(dimensions.length, 1)
  assert.deepEqual(dimensions[0].levels, ['codeP', 'sous_categ', 'categorie'])
})

check('import OLAP -- les hierarchies alternatives restent proposables', () => {
  const [produits] = fromOlapSchema(exportOlap).dimensions
  assert.deepEqual(
    produits.hierarchies.map((h) => h.name),
    ['H_Pro', 'H_Marque'],
  )
  assert.deepEqual(produits.hierarchies[1].levels, ['codeP', 'marque'])
})

check('import OLAP -- un fichier etranger est refuse avec un message clair', () => {
  assert.throws(() => fromOlapSchema({ hello: 'world' }), /n’est pas un schema OLAP/)
})

console.log(`\n${passed} controles passes.`)
