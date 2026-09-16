/**
 * Controle du coeur du treillis : on rejoue les figures du cours.
 *   node verify.mjs
 *
 * Les attendus ne sont pas inventes -- ils sont lus sur les planches
 * p.34 (treillis complet) et p.35 / p.61-62 (treillis partiel + vues).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  MAX_NODES,
  aggregateNames,
  baseKey,
  buildLattice,
  availableWeak,
  canDerive,
  displayLabel,
  derivations,
  fromOlapSchema,
  fromOwnFormat,
  labelOf,
  latticeSize,
  analysisIssue,
  analysisSource,
  parseKey,
  pruneSelection,
  selectionSize,
  sortKeys,
  sqlName,
  validSources,
  toOwnFormat,
  toSql,
} from './lattice.js'
import { diagramSvg, layout, linkPath, nodeWidth } from './render.js'

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

check('analyses -- un agregat trop grossier est nomme, dimension par dimension', () => {
  // A1 au jour (codeP, codeT, codeC) contre Agg1 au mois : TEMPS bloque
  assert.deepEqual(analysisIssue(parseKey(BASE), AGG1, p35), ['TEMPS'])
  // Agg2 est plus grossier sur PRODUITS *et* TEMPS
  assert.deepEqual(analysisIssue(parseKey(BASE), AGG2, p35), ['PRODUITS', 'TEMPS'])
})

check('analyses -- une dimension non precisee vaut le niveau le plus fin', () => {
  // `levels` plus court que `dimensions` : comparer a undefined rendait toute
  // comparaison fausse et l'incompatibilite passait inapercue
  assert.deepEqual(analysisIssue([0], AGG1, p35), ['TEMPS'], 'TEMPS reste signale')
  assert.deepEqual(analysisIssue([], AGG2, p35), ['PRODUITS', 'TEMPS'])
})

check('analyses -- un rattachement valable ne signale rien', () => {
  assert.deepEqual(analysisIssue(parseKey(AGG1), AGG1, p35), [])
  assert.deepEqual(analysisIssue(parseKey(AGG1), BASE, p35), [], 'la table de faits repond a tout')
  assert.deepEqual(analysisIssue(parseKey(AGG2), AGG1, p35), [])
})

check('analyses -- le rattachement impose survit a l’aller-retour JSON', () => {
  const avec = {
    factName: 'VENTES',
    measures: mesures,
    dimensions: p35.map((d) => ({ ...d, hierarchies: [] })),
    materialized: [AGG1],
    sources: {},
    analyses: [{ name: 'A1', levels: parseKey(BASE), measure: 'quantite', target: AGG1 }],
    mode: 'partial',
  }
  const relu = fromOwnFormat(JSON.parse(JSON.stringify(toOwnFormat(avec))))
  assert.equal(relu.analyses[0].target, AGG1)
  // et il reste signale comme intenable, l'import ne le "repare" pas en silence
  assert.deepEqual(analysisIssue(relu.analyses[0].levels, relu.analyses[0].target, p35), ['TEMPS'])
})

check('affichage -- une dimension a All se tait dans le libelle', () => {
  assert.equal(displayLabel(parseKey(AGG2), p35), 'annee, codeC', 'p.35 ecrit bien "annee, codeC"')
  assert.equal(displayLabel(parseKey(AGG1), p35), 'codeP, num_mois, codeC')
  // le sommet du treillis n'a plus aucun niveau a montrer : il reste le total
  assert.equal(displayLabel([3, 3, 3], p35), 'All')
  // le libelle technique, lui, garde tout : c'est ce que le SQL raisonne
  assert.equal(labelOf(parseKey(AGG2), p35), 'All, annee, codeC')
})

check('affichage -- taire All ne confond pas deux noeuds distincts', () => {
  const vus = new Set(buildLattice(p34).nodes.map((n) => displayLabel(n.index, p34)))
  assert.equal(vus.size, 16, 'les 16 noeuds restent discernables')
})

/* --- SQL : identifiants et mesures non additives ------------------------ */

