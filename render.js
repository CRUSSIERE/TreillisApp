/**
 * Dessin du treillis -- pur : aucun DOM, aucune connaissance de l'etat de
 * l'app. On lui passe un modele deja resolu (qui derive de quoi, quelle
 * analyse est servie par qui) et il rend une chaine SVG.
 *
 * Toute la semantique OLAP reste dans lattice.js ; ici il n'y a que de la
 * geometrie et de la presentation. Les deux etant pures, verify.mjs les
 * controle de la meme facon.
 */

export const NODE_H = 30
const GAP_X = 18
const GAP_Y = 62
const MARGIN = 26

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/** Le SVG porte ses propres styles : le fichier exporte doit s'afficher seul,
 *  hors de la page. Polices systeme uniquement -- une webfont disparaitrait
 *  a la rasterisation en PNG. */
const SVG_STYLE = `
  .edge { stroke: #b6bdc8; stroke-width: 1.2; fill: none; }
  .edge.deriv { stroke: #2f6fd0; stroke-width: 1.8; }
  .node rect { fill: #fff; stroke: #c3cad4; stroke-width: 1.2; rx: 6; }
  .node text {
    font: 12.5px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    fill: #1c2430; dominant-baseline: middle; text-anchor: middle;
  }
  .node.mat rect { fill: #e8f0fc; stroke: #2f6fd0; stroke-width: 1.8; }
  .node:focus { outline: none; }
  .node:focus rect { stroke: #7c3aed; stroke-width: 2.6; }
  .node.base rect { fill: #fdf1e2; stroke: #b45309; stroke-width: 1.8; }
  .node.analysis rect { fill: #effaf1; stroke: #15803d; stroke-width: 1.8; }
  .edge.analysis { stroke: #334155; stroke-width: 1.6; }
  /* rattachement impose que l'agregat ne peut pas honorer */
  .edge.analysis.invalide { stroke: #b91c1c; stroke-dasharray: 4 3; }
  .edge.libre { stroke: #7c3aed; stroke-width: 1.6; stroke-dasharray: 6 4; }
  /* pointilles = source choisie a la main, trait plein = calcul automatique */
  .edge.forced { stroke-dasharray: 5 3; }
  /* a cote de la boite, pas au-dessus : la pointe de fleche y arrive.
     Selecteur plus specifique que "node text", sinon l'etiquette reste
     centree sur son ancre et la boite en recouvre la moitie gauche. */
  .node text.tag {
    font: 10.5px system-ui, sans-serif; fill: #6b7684;
    text-anchor: start; dominant-baseline: middle;
  }
  text.tag.libre { font: 10.5px system-ui, sans-serif; fill: #7c3aed; text-anchor: start; }
  text.tag.libre.centre { text-anchor: middle; }
  /* bandes de la planche p.35 : Analyses / Donnees agregees / Donnees detaillees */
  .bande {
    font: 600 11.5px system-ui, sans-serif; fill: #4a5da8;
    text-anchor: start; dominant-baseline: middle;
  }
  .bande-ligne { stroke: #4a5da8; stroke-width: 1.2; stroke-dasharray: 9 6; }
  /* poignee de deplacement d'un lien : affordance d'edition, retiree a l'export */
  .poignee { fill: #fff; stroke: #9aa4b2; stroke-width: 1.4; opacity: .5; cursor: grab; }
  .poignee:hover { opacity: 1; stroke: #2f6fd0; stroke-width: 2; }
  .poignee.plie { opacity: 1; stroke: #2f6fd0; }
  /* ancre : point d'arrivee de la fleche sur la boite, glissable le long du bord */
  .ancre { fill: #fff; stroke: #9aa4b2; stroke-width: 1.4; opacity: .5; cursor: ew-resize; rx: 2; }
  .ancre:hover { opacity: 1; stroke: #2f6fd0; stroke-width: 2; }
  .ancre.deplacee { opacity: 1; stroke: #2f6fd0; }
`

