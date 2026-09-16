# Treillis d'agrégats OLAP

Application web 100 % client pour construire les **treillis d'agrégats** du
cours de modélisation multidimensionnelle de F. Ravat : le **treillis complet**
de tous les agrégats possibles (p.34), et le **treillis partiel** des vues
réellement matérialisées (p.35, p.61-62). Aucun backend, aucun compte, aucune
dépendance : trois fichiers statiques.

**Essayer en ligne :** https://crussiere.github.io/TreillisApp/

## Ce que fait l'app

- **Treillis complet** — à partir des hiérarchies saisies, l'app génère tous
  les agrégats possibles : le produit cartésien des niveaux de chaque
  dimension, augmenté du niveau `All`. Deux dimensions de trois niveaux
  donnent 4 × 4 = 16 nœuds, exactement la planche p.34. Les arêtes sont les
  roll-up : une arête ne remonte **qu'une** dimension, **d'un** niveau.
- **Treillis partiel** — on choisit les agrégats à matérialiser. L'app en déduit
  les arêtes de dérivation : chaque agrégat se calcule depuis son **plus
  proche ancêtre matérialisé**, pas depuis les données détaillées. C'est ce
  qui donne la chaîne `VENTES → Agg1 → Agg2` de la p.35 plutôt que deux
  agrégats branchés en parallèle sur la table de faits.
- **Analyses** — les requêtes fréquentes (A1, A2 de la planche). Chacune est
  reliée automatiquement à l'agrégat capable d'y répondre.
- **SQL des vues matérialisées** — le `CREATE MATERIALIZED VIEW` de chaque
  agrégat, avec la bonne source et le bon `GROUP BY` (p.62).
- **Import / export JSON** et **export image** (SVG, PNG, JPG).

## Utilisation

Le panneau de gauche porte la saisie : le **fait**, ses **mesures** avec leur
fonction d'agrégation, et les **dimensions**. Les niveaux d'une dimension sont
ordonnés **du plus fin (la clé) au plus général** ; les flèches ▲▼ les
réordonnent. Le niveau `All` n'est jamais saisi : il est ajouté d'office, car
il fait partie du treillis.

Au chargement, l'app est pré-remplie avec l'exemple VENTES du cours.

### Construire un treillis partiel

Un treillis partiel, c'est une liste d'agrégats à matérialiser. Deux façons de
la remplir, qui modifient la même chose :

1. **Panneau « Agrégats à matérialiser »**, tout en bas à gauche. *+ agrégat*
   ajoute une ligne, et la ligne porte **une liste déroulante par dimension** :
   on y choisit le niveau. C'est la voie sûre — pas besoin de retrouver le nœud
   à l'œil, et elle marche dans les deux modes.
2. **Clic sur un nœud du canvas**, en mode *Treillis complet* : il passe en
   bleu. Pratique sur un petit treillis, vite pénible au-delà de quelques
   dizaines de nœuds.

Exemple, pour obtenir `codeP, num_mois, codeC` : *+ agrégat*, puis PRODUITS →
`codeP`, TEMPS → `num_mois`, CLIENTS → `codeC`.

Le commutateur en haut à gauche bascule l'affichage. En mode **partiel**, seuls
les agrégats retenus restent visibles, reliés par leurs arêtes de dérivation et
nommés `Agg1`, `Agg2`… dans l'ordre topologique — l'ordre où le panneau les
liste, lui aussi.

Deux règles pour éviter les impasses :

- les **données détaillées** sont toujours là et ne se décochent pas : c'est la
  table de faits, la source de tout le reste. Elle n'apparaît donc pas dans la
  liste des agrégats ;
- amener un agrégat sur un nœud déjà retenu **fusionne** les deux lignes, il
  n'y a jamais de doublon.

### Sens de lecture

Les **données détaillées sont en bas**, l'agrégation monte, et les analyses
forment la bande du haut — l'orientation de la planche p.35. Les flèches
bleues montent (un agrégat est calculé depuis ce qui est sous lui), les
flèches sombres des analyses descendent vers l'agrégat qui les sert.

### Choisir la source d'un agrégat

Chaque agrégat porte une liste **« calculé depuis »**. Par défaut `auto` :
l'app prend le plus proche ancêtre matérialisé. La liste ne propose que des
sources réellement valides, c'est-à-dire les nœuds matérialisés **strictement
plus fins** — rien d'autre ne peut produire l'agrégat par agrégation.