check('SQL -- seuls les identifiants qui l’exigent sont entre guillemets', () => {
  assert.equal(sqlName('codeP'), 'codeP', 'un nom ordinaire reste nu')
  assert.equal(sqlName('num_mois'), 'num_mois')
  assert.equal(sqlName('mon niveau'), '"mon niveau"', 'un espace impose les guillemets')
  assert.equal(sqlName('2023'), '"2023"', 'un identifiant ne commence pas par un chiffre')
  assert.equal(sqlName('a"b'), '"a""b"', 'le guillemet interne est double')
})

check('SQL -- un nom avec espace produit du SQL valide, pas casse en deux', () => {
  // le niveau fautif doit etre au-dessus de la cle, sinon le seul noeud
  // materialisable est la base elle-meme et aucune vue n'est generee
  const dims = [{ name: 'T', levels: ['codeT', 'mon niveau'], weak: {} }]
  const sql = toSql(dims, [{ name: 'montant', agg: 'SUM' }], ['1'], 'VENTES')
  assert.match(sql, /GROUP BY "mon niveau";/)
  assert.ok(!/GROUP BY mon niveau/.test(sql), 'sans guillemets, Oracle refuserait')
})

check('p.7 -- AVG est decomposee en somme + effectif, jamais moyennee deux fois', () => {
  const sql = toSql(p35, [{ name: 'note', agg: 'AVG' }], [AGG1, AGG2], 'VENTES')
  const [bloc1, bloc2] = sql.split('\n\n')

  // premiere passe, depuis le detail : on stocke de quoi recalculer
  assert.match(bloc1, /SUM\(note\) AS note_som/)
  assert.match(bloc1, /COUNT\(note\) AS note_nb/)
  // seconde passe : les deux colonnes se cumulent, toutes deux additives
  assert.match(bloc2, /SUM\(note_som\) AS note_som/)
  assert.match(bloc2, /SUM\(note_nb\) AS note_nb/)

  // le piege d'origine : une moyenne de moyennes
  assert.ok(!/AVG\(/.test(sql), 'aucun AVG ne doit subsister dans les vues agregees')
  assert.match(sql, /moyenne = note_som \/ note_nb/, 'la formule de lecture est donnee')
})

check('p.7 -- COUNT se cumule toujours en SUM a la seconde passe', () => {
  const sql = toSql(p35, [{ name: 'nb', agg: 'COUNT' }], [AGG1, AGG2], 'VENTES')
  const [bloc1, bloc2] = sql.split('\n\n')
  assert.match(bloc1, /COUNT\(nb\) AS nb/)
  assert.match(bloc2, /SUM\(nb\) AS nb/)
})

/* --- elagage de la selection -------------------------------------------- */

const selection = {
  materialized: [AGG1, AGG2],
  sources: { [AGG2]: BASE },
  analyses: [{ id: 'a1', name: 'A1', measure: 'quantite', levels: [0, 1, 0], extras: [], target: AGG1 }],
  freeArrows: [{ from: BASE, to: AGG1, label: '' }],
}

check('elagage -- une selection coherente traverse sans rien perdre', () => {
  const apres = pruneSelection(selection, p35)
  assert.deepEqual(apres.materialized, [AGG1, AGG2])
  assert.deepEqual(apres.sources, { [AGG2]: BASE })
  assert.equal(apres.freeArrows.length, 1)
  assert.equal(apres.analyses[0].target, AGG1)
  assert.equal(selectionSize(apres), selectionSize(selection))
})

check('elagage -- retirer une dimension rend tout caduc, et ca se chiffre', () => {
  const ampute = p35.slice(0, 2) // CLIENTS disparait : l'arite des cles change
  const apres = pruneSelection(selection, ampute)
  assert.deepEqual(apres.materialized, [], 'aucune cle a 3 composantes ne survit')
  assert.deepEqual(apres.sources, {})
  assert.deepEqual(apres.freeArrows, [])
  assert.equal(selectionSize(selection) - selectionSize(apres), 5, 'la perte est mesurable')
})

check('elagage -- ne touche pas a la selection qu’on lui passe', () => {
  const copie = JSON.parse(JSON.stringify(selection))
  pruneSelection(selection, p35.slice(0, 2))
  assert.deepEqual(selection, copie, 'fonction pure : simuler une perte ne doit rien casser')
})

/* --- attributs faibles -------------------------------------------------- */

const p35faible = [
  { name: 'PRODUITS', levels: ['codeP', 'sous_categ', 'categorie'], weak: {} },
  { name: 'TEMPS', levels: ['codeT', 'num_mois', 'annee'], weak: { 1: ['lib_mois'] } },
  { name: 'CLIENTS', levels: ['codeC', 'ville', 'pays'], weak: { 0: ['nom', 'prenom'] } },
]

check('p.35 -- "Nom" est utilisable dans une analyse au niveau codeC', () => {
  // A2 = Annee, Nom : CLIENTS reste a codeC, donc `nom` est disponible
  const dispo = availableWeak(parseKey(AGG2), p35faible).map((w) => w.name)
  assert.deepEqual(dispo, ['nom', 'prenom'])
})

check('attributs faibles -- ils dependent de LEUR niveau, pas de la dimension', () => {
  // CLIENTS remonte a `ville` : `nom` n'a plus de sens (p.8)
  const aVille = availableWeak([0, 0, 1], p35faible).map((w) => w.name)
  assert.deepEqual(aVille, [], 'nom depend de codeC, pas de ville')
  // TEMPS au mois expose lib_mois
  assert.deepEqual(availableWeak([0, 1, 0], p35faible).map((w) => w.name), ['lib_mois', 'nom', 'prenom'])
})

check('attributs faibles -- ils ne changent pas quel agregat repond', () => {
  // `extras` est une colonne de plus, pas un axe : la granularite est intacte
  assert.equal(analysisSource(parseKey(AGG2), [AGG1, AGG2], p35faible), AGG2)
})

/* --- fleches libres ----------------------------------------------------- */

check('fleches libres -- elles traversent l’aller-retour JSON', () => {
  const avec = {
    factName: 'VENTES', measures: mesures,
    dimensions: p35.map((d) => ({ ...d, hierarchies: [] })),
    materialized: [AGG1], sources: {}, analyses: [],
    freeArrows: [{ from: BASE, to: AGG1, label: 'chargement nocturne' }],
    mode: 'partial',
  }
  const relu = fromOwnFormat(JSON.parse(JSON.stringify(toOwnFormat(avec))))
  assert.deepEqual(relu.freeArrows, [{ from: BASE, to: AGG1, label: 'chargement nocturne' }])
})

check('fleches libres -- une entree mal formee est ecartee, pas gardee', () => {
  const relu = fromOwnFormat({
    dimensions: [], freeArrows: [{ from: 'x' }, { from: 'a', to: 'b' }, 'nimporte quoi'],
  })
  assert.deepEqual(relu.freeArrows, [{ from: 'a', to: 'b', label: '' }])
})

/* --- rendu SVG ---------------------------------------------------------- */

/** petit modele complet : deux noeuds, une analyse, une fleche libre */
const modele = () => ({
  items: [
    { key: '0,0', rank: 0, label: 'codeP, codeT', tag: 'VENTES' },
    { key: '0,1', rank: 1, label: 'codeP, num_mois', tag: 'Agg1' },
  ],
  analyses: [
    { key: 'A:a1', rank: 0, label: 'A1', tag: 'SUM(q)', target: '0,1', issue: [] },
  ],
  edges: [{ from: '0,0', to: '0,1', deriv: true, forced: false }],
  freeArrows: [{ from: '0,0', to: 'A:a1', label: 'note' }],
  names: new Map([['0,0', 'VENTES'], ['0,1', 'Agg1']]),
  base: '0,0',
  materialized: new Set(['0,0', '0,1']),
})

check('a11y -- le SVG s’annonce sans masquer ses boites focalisables', () => {
  const svg = diagramSvg({ ...modele(), label: 'Treillis partiel : 2 agrégats' })
  assert.match(svg, /role="group"/, '"img" rendrait tout le contenu presentationnel')
  assert.match(svg, /aria-label="Treillis partiel : 2 agrégats"/)
})

check('a11y -- une boite cliquable est atteignable au clavier et annoncee', () => {
  const svg = diagramSvg(modele())
  // Agg1 est materialise et decochable : focalisable
  const agg1 = svg.slice(svg.indexOf('data-key="0,1"'), svg.indexOf('data-key="0,1"') + 220)
  assert.match(agg1, /tabindex="0"/)
  assert.match(agg1, /role="button"/)
  assert.match(agg1, /aria-label="[^"]*Cliquer pour retirer/)

  // la table de faits n'est pas optionnelle : ni focus ni role de bouton
  const base = svg.slice(svg.indexOf('data-key="0,0"'), svg.indexOf('data-key="0,0"') + 220)
  assert.ok(!base.includes('tabindex'), 'la base ne doit pas etre un piege au clavier')
  assert.ok(!base.includes('role="button"'))
})