const MARKERS = [
  ['arrow', '#2f6fd0'],
  ['arrow-analyse', '#334155'],
  ['arrow-libre', '#7c3aed'],
  ['arrow-invalide', '#b91c1c'],
]
  .map(
    ([id, fill]) => `<marker id="${id}" viewBox="0 0 8 8" refX="7" refY="4"
        markerWidth="7" markerHeight="7" orient="auto">
        <path d="M0,0 L8,4 L0,8 z" fill="${fill}"/>
      </marker>`,
  )
  .join('\n      ')

export const nodeWidth = (label) => Math.max(92, label.length * 7 + 26)
/** l'etiquette est posee a droite de la boite : elle occupe de la place dans
 *  la rangee, sinon elle se superpose a la boite suivante */
const tagWidth = (tag) => (tag ? 8 + tag.length * 6.2 : 0)
const slotWidth = (item) => nodeWidth(item.label) + tagWidth(item.tag)

/**
 * Disposition en couches par rang : rang 0 (donnees detaillees) EN BAS,
 * l'agregation monte, et les analyses forment la bande du dessus --
 * l'orientation de la planche p.35.
 * ponytail: ordre lexicographique dans chaque couche, sans reduction de
 * croisements ; passer a un tri barycentrique si les aretes deviennent
 * illisibles au-dela de 3 dimensions.
 */
export function layout(nodes, analyses) {
  const ranks = [...new Set(nodes.map((n) => n.rank))].sort((a, b) => a - b)
  const rows = ranks.map((r) => nodes.filter((n) => n.rank === r))
  if (analyses.length) rows.push(analyses)

  const widths = rows.map((row) => row.reduce((w, n) => w + slotWidth(n) + GAP_X, -GAP_X))
  const width = Math.max(...widths, 200) + MARGIN * 2
  const step = NODE_H + GAP_Y

  const placed = new Map()
  const rowBounds = []
  rows.forEach((row, r) => {
    let x = (width - widths[r]) / 2
    const y = MARGIN + (rows.length - 1 - r) * step // r = 0 tout en bas
    const left = x
    for (const n of row) {
      placed.set(n.key, { ...n, x, y, w: nodeWidth(n.label), h: NODE_H, row: r })
      x += slotWidth(n) + GAP_X
    }
    rowBounds.push({
      y,
      left,
      right: x - GAP_X,
      boxes: row.map((n) => ({ x: placed.get(n.key).x, w: placed.get(n.key).w })),
    })
  })

  return { placed, width, height: MARGIN * 2 + rows.length * step - GAP_Y, rowBounds }
}

/**
 * Trace d'un lien. Entre deux rangees voisines, un segment droit suffit.
 * Au-dela, une droite passerait DERRIERE les boites intermediaires, qui sont
 * opaques : le lien paraitrait coupe, voire rattache au mauvais noeud. On le
 * fait alors contourner par la droite -- mais seulement s'il gene vraiment.
 */
export function linkPath(x1, y1, x2, y2, rowA, rowB, rowBounds, boxHeight = NODE_H) {
  const lo = Math.min(rowA, rowB)
  const hi = Math.max(rowA, rowB)
  const droite = { d: `M${x1},${y1} L${x2},${y2}`, maxX: Math.max(x1, x2) }
  if (hi - lo <= 1) return droite

  // Enjamber une rangee ne gene que si le segment coupe VRAIMENT une de ses
  // boites. Courber sans verifier envoyait un lien partant du bord gauche
  // faire un long detour par la droite alors que la droite passait au large.
  const xA = (y) => (y2 === y1 ? x1 : x1 + ((x2 - x1) * (y - y1)) / (y2 - y1))
  let right = Math.max(x1, x2)
  let heurte = false
  for (let r = lo + 1; r < hi; r++) {
    const rangee = rowBounds[r]
    if (!rangee) continue // rangee inconnue : on ne peut rien affirmer, on laisse droit
    const min = Math.min(xA(rangee.y), xA(rangee.y + boxHeight))
    const max = Math.max(xA(rangee.y), xA(rangee.y + boxHeight))
    for (const b of rangee.boxes ?? []) {
      if (max > b.x - 6 && min < b.x + b.w + 6) heurte = true
    }
    right = Math.max(right, rangee.right)
  }
  if (!heurte) return droite

  const sommet = right + 26

  // Une cubique n'atteint PAS ses points de controle : avec les deux controles
  // sur la meme verticale, elle culmine vers 0,25*depart + 0,75*controle. Les
  // placer pile au large ferait donc passer la courbe sur les boites quand
  // meme -- on les pousse au-dela pour que le sommet reel tombe ou il faut.
  const milieu = (x1 + x2) / 2
  const bx = milieu + (sommet - milieu) / 0.75
  return { d: `M${x1},${y1} C${bx},${y1} ${bx},${y2} ${x2},${y2}`, maxX: sommet }
}

