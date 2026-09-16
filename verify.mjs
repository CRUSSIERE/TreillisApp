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
  linkPath,
  latticeSize,
  analysisSource,
  parseKey,
  sortKeys,
  validSources,
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
  const liens = derivations([AGG1, AGG2], p35)
    .map(({ from, to }) => ({ from, to }))
    .sort((a, b) => a.to.localeCompare(b.to))
  assert.deepEqual(
    liens,
    [
      { from: BASE, to: AGG1 },
      { from: AGG1, to: AGG2 },
    ].sort((a, b) => a.to.localeCompare(b.to)),
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

check('sources -- forcer Agg2 sur la table de faits court-circuite Agg1', () => {
  const liens = derivations([AGG1, AGG2], p35, { [AGG2]: BASE })
  const vers2 = liens.find((l) => l.to === AGG2)
  assert.equal(vers2.from, BASE)
  assert.equal(vers2.forced, true)
  // Agg1 n'etant pas force, il garde son calcul automatique
  assert.equal(liens.find((l) => l.to === AGG1).from, BASE)

  const sql = toSql(p35, mesures, [AGG1, AGG2], 'VENTES', { [AGG2]: BASE })
  assert.match(sql.split('\n\n')[1], /FROM VENTES/)
})

check('sources -- une source impossible est ignoree, pas appliquee', () => {
  // Agg2 est plus grossier qu'Agg1 : il ne peut pas le produire
  const liens = derivations([AGG1, AGG2], p35, { [AGG1]: AGG2 })
  const vers1 = liens.find((l) => l.to === AGG1)
  assert.equal(vers1.from, BASE, 'retombe sur le calcul automatique')
  assert.equal(vers1.forced, false)
})

check('sources -- validSources ne propose que des noeuds plus fins', () => {
  assert.deepEqual(validSources(AGG2, [AGG1, AGG2], p35), [BASE, AGG1])
  assert.deepEqual(validSources(AGG1, [AGG1, AGG2], p35), [BASE], 'Agg2 est trop grossier')
})

check('sources -- deux agregats incomparables partagent la table de faits', () => {
  const AUTRE = '0,0,1' // codeP, codeT, ville -- ni plus fin ni plus grossier qu'Agg1
  const liens = derivations([AGG1, AUTRE], p35)
  assert.deepEqual(
    liens.filter((l) => l.to !== BASE).map((l) => l.from),
    [BASE, BASE],
  )
})

check('p.35 -- A1 et A2 se rattachent chacune a son agregat', () => {
  // A1 : Sum(Qte) par Num_Mois, CodeP, CodeC  ->  Agg1
  assert.equal(analysisSource(parseKey(AGG1), [AGG1, AGG2], p35), AGG1)
  // A2 : Sum(Montant) par Annee, Nom (Nom = attribut faible de codeC)  ->  Agg2
  assert.equal(analysisSource(parseKey(AGG2), [AGG1, AGG2], p35), AGG2)
})

check('analyses -- on prend l’agregat le plus grossier qui reste utilisable', () => {
  const demande = parseKey('1,2,0') // sous_categ, annee, codeC
  // Agg1 (codeP, num_mois, codeC) est plus fin : utilisable et plus grossier
  // que la table de faits, donc prefere
  assert.equal(analysisSource(demande, [AGG1], p35), AGG1)
  // sans aucun agregat, il ne reste que les donnees detaillees
  assert.equal(analysisSource(demande, [], p35), BASE)
})

check('analyses -- une analyse trop fine retombe sur les donnees detaillees', () => {
  // Agg1 est deja agrege au mois : il ne peut pas repondre au jour
  assert.equal(analysisSource(parseKey(BASE), [AGG1, AGG2], p35), BASE)
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

/* --- trace des liens --------------------------------------------------- */

/** abscisse d'une cubique, pour verifier ou la courbe passe vraiment */
const bezierX = (t, x0, x1, x2, x3) =>
  (1 - t) ** 3 * x0 + 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t ** 2 * x2 + t ** 3 * x3

check('trace -- deux rangees voisines restent reliees en ligne droite', () => {
  const { d } = linkPath(100, 300, 100, 240, 0, 1, [])
  assert.match(d, /^M100,300 L100,240$/)
})

check('trace -- un lien qui enjambe une rangee passe AU LARGE de ses boites', () => {
  // trois rangees enjambees, la plus large s'arretant a x = 260
  const rangees = [{ right: 200 }, { right: 200 }, { right: 260 }, { right: 200 }]
  const { d, maxX } = linkPath(100, 300, 100, 120, 0, 3, rangees)

  const [, bx] = d.match(/C([\d.]+),/).map(Number)
  // la courbe doit reellement depasser 260, pas seulement viser au-dela
  const sommetReel = Math.max(
    ...Array.from({ length: 101 }, (_, i) => bezierX(i / 100, 100, bx, bx, 100)),
  )
  assert.ok(
    sommetReel > 260,
    `la courbe culmine a ${sommetReel.toFixed(1)}, elle traverserait la rangee (bord 260)`,
  )
  // et maxX doit annoncer ce sommet, sinon le canvas serait trop etroit
  assert.ok(Math.abs(sommetReel - maxX) < 1, `sommet ${sommetReel} vs maxX annonce ${maxX}`)
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