check('trace -- une rangee inconnue ne fait plus lever d’exception', () => {
  // rowBounds trop court : avant, rangee.y levait un TypeError
  assert.doesNotThrow(() => linkPath(0, 300, 0, 60, 0, 3, [{ y: 300, right: 0, boxes: [] }]))
  const { d } = linkPath(0, 300, 0, 60, 0, 3, [{ y: 300, right: 0, boxes: [] }])
  assert.match(d, /^M0,300 L0,60$/, 'sans information, on ne contourne pas au hasard')
})

check('rendu -- le SVG porte boites, aretes et styles embarques', () => {
  const svg = diagramSvg(modele())
  assert.match(svg, /^<svg id="svg"/)
  assert.equal((svg.match(/data-key=/g) ?? []).length, 3, 'deux noeuds + une analyse')
  assert.match(svg, /class="edge deriv"/)
  assert.match(svg, /class="edge analysis"/)
  assert.match(svg, /class="edge libre"/)
  // le fichier exporte doit s'ouvrir seul : styles et marqueurs a l'interieur
  assert.match(svg, /<style>/)
  assert.match(svg, /<marker id="arrow"/)
  assert.match(svg, /data-export="content"/)
  assert.match(svg, /data-export="background"/)
})

check('rendu -- un libelle hostile est echappe, jamais injecte', () => {
  const m = modele()
  m.items[0].label = '<script>alert(1)</script>'
  m.freeArrows[0].label = 'a & b "c"'
  const svg = diagramSvg(m)
  assert.ok(!svg.includes('<script>'), 'aucune balise ne doit passer')
  assert.match(svg, /&lt;script&gt;/)
  assert.match(svg, /a &amp; b &quot;c&quot;/)
})