const centre = (b) => b.x + b.w / 2

/** identite d'un lien, stable tant que ses deux extremites existent */
export const edgeId = (from, to) => `${from}>${to}`

/** Fraction le long du bord de la boite ou la fleche atterrit. 0,5 = au
 *  milieu, le defaut. Bornee pour que la pointe ne se pose pas pile dans un
 *  coin, ou elle chevaucherait la bordure. */
export const ANCRE_MIN = 0.06
export const ANCRE_MAX = 0.94
export const ancreX = (boite, u) =>
  boite.x + Math.min(ANCRE_MAX, Math.max(ANCRE_MIN, u ?? 0.5)) * boite.w

/** Poignee d'arrivee, posee sur le bord de la boite. Comme la poignee de pli,
 *  c'est une affordance d'edition : rendue hors du contenu mesure. */
function ancreSvg(id, x, y, boite, deplacee) {
  return `<rect class="ancre${deplacee ? ' deplacee' : ''}" ` +
    `data-anchor="${esc(id)}" data-box="${boite.x},${boite.w}" ` +
    `x="${x - 4}" y="${y - 4}" width="8" height="8">` +
    `<title>Glisser le long du bord pour déplacer l’arrivée — double-clic pour recentrer</title>` +
    `</rect>`
}

/**
 * Trace d'un lien, et position de sa poignee.
 *
 * Un pli enregistre (`bends[id]`) remplace le contournement automatique :
 * l'utilisateur a pris la main, on ne discute plus. Le pli est stocke en
 * ECART au milieu du segment, pas en absolu -- ainsi il suit les boites quand
 * la disposition change.
 */
function traceLien(id, x1, y1, x2, y2, rowA, rowB, rowBounds, bends) {
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const pli = bends?.[id]

  if (pli) {
    const px = mx + pli.dx
    const py = my + pli.dy
    // une quadratique ne passe pas par son point de controle : Q(0,5) vaut
    // (P0 + 2C + P2)/4, donc pour passer par la poignee il faut C = 2P - M
    const cx = 2 * px - mx
    const cy = 2 * py - my
    return {
      d: `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`,
      maxX: Math.max(x1, x2, px, cx),
      minY: Math.min(y1, y2, py, cy),
      poignee: { x: px, y: py },
      mid: { x: mx, y: my },
      plie: true,
    }
  }

  const auto = linkPath(x1, y1, x2, y2, rowA, rowB, rowBounds)
  return {
    ...auto,
    minY: Math.min(y1, y2),
    poignee: { x: mx, y: my },
    mid: { x: mx, y: my },
    plie: false,
  }
}

/** La poignee est une affordance d'edition : elle est rendue DANS UN GROUPE
 *  A PART, hors du contenu mesure, pour que le recadrage de l'export l'ignore
 *  et que le clone n'ait qu'a la supprimer. */
function poigneeSvg(id, t) {
  return `<circle class="poignee${t.plie ? ' plie' : ''}" ` +
    `data-bend="${esc(id)}" data-mid="${t.mid.x},${t.mid.y}" ` +
    `cx="${t.poignee.x}" cy="${t.poignee.y}" r="5">` +
    `<title>Glisser pour infléchir — double-clic pour rétablir</title></circle>`
}
const BANDES = ['Données détaillées', 'Données agrégées', 'Analyses']

