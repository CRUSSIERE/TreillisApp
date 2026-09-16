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
const titre = (t) => (t ? `<title>${esc(t)}</title>` : '')

/** Derivations et roll-up : `from` est toujours le noeud le plus fin, donc le
 *  plus bas -- la fleche monte. */
function drawEdges(edges, placed, rowBounds, nom, suivreX) {
  return edges
    .map(({ from, to, deriv, forced }) => {
      const a = placed.get(from)
      const b = placed.get(to)
      if (!a || !b) return ''
      const { d, maxX } = linkPath(
        centre(a), a.y,
        centre(b), b.y + b.h + (deriv ? 7 : 0),
        a.row, b.row, rowBounds,
      )
      suivreX(maxX)
      const cls = `edge${deriv ? ' deriv' : ''}${forced ? ' forced' : ''}`
      const t = deriv
        ? `${nom(to)} calculé depuis ${nom(from)}${forced ? ' (source imposée)' : ''}`
        : ''
      return `<path class="${cls}" d="${d}"${deriv ? ' marker-end="url(#arrow)"' : ''}>${titre(t)}</path>`
    })
    .join('')
}

/** L'analyse est au-dessus de son agregat : cette fleche-la descend. Rouge
 *  pointille quand `issue` n'est pas vide -- le rattachement impose ne tient
 *  pas, et mieux vaut le montrer que dessiner une fleche qui ment. */
function drawAnalyses(analyses, placed, rowBounds, nom, suivreX) {
  return analyses
    .map((an) => {
      const from = placed.get(an.key)
      const to = placed.get(an.target)
      if (!from || !to) return ''
      const { d, maxX } = linkPath(
        centre(from), from.y + from.h,
        centre(to), to.y - 7,
        from.row, to.row, rowBounds,
      )
      suivreX(maxX)
      const invalide = an.issue?.length > 0
      const t = invalide
        ? `${an.label} : ${nom(an.target)} est trop agrégé sur ${an.issue.join(', ')}`
        : `${an.label} est servie par ${nom(an.target)}`
      return `<path class="edge analysis${invalide ? ' invalide' : ''}" d="${d}" ` +
        `marker-end="url(#${invalide ? 'arrow-invalide' : 'arrow-analyse'})">${titre(t)}</path>`
    })
    .join('')
}

/** Fleches libres : aucune semantique de treillis, elles relient ce que
 *  l'utilisateur veut. Violet, pour ne se confondre ni avec les derivations
 *  (bleu) ni avec les rattachements d'analyse (sombre). */
function drawFreeArrows(freeArrows, placed, rowBounds, suivreX, suivreY) {
  return freeArrows
    .map((f) => {
      const a = placed.get(f.from)
      const b = placed.get(f.to)
      if (!a || !b || f.from === f.to) return ''
      let d
      let etiq

      if (a.row === b.row) {
        // meme rangee : passer par le dessus. Tout droit, le trait traverserait
        // les boites voisines et leurs etiquettes.
        const arc = 34
        d = `M${centre(a)},${a.y} C${centre(a)},${a.y - arc} ${centre(b)},${b.y - arc} ${centre(b)},${b.y - 7}`
        suivreY(a.y - arc)
        etiq = { x: (centre(a) + centre(b)) / 2, y: a.y - arc + 6, milieu: true }
      } else {
        const monte = a.y > b.y
        const r = linkPath(
          centre(a), monte ? a.y : a.y + a.h,
          centre(b), monte ? b.y + b.h + 7 : b.y - 7,
          a.row, b.row, rowBounds,
        )
        d = r.d
        suivreX(r.maxX)
        etiq = { x: (centre(a) + centre(b)) / 2 + 8, y: (a.y + b.y) / 2 + NODE_H / 2, milieu: false }
      }

      const texte = f.label
        ? `<text class="tag libre${etiq.milieu ? ' centre' : ''}" x="${etiq.x}" y="${etiq.y}">${esc(f.label)}</text>`
        : ''
      return `<path class="edge libre" d="${d}" marker-end="url(#arrow-libre)">` +
        `${titre(f.label || 'flèche libre')}</path>${texte}`
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
      const cliquable = !estAnalyse && !estBase
      return `<g class="${cls}" data-key="${esc(n.key)}"${cliquable ? ' cursor="pointer"' : ''}>
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
export function diagramSvg({ items, analyses, edges, freeArrows, names, base, materialized }) {
  const { placed, width, height, rowBounds } = layout(items, analyses)
  const nom = (k) => names.get(k) ?? k

  // un lien qui contourne par la droite, ou un arc qui passe au-dessus de la
  // rangee du haut, sortiraient du cadre : on suit leurs debordements
  let maxX = width
  let minY = 0
  const suivreX = (x) => { maxX = Math.max(maxX, x) }
  const suivreY = (y) => { minY = Math.min(minY, y) }

  const edgeSvg = drawEdges(edges, placed, rowBounds, nom, suivreX)
  const analysisSvg = drawAnalyses(analyses, placed, rowBounds, nom, suivreX)
  const freeSvg = drawFreeArrows(freeArrows, placed, rowBounds, suivreX, suivreY)
  const boxSvg = drawBoxes(placed, base, materialized, nom)

  const w = Math.max(width, maxX + MARGIN)
  // on remonte l'origine du viewBox plutot que de deplacer tout le contenu
  const top = Math.min(0, minY - 6)
  const h = height - top

  return `<svg id="svg" xmlns="http://www.w3.org/2000/svg"
      width="${w}" height="${h}" viewBox="0 ${top} ${w} ${h}">
    <style>${SVG_STYLE}</style>
    <defs>
      ${MARKERS}
    </defs>
    <rect data-export="background" x="0" y="${top}" width="${w}" height="${h}" fill="#ffffff"/>
    <g data-export="content">${edgeSvg}${analysisSvg}${freeSvg}${boxSvg}</g>
  </svg>`
}