check('rendu -- la base et les analyses portent leurs classes', () => {
  const svg = diagramSvg(modele())
  assert.match(svg, /class="node base mat"/, 'la table de faits se distingue')
  assert.match(svg, /class="node analysis"/)
  // la base n'est pas decochable : pas de curseur de clic
  const base = svg.slice(svg.indexOf('data-key="0,0"'))
  assert.ok(!base.slice(0, 40).includes('cursor="pointer"'))
})

check('rendu -- un rattachement intenable se voit dans le SVG', () => {
  const m = modele()
  m.analyses[0].issue = ['TEMPS']
  const svg = diagramSvg(m)
  assert.match(svg, /class="edge analysis invalide"/)
  assert.match(svg, /marker-end="url\(#arrow-invalide\)"/)
  assert.match(svg, /trop agrégé sur TEMPS/)
})

check('rendu -- une extremite absente n’est pas dessinee, et ne casse rien', () => {
  const m = modele()
  m.freeArrows = [{ from: '0,0', to: 'A:inconnue', label: 'x' }]
  const svg = diagramSvg(m)
  assert.ok(!svg.includes('edge libre'), 'la fleche orpheline est ignoree')
  assert.match(svg, /data-key="0,0"/, 'le reste du diagramme tient')
})

/* --- trace des liens --------------------------------------------------- */

/** abscisse d'une cubique, pour verifier ou la courbe passe vraiment */
const bezierX = (t, x0, x1, x2, x3) =>
  (1 - t) ** 3 * x0 + 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t ** 2 * x2 + t ** 3 * x3