/**
 * Les trois bandes de la planche p.35, separees par des traits pointilles.
 *
 * `rowBounds` est ordonne du bas vers le haut : la rangee 0 porte les donnees
 * detaillees (rang 0, la table de faits), la derniere porte les analyses s'il
 * y en a, et tout ce qui est entre les deux est agrege.
 *
 * Les libelles vivent a GAUCHE du contenu, hors du cadre : on renvoie la
 * marge dont l'appelant doit reculer l'origine du viewBox, plutot que de
 * decaler toutes les boites deja placees.
 */
function drawBands(rowBounds, aDesAnalyses) {
  const hautes = rowBounds.length - (aDesAnalyses ? 1 : 0) // rangees de noeuds
  // sans agregat ni analyse, il n'y a qu'une bande : rien a separer
  if (rowBounds.length < 2 && !aDesAnalyses) return { svg: '', left: 0 }

  const large = Math.max(...BANDES.map((b) => b.length)) * 6.3 + 18
  const left = -large
  const droite = Math.max(...rowBounds.map((r) => r.right))

  /** milieu de l'espace vide entre deux rangees voisines */
  const entre = (bas, haut) => (rowBounds[haut].y + NODE_H + rowBounds[bas].y) / 2

  const traits = []
  const libelles = []

  // donnees detaillees : la rangee du bas, toujours presente
  libelles.push([rowBounds[0].y + NODE_H / 2, BANDES[0]])

  if (hautes > 1) {
    traits.push(entre(0, 1))
    // donnees agregees : centrees entre le trait du bas et celui du haut
    const basAgg = entre(0, 1)
    const hautAgg = aDesAnalyses ? entre(hautes - 1, hautes) : rowBounds[hautes - 1].y
    libelles.push([(basAgg + hautAgg) / 2, BANDES[1]])
  }

  if (aDesAnalyses) {
    const iAnalyses = rowBounds.length - 1
    traits.push(entre(iAnalyses - 1, iAnalyses))
    libelles.push([rowBounds[iAnalyses].y + NODE_H / 2, BANDES[2]])
  }

  const svg =
    traits
      .map((y) => `<line class="bande-ligne" x1="${left + 6}" y1="${y}" x2="${droite}" y2="${y}"/>`)
      .join('') +
    libelles
      .map(([y, texte]) => `<text class="bande" x="${left + 6}" y="${y}">${esc(texte)}</text>`)
      .join('')

  return { svg, left }
}
const titre = (t) => (t ? `<title>${esc(t)}</title>` : '')

/** Derivations et roll-up : `from` est toujours le noeud le plus fin, donc le
 *  plus bas -- la fleche monte. */
function drawEdges(edges, placed, rowBounds, nom, suivreX, suivreY, bends, poignees, anchors) {
  return edges
    .map(({ from, to, deriv, forced }) => {
      const a = placed.get(from)
      const b = placed.get(to)
      if (!a || !b) return ''
      const id = edgeId(from, to)
      const u = anchors?.[id]
      const x1 = centre(a)
      const y1 = a.y
      const x2 = deriv ? ancreX(b, u) : centre(b)
      const y2 = b.y + b.h + (deriv ? 7 : 0)
      const tr = traceLien(id, x1, y1, x2, y2, a.row, b.row, rowBounds, bends)
      suivreX(tr.maxX)
      suivreY(tr.minY)
      const cls = `edge${deriv ? ' deriv' : ''}${forced ? ' forced' : ''}`
      const t = deriv
        ? `${nom(to)} calculé depuis ${nom(from)}${forced ? ' (source imposée)' : ''}`
        : ''
      // le treillis complet est une grille reguliere : y ajouter 24 poignees
      // n'aiderait personne, on ne les propose que sur les liens du partiel
      return `<path class="${cls}" data-edge="${esc(id)}" data-ends="${x1},${y1},${x2},${y2}" ` +
        `d="${tr.d}"${deriv ? ' marker-end="url(#arrow)"' : ''}>${titre(t)}</path>` +
        (deriv
          ? (poignees.push(poigneeSvg(id, tr), ancreSvg(id, x2, b.y + b.h, b, u !== undefined)), '')
          : '')
    })
    .join('')
}

/** L'analyse est au-dessus de son agregat : cette fleche-la descend. Rouge
 *  pointille quand `issue` n'est pas vide -- le rattachement impose ne tient
 *  pas, et mieux vaut le montrer que dessiner une fleche qui ment. */