Les deux cas du cours coexistent sans réglage :

- **plusieurs agrégats sur la même source** — deux agrégats incomparables se
  branchent chacun sur la table de faits ;
- **un agrégat sur un autre agrégat** — c'est le `Agg2 ← Agg1` de la p.35.

Forcer une source sert quand on veut s'écarter de ce choix, par exemple
brancher `Agg2` directement sur la table de faits alors qu'`Agg1` existe. Le
lien est alors tracé **en pointillés**, pour distinguer d'un coup d'œil ce qui
est imposé de ce qui est calculé. Une source devenue invalide (supprimée, ou
trop grossière après un remaniement des niveaux) redevient automatique.

### Analyses

*+ analyse* crée une requête : un nom, la mesure analysée, et un niveau par
dimension. L'app lui rattache **le plus grossier des agrégats qui reste assez
fin** pour y répondre — le moins de lignes à parcourir. Si une analyse retombe
sur la table de faits, c'est qu'aucun agrégat ne l'accélère ; le panneau
l'indique sous chaque analyse (« servie par … »).

### Re-agrégation des mesures

Le SQL tient compte du fait qu'un agrégat calculé depuis un autre agrégat ne
se recalcule pas toujours avec la même fonction :

| Fonction | Depuis les données détaillées | Depuis un agrégat |
|---|---|---|
| `SUM`, `MIN`, `MAX` | identique | identique |
| `COUNT` | `COUNT` | `SUM` — on cumule des comptes |
| `AVG` | `AVG` | **non additive** : un commentaire signale qu'il faut repartir du détail |

## Exemple : reproduire la planche p.35

[`exemple-p35.json`](exemple-p35.json) contient le treillis partiel de la
planche « Détermination de certains nœuds du treillis des vues ».
**Importer JSON** → basculer sur **Treillis partiel** :

```
        [ A1 ]                [ A2 ]           <- analyses
           |                     |
           v                     v
                    All, annee, codeC     Agg2   ^
                            ^                    |  l'agregation
                    codeP, num_mois, codeC Agg1  |  monte
                            ^                    |
                    codeP, codeT, codeC   VENTES <- donnees detaillees
```

À la main, cela revient à saisir trois dimensions de trois niveaux — PRODUITS
`codeP / sous_categ / categorie`, TEMPS `codeT / num_mois / annee`, CLIENTS
`codeC / ville / pays` — puis à créer deux agrégats dans le panneau :

| Agrégat | PRODUITS | TEMPS | CLIENTS |
|---|---|---|---|
| Agg1 | `codeP` | `num_mois` | `codeC` |
| Agg2 | `All` | `annee` | `codeC` |

puis les deux analyses de la bande du haut :

| Analyse | Mesure | PRODUITS | TEMPS | CLIENTS | Servie par |
|---|---|---|---|---|---|
| A1 | `SUM(quantite)` | `codeP` | `num_mois` | `codeC` | Agg1 |
| A2 | `SUM(montant)` | `All` | `annee` | `codeC` | Agg2 |

Deux écarts d'affichage avec la planche, sans conséquence sur le treillis
lui-même :

- l'app écrit `All, annee, codeC` là où la planche écrit `annee, codeC` — une
  dimension au niveau `All` reste affichée, comme sur la planche p.34
  (`All, codeT`, `All, All`) ; elle n'apparaît ni dans le `SELECT` ni dans le
  `GROUP BY` du SQL généré ;
- `Nom` est un attribut faible de `codeC`, pas un niveau de hiérarchie : il ne
  gradue pas l'axe CLIENTS et n'entre donc pas dans le treillis.

## Passerelle avec l'app de modélisation OLAP