check('trace -- deux rangees voisines restent reliees en ligne droite', () => {
  const { d } = linkPath(100, 300, 100, 240, 0, 1, [])
  assert.match(d, /^M100,300 L100,240$/)
})

check('trace -- enjamber une rangee SANS la toucher reste une ligne droite', () => {
  // depart tout a gauche, boite intermediaire centree : la droite passe au large
  const rangees = [
    { y: 300, right: 400, boxes: [{ x: 60, w: 80 }] },
    { y: 200, right: 400, boxes: [{ x: 280, w: 150 }] },
    { y: 100, right: 400, boxes: [{ x: 300, w: 120 }] },
  ]
  const { d } = linkPath(100, 300, 340, 130, 0, 2, rangees)
  assert.match(d, /^M100,300 L340,130$/, 'ne pas courber quand rien ne gene')
})

check('trace -- un lien qui enjambe une rangee passe AU LARGE de ses boites', () => {
  // la boite intermediaire est pile sur le chemin : il faut contourner
  const rangees = [
    { y: 300, right: 200, boxes: [] },
    { y: 240, right: 200, boxes: [] },
    { y: 180, right: 260, boxes: [{ x: 60, w: 200 }] },
    { y: 120, right: 200, boxes: [] },
  ]
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
        { id: 'p1', name: 'codeP', weakAttributes: [{ id: 'w2', name: 'description' }, { id: 'w3', name: 'prix_unit' }] },
        { id: 'p2', name: 'sous_categ', weakAttributes: [] },
        { id: 'p3', name: 'categorie', weakAttributes: [] },
        { id: 'p4', name: 'marque', weakAttributes: [{ id: 'w4', name: 'pays_marque' }] },
      ],
      hierarchies: [
        { id: 'h1', name: 'H_Pro', path: ['p1', 'p2', 'p3'] },
        { id: 'h2', name: 'H_Marque', path: ['p1', 'p4'] },
      ],
    },
  ],
}

check('attributs faibles -- un import OLAP les recupere sur le bon niveau', () => {
  const [produits] = fromOlapSchema(exportOlap).dimensions
  assert.deepEqual(produits.weak, { 0: ['description', 'prix_unit'] })
})

check('import OLAP -- hierarchies[].path devient les niveaux du treillis', () => {
  const { factName, measures, dimensions } = fromOlapSchema(exportOlap)
  assert.equal(factName, 'VENTES')
  assert.deepEqual(measures.map((m) => m.name), ['quantite', 'montant'])
  assert.equal(dimensions.length, 1)
  assert.deepEqual(dimensions[0].levels, ['codeP', 'sous_categ', 'categorie'])
})

check('import OLAP -- chaque hierarchie porte SES attributs faibles', () => {
  const [produits] = fromOlapSchema(exportOlap).dimensions
  // H_Pro : description et prix_unit sont sur codeP, en position 0
  assert.deepEqual(produits.hierarchies[0].weak, { 0: ['description', 'prix_unit'] })
  // H_Marque : meme cle en 0, plus pays_marque sur marque, en position 1.
  // Indexer par nom de parametre aurait confondu les deux chemins.
  assert.deepEqual(produits.hierarchies[1].weak, {
    0: ['description', 'prix_unit'],
    1: ['pays_marque'],
  })
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

/* --- garde-fou de deploiement ------------------------------------------- */

check('cache -- un seul numero de version, partage par tous les modules', () => {
  // GitHub Pages met index.html et chaque module en cache separement : un
  // module perime fait echouer l'import, et un module ES qui echoue ne laisse
  // rien a l'ecran. Trois litteraux a incrementer -> on en oublie (vecu).
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8')
  assert.deepEqual(
    html.match(/\.js\?v=\d+/g) ?? [],
    [],
    'aucune version en dur : toutes doivent deriver de la constante V',
  )
  assert.equal(
    (html.match(/^const V = '\d+'$/gm) ?? []).length,
    1,
    'exactement un endroit a incrementer',
  )
  assert.equal(
    (html.match(/\.js\?v=\$\{V\}/g) ?? []).length,
    3,
    'les trois modules passent par V',
  )
})

console.log(`\n${passed} controles passes.`)
