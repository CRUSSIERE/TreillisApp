/**
 * Sortie de fichiers : telechargement JSON et export image.
 *
 * Contrairement a lattice.js et render.js, ce module touche au navigateur
 * (Blob, canvas, XMLSerializer) : il n'est donc pas couvert par verify.mjs.
 * Il reste separe parce que c'est une preoccupation distincte -- et la plus
 * silencieuse a casser, puisqu'un export rate ne se voit qu'a l'ouverture du
 * fichier.
 */

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadJson(data, filename) {
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), filename)
}

/** Copie du diagramme dimensionnee en px, recadree sur son contenu reel.
 *  Un seul getBBox sur le groupe sans transform suffit : il unit deja ses
 *  enfants dans l'espace de la racine. Le fond reste hors du groupe pour ne
 *  pas gonfler la boite. */
function exportClone(svg, border = 16) {
  // les affordances d'edition (poignees) vivent hors du groupe mesure : le
  // recadrage les ignore donc naturellement, et il suffit de les retirer du
  // clone pour qu'elles ne partent pas dans l'image
  const box = svg.querySelector('[data-export="content"]').getBBox()
  const x = box.x - border
  const y = box.y - border
  const width = box.width + border * 2
  const height = box.height + border * 2

  const clone = svg.cloneNode(true)
  clone.removeAttribute('id')
  clone.querySelectorAll('[data-export="chrome"]').forEach((el) => el.remove())
  clone.setAttribute('viewBox', `${x} ${y} ${width} ${height}`)
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  const bg = clone.querySelector('[data-export="background"]')
  bg.setAttribute('x', String(x))
  bg.setAttribute('y', String(y))
  bg.setAttribute('width', String(width))
  bg.setAttribute('height', String(height))
  return { clone, width, height }
}

/**
 * Exporte le SVG affiche en SVG, PNG ou JPG.
 * `nomFichier` est donne sans extension.
 */
export async function exportImage(svg, format, nomFichier) {
  if (!svg) throw new Error('Rien à exporter : le treillis n’est pas affiché.')

  const { clone, width, height } = exportClone(svg)
  const text = new XMLSerializer().serializeToString(clone)

  if (format === 'svg') {
    downloadBlob(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }), `${nomFichier}.svg`)
    return
  }

  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }))
  const canvas = document.createElement('canvas')
  const scale = 2 // raster x2 : le texte reste net a l'impression
  try {
    const img = new Image()
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = () => reject(new Error('échec du rendu SVG'))
      img.src = url
    })
    canvas.width = width * scale
    canvas.height = height * scale
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2D indisponible')
    ctx.scale(scale, scale)
    // le JPEG n'a pas de canal alpha : on peint le fond sur le canvas plutot
    // que de compter sur la transparence
    if (format === 'jpeg') {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)
    }
    ctx.drawImage(img, 0, 0, width, height)
  } finally {
    URL.revokeObjectURL(url)
  }

  const blob = await new Promise((res) =>
    canvas.toBlob(res, format === 'png' ? 'image/png' : 'image/jpeg', 0.95),
  )
  if (!blob) throw new Error('échec de génération de l’image')
  downloadBlob(blob, `${nomFichier}.${format === 'jpeg' ? 'jpg' : 'png'}`)
}