Un schéma en étoile modélisé avec
[appmodelisationolap](https://github.com/CRUSSIERE/appmodelisationolap)
s'importe directement : **Importer JSON** détecte le format et lit les
`hierarchies[].path` de chaque dimension, qui sont exactement les axes du
treillis.

```
appmodelisationolap  --- schema.json --->  TreillisApp

H_Pro = <codeP, sous_categ, categorie>        16 noeuds (2 dimensions)
H_An  = <codeT, num_mois, annee>              64 noeuds (3 dimensions)
```

Une dimension à **hiérarchies multiples** fait apparaître un sélecteur : le
treillis prend un axe par dimension, on choisit laquelle sert d'axe.

## Format JSON

Format de travail de l'app, écrit par **Exporter JSON** et relu à l'identique
par **Importer JSON** (sélection des agrégats comprise) :

```jsonc
{
  "version": 1,
  "factName": "VENTES",
  "measures": [
    { "name": "quantite", "agg": "SUM" }   // SUM | COUNT | MIN | MAX | AVG
  ],
  "dimensions": [
    { "name": "PRODUITS", "levels": ["codeP", "sous_categ", "categorie"] }
    //                              du plus fin (la clé) au plus général,
    //                              `All` implicite et non listé
  ],
  "materialized": ["0,1"],  // un nœud = un indice de niveau par dimension,
                            // dans l'ordre de `dimensions`. L'indice
                            // `levels.length` désigne `All`.
  "sources": {              // source imposée : agrégat -> son nœud source.
    "0,1": "0,0"            // absent = calcul automatique. Facultatif.
  },
  "analyses": [             // facultatif
    { "name": "A1", "levels": [0, 1], "measure": "quantite" }
  ],
  "mode": "complete"        // complete | partial
}
```

Retirer une dimension ou raccourcir une hiérarchie rend certaines clés
caduques : elles sont élaguées silencieusement à l'import et à chaque
modification de structure. Ajouter un niveau en fin de hiérarchie ne perd
aucune sélection.

## Export image

**SVG** (vectoriel), **PNG** et **JPG** (rastérisés à ×2 pour rester nets à
l'impression). Le JPG reçoit un fond blanc opaque, le PNG garde la
transparence. L'image est recadrée sur le contenu réel, avec une marge de
16 px. Le SVG exporté embarque ses propres styles : il s'ouvre seul, hors de
l'app. Seules des polices système sont utilisées — une webfont disparaîtrait
à la rastérisation.

## Développement

Les modules ES imposent un vrai serveur, `file://` ne suffit pas :

```bash
python -m http.server 8765
```

puis http://127.0.0.1:8765.

Le contrôle du cœur logique rejoue les planches du cours en assertions :

```bash
node verify.mjs
```

26 contrôles : les 16 nœuds et les 24 arêtes de la p.34, la chaîne de
dérivation de la p.35, les sources forcées, le rattachement des analyses, le
SQL de la p.62, le round-trip JSON, et la conversion depuis le format
d'appmodelisationolap.

## Déploiement sur GitHub Pages

Pas de build, pas de workflow : les fichiers sont servis tels quels.

1. Créer le dépôt sur GitHub et y pousser la branche `main`.
2. *Settings → Pages → Build and deployment → Source : **Deploy from a
   branch**, branche `main`, dossier `/ (root)`*.

> **À chaque modification de `lattice.js`, incrémenter le `?v=` de son import
> dans `index.html`.** GitHub Pages sert les deux fichiers avec
> `Cache-Control: max-age=600`, mis en cache chacun de son côté : sans ce
> marqueur, un visiteur peut récupérer un `index.html` neuf et garder un
> `lattice.js` périmé, qui n'exporte pas encore ce que la page importe. Le
> module échoue alors en silence — et un module ES qui échoue ne laisse *rien*
> à l'écran. Un filet dans la page transforme malgré tout ce cas en message
> lisible (« recharge avec Ctrl+F5 ») plutôt qu'en page blanche.

## Limites connues

- Le treillis complet croît comme le produit des hauteurs de hiérarchie.
  Au-delà de **500 nœuds** l'app refuse de dessiner et affiche le compte : à
  4 dimensions de 4 niveaux on est déjà à 625. Le treillis partiel est là
  pour ça.
- La disposition ordonne les nœuds lexicographiquement dans chaque couche,
  sans réduction de croisements : au-delà de 3 dimensions les arêtes se
  croisent beaucoup.

## Crédits

Le formalisme multidimensionnel et les exemples implémentés sont ceux du
cours *Modélisation Multidimensionnelle* de F. Ravat (avec O. Teste),
Université Toulouse I Capitole. La passerelle JSON vise le format de
[appmodelisationolap](https://github.com/CRUSSIERE/appmodelisationolap).