function drawAnalyses(analyses, placed, rowBounds, nom, suivreX, suivreY, bends, poignees, anchors) {
  return analyses
    .map((an) => {
      const from = placed.get(an.key)
      const to = placed.get(an.target)
      if (!from || !to) return ''
      const id = edgeId(an.key, an.target)
      const u = anchors?.[id]
      const x1 = centre(from)
      const y1 = from.y + from.h
      const x2 = ancreX(to, u)
      const y2 = to.y - 7
      const tr = traceLien(id, x1, y1, x2, y2, from.row, to.row, rowBounds, bends)
      const { d } = tr
      suivreX(tr.maxX)
      suivreY(tr.minY)
      const invalide = an.issue?.length > 0
      const t = invalide
        ? `${an.label} : ${nom(an.target)} est trop agrégé sur ${an.issue.join(', ')}`
        : `${an.label} est servie par ${nom(an.target)}`
      return `<path class="edge analysis${invalide ? ' invalide' : ''}" data-edge="${esc(id)}" ` +
        `data-ends="${x1},${y1},${x2},${y2}" d="${d}" ` +
        `marker-end="url(#${invalide ? 'arrow-invalide' : 'arrow-analyse'})">${titre(t)}</path>` +
        (poignees.push(poigneeSvg(id, tr), ancreSvg(id, x2, to.y, to, u !== undefined)), '')
    })
    .join('')
}

/** Fleches libres : aucune semantique de treillis, elles relient ce que
 *  l'utilisateur veut. Violet, pour ne se confondre ni avec les derivations
 *  (bleu) ni avec les rattachements d'analyse (sombre). */
function drawFreeArrows(freeArrows, placed, rowBounds, suivreX, suivreY, bends, poignees, anchors) {
  return freeArrows
    .map((f) => {
      const a = placed.get(f.from)
      const b = placed.get(f.to)
      if (!a || !b || f.from === f.to) return ''
      const id = edgeId(f.from, f.to)
      let d
      let etiq
      let tr = null // pas de poignee sur l'arc de meme rangee : il est deja
      let bouts = '' // contraint a passer par-dessus, l'inflechir n'aiderait pas
      let bord = null

      if (a.row === b.row) {
        // meme rangee : passer par le dessus. Tout droit, le trait traverserait
        // les boites voisines et leurs etiquettes.
        const arc = 34
        d = `M${centre(a)},${a.y} C${centre(a)},${a.y - arc} ${centre(b)},${b.y - arc} ${centre(b)},${b.y - 7}`
        suivreY(a.y - arc)
        etiq = { x: (centre(a) + centre(b)) / 2, y: a.y - arc + 6, milieu: true }
      } else {
        const monte = a.y > b.y
        const y1 = monte ? a.y : a.y + a.h
        const y2 = monte ? b.y + b.h + 7 : b.y - 7
        const u = anchors?.[id]
        const x2 = ancreX(b, u)
        bord = { x: x2, y: monte ? b.y + b.h : b.y, boite: b, deplacee: u !== undefined }
        tr = traceLien(id, centre(a), y1, x2, y2, a.row, b.row, rowBounds, bends)
        d = tr.d
        suivreX(tr.maxX)
        suivreY(tr.minY)
        etiq = { x: (centre(a) + centre(b)) / 2 + 8, y: (a.y + b.y) / 2 + NODE_H / 2, milieu: false }
        bouts = `${centre(a)},${y1},${x2},${y2}`
      }

      const texte = f.label
        ? `<text class="tag libre${etiq.milieu ? ' centre' : ''}" x="${etiq.x}" y="${etiq.y}">${esc(f.label)}</text>`
        : ''
      return `<path class="edge libre"${bouts ? ` data-edge="${esc(id)}" data-ends="${bouts}"` : ''} ` +
        `d="${d}" marker-end="url(#arrow-libre)">` +
        `${titre(f.label || 'flèche libre')}</path>${texte}` +
        (tr
          ? (poignees.push(poigneeSvg(id, tr), ancreSvg(id, bord.x, bord.y, bord.boite, bord.deplacee)), '')
          : '')
    })
    .join('')
}

function drawBoxes(placed, base, materialized, nom) {
  return [...placed.values()]
    .map((n) => {
      const estAnalyse = n.key.startsWith('A:')
      const estBase = n.key === base
      const mat = materialized.has(n.key)
      const cls = ['node', estAnalyse && 'analysis', estBase && 'base', mat && 'mat']
        .filter(Boolean)
        .join(' ')
      const tagSvg = n.tag
        ? `<text class="tag" x="${n.x + n.w + 8}" y="${n.y + n.h / 2 + 1}">${esc(n.tag)}</text>`
        : ''
      const t = estAnalyse
        ? `Analyse servie par ${nom(n.target)}`
        : estBase
          ? 'Données détaillées : toujours matérialisé'
          : mat
            ? 'Cliquer pour retirer du treillis partiel'
            : 'Cliquer pour matérialiser'
      // une boite cliquable doit l'etre aussi au clavier, et s'annoncer :
      // sans tabindex ni role, le canvas n'offrait aucune prise hors souris
      const cliquable = !estAnalyse && !estBase
      const a11y = cliquable
        ? ` cursor="pointer" tabindex="0" role="button" aria-label="${esc(`${n.label} — ${t}`)}"`
        : ''
      return `<g class="${cls}" data-key="${esc(n.key)}"${a11y}>
        ${titre(t)}
        ${tagSvg}
        <rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}"/>
        <text x="${n.x + n.w / 2}" y="${n.y + n.h / 2 + 1}">${esc(n.label)}</text>
      </g>`
    })
    .join('')
}

/**
 * Rend le diagramme complet.
 *
 * Le modele est deja resolu : `edges` dit qui derive de qui, chaque analyse
 * porte sa cible et, le cas echeant, les dimensions qui l'empechent d'etre
 * servie. Ce module ne recalcule aucune semantique -- il place et il dessine.
 */
export function diagramSvg({
  items, analyses, edges, freeArrows, names, base, materialized,
  bends = {}, anchors = {}, label = 'Treillis d’agrégats',
}) {
  const { placed, width, height, rowBounds } = layout(items, analyses)
  const nom = (k) => names.get(k) ?? k

  // un lien qui contourne par la droite, ou un arc qui passe au-dessus de la
  // rangee du haut, sortiraient du cadre : on suit leurs debordements
  let maxX = width
  let minY = 0
  const suivreX = (x) => { maxX = Math.max(maxX, x) }
  const suivreY = (y) => { minY = Math.min(minY, y) }

  const bandes = drawBands(rowBounds, analyses.length > 0)
  const poignees = []
  const edgeSvg = drawEdges(edges, placed, rowBounds, nom, suivreX, suivreY, bends, poignees, anchors)
  const analysisSvg = drawAnalyses(analyses, placed, rowBounds, nom, suivreX, suivreY, bends, poignees, anchors)
  const freeSvg = drawFreeArrows(freeArrows, placed, rowBounds, suivreX, suivreY, bends, poignees, anchors)
  const boxSvg = drawBoxes(placed, base, materialized, nom)

  // on deplace l'origine du viewBox plutot que de deplacer tout le contenu
  const left = bandes.left
  const top = Math.min(0, minY - 6)
  const w = Math.max(width, maxX + MARGIN) - left
  const h = height - top

  // role="group" et non "img" : "img" rendrait tout le contenu presentationnel
  // et masquerait les boites focalisables aux lecteurs d'ecran
  return `<svg id="svg" xmlns="http://www.w3.org/2000/svg"
      role="group" aria-label="${esc(label)}"
      width="${w}" height="${h}" viewBox="${left} ${top} ${w} ${h}">
    <style>${SVG_STYLE}</style>
    <defs>
      ${MARKERS}
    </defs>
    <rect data-export="background" x="${left}" y="${top}" width="${w}" height="${h}" fill="#ffffff"/>
    <g data-export="content">${bandes.svg}${edgeSvg}${analysisSvg}${freeSvg}${boxSvg}</g>
    <g data-export="chrome">${poignees.join('')}</g>
  </svg>`
}
