# Treillis d'agrégats OLAP

Application web 100 % client pour construire les **treillis d'agrégats** du
cours de modélisation multidimensionnelle de F. Ravat : le **treillis complet**
de tous les agrégats possibles (p.34), et le **treillis partiel** des vues
réellement matérialisées (p.35, p.61-62). Aucun backend, aucun compte, aucune
dépendance : des fichiers statiques.

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
   dizaines de nœuds. Les nœuds décochables sont atteignables au **clavier**
   (Tab pour circuler, Entrée ou Espace pour basculer) ; les données
   détaillées, qui ne se décochent pas, ne prennent pas le focus.

Exemple, pour obtenir `codeP, num_mois, codeC` : *+ agrégat*, puis PRODUITS →
`codeP`, TEMPS → `num_mois`, CLIENTS → `codeC`.

Le commutateur en haut à gauche bascule l'affichage. En mode **partiel**, seuls
les agrégats retenus restent visibles, reliés par leurs arêtes de dérivation et
nommés `(Agg1)`, `(Agg2)`… dans l'ordre topologique — l'ordre où le panneau
les liste, lui aussi. Les parenthèses sont celles de la planche ; elles ne
valent que pour le diagramme : les listes du panneau et le SQL généré gardent
le nom nu (`FROM Agg1`).

Deux règles pour éviter les impasses :

- les **données détaillées** sont toujours là et ne se décochent pas : c'est la
  table de faits, la source de tout le reste. Elle n'apparaît donc pas dans la
  liste des agrégats ;
- amener un agrégat sur un nœud déjà retenu **fusionne** les deux lignes, il
  n'y a jamais de doublon.

### Attributs faibles

Un niveau peut porter des **attributs faibles** — `nom` sur `codeC`, `lib_mois`
sur `num_mois`. Ils se saisissent sous chaque niveau, séparés par des virgules,
et arrivent tout seuls à l'import depuis l'app de modélisation OLAP.

Une analyse peut alors les cocher : c'est ainsi qu'on écrit le `Annee, Nom` de
la planche p.35, alors que `Nom` n'est pas un niveau de hiérarchie. Un attribut
faible **n'ajoute aucune granularité** — il dépend de son paramètre (p.8), donc
c'est une colonne de plus, pas un axe : il ne change pas quel agrégat répond.

Il ne vaut qu'**au niveau dont il dépend** : remonter CLIENTS de `codeC` à
`ville` retire `nom` des analyses concernées, puisqu'il n'a plus de sens.

### Infléchir un lien

Chaque lien — dérivation, rattachement d'analyse, flèche libre — porte une
petite **poignée** en son milieu. La glisser infléchit le tracé ; ses deux
extrémités restent accrochées à leurs boîtes. **Double-clic** pour rétablir le
tracé automatique.

C'est fait pour les croisements gênants : sur un treillis un peu fourni, deux
flèches peuvent se superposer ou passer derrière une boîte, et rien dans le
placement automatique ne le résout. Le pli est mémorisé en **écart au milieu
du segment**, pas en position absolue : il suit donc les boîtes quand la
disposition change.

Les poignées sont une affordance d'édition : elles sont dessinées hors du
contenu mesuré et **n'apparaissent pas dans l'image exportée**.

### Flèches libres

*+ flèche* relie **deux éléments quelconques** du schéma — deux agrégats, deux
analyses, une analyse et la table de faits. Tracées en **violet pointillé**,
avec un libellé facultatif. Purement graphiques : elles n'entrent ni dans les
dérivations, ni dans le SQL. Une flèche entre deux éléments d'une même rangée
passe par-dessus, pour ne pas traverser les boîtes voisines.

### Sens de lecture

Le diagramme est découpé en trois **bandes**, séparées par des pointillés
comme sur la planche p.35 : **Données détaillées** en bas, **Données
agrégées** au milieu, **Analyses** en haut. Les données détaillées sont donc
en bas et l'agrégation monte.

La bande *Analyses* n'apparaît que s'il existe une analyse, et aucun séparateur
n'est tracé tant qu'il n'y a rien à séparer — un treillis réduit à sa table de
faits reste nu. Les flèches
bleues montent (un agrégat est calculé depuis ce qui est sous lui), les
flèches sombres des analyses descendent vers l'agrégat qui les sert.

Une dimension au niveau `All` **ne s'affiche pas** : elle n'apporte rien à la
lecture du nœud. `All, annee, codeC` se lit donc `annee, codeC`, comme sur la
planche. Le sommet du treillis, où tout est agrégé, garde le libellé `All` —
c'est le total. Les nœuds restent discernables entre eux.

Un lien qui **enjambe** une rangée n'est courbé que s'il traverserait
vraiment une boîte intermédiaire ; sinon il reste droit. Une courbe
systématique envoyait un lien partant du bord gauche faire un long détour par
la droite alors que la droite passait au large. Survoler un lien affiche ce
qu'il relie.

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

Un agrégat ne peut répondre à une analyse **que s'il est au moins aussi fin
qu'elle, sur chaque dimension**. Un agrégat au mois ne répond pas à une
question au jour : le détail n'existe plus. C'est pourquoi une analyse définie
sur `codeT` se rattache à la table de faits même si un agrégat au `num_mois`
existe — il suffit de passer l'analyse au mois pour qu'elle s'y branche.

La liste **« pointe vers »** permet de forcer le rattachement, comme pour la
source d'un agrégat. À la différence de celle-ci, elle propose **tous** les
agrégats, y compris ceux qui ne peuvent pas répondre : c'est utile pour
dessiner une intention. Un rattachement intenable est alors tracé en
**rouge pointillé**, et le panneau dit pourquoi (« Agg1 est trop agrégé sur
TEMPS »), plutôt que de laisser croire à une flèche valide.

### Re-agrégation des mesures

Le SQL tient compte du fait qu'un agrégat calculé depuis un autre agrégat ne
se recalcule pas toujours avec la même fonction :

| Fonction | Depuis les données détaillées | Depuis un agrégat |
|---|---|---|
| `SUM`, `MIN`, `MAX` | identique | identique |
| `COUNT` | `COUNT` | `SUM` — on cumule des comptes |
| `AVG` | `SUM` + `COUNT` | `SUM` des deux colonnes |

Une **moyenne ne se ré-agrège pas** : la moyenne des moyennes n'est pas la
moyenne. Plutôt que d'émettre un `AVG` faux, l'app stocke de quoi la
recalculer — sa somme et son effectif, tous deux additifs — et donne la
formule en commentaire :

```sql
-- montant : moyenne = montant_som / montant_nb (AVG n'est pas additive)
       SUM(montant_som) AS montant_som,
       SUM(montant_nb)  AS montant_nb
```

Les identifiants ne sont mis entre guillemets que lorsqu'ils l'exigent : un
niveau nommé `mon niveau` donne `GROUP BY "mon niveau"`, tandis que `codeP`
reste nu — sous Oracle, `"codeP"` entre guillemets devient sensible à la casse
et ne désignerait plus la même colonne.

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

A2 coche en plus l'attribut faible **`nom`** de `codeC`, ce qui donne le
`Annee, Nom` de la planche.

Deux écarts d'affichage avec la planche, sans conséquence sur le treillis
lui-même :

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
treillis prend un axe par dimension, on choisit laquelle sert d'axe. Changer
d'axe change aussi ses attributs faibles, qui sont attachés aux paramètres du
chemin choisi.

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
    {
      "name": "PRODUITS",
      "levels": ["codeP", "sous_categ", "categorie"],
      //          du plus fin (la clé) au plus général, `All` implicite
      "weak": { "0": ["description"] }  // attributs faibles, par indice de
                                        // niveau. Facultatif.
    }
  ],
  "materialized": ["0,1"],  // un nœud = un indice de niveau par dimension,
                            // dans l'ordre de `dimensions`. L'indice
                            // `levels.length` désigne `All`.
  "sources": {              // source imposée : agrégat -> son nœud source.
    "0,1": "0,0"            // absent = calcul automatique. Facultatif.
  },
  "analyses": [             // facultatif
    {
      "id": "a1",           // identité stable, visée par les flèches libres
      "name": "A1",
      "levels": [0, 1],
      "measure": "quantite",
      "extras": ["description"],  // attributs faibles affichés
      "target": "0,0"             // rattachement imposé ; absent = calculé
    }
  ],
  "freeArrows": [           // facultatif, purement graphique
    { "from": "0,0", "to": "A:a1", "label": "note" }
  ],
  "edgeBends": {            // facultatif : liens infléchis à la main.
    "0,0>0,1": { "dx": -40, "dy": 15 }   // écart de la poignée au milieu
  },
  "mode": "complete"        // complete | partial
}
```

Retirer une dimension ou raccourcir une hiérarchie rend certaines clés
caduques. Avant une telle suppression, l'app **chiffre ce qui serait perdu**
et demande confirmation — elle n'a pas d'annulation, et un clic malheureux
effaçait auparavant en silence un treillis partiel construit à la main. Elle
ne demande rien quand rien n'est perdu : ajouter un niveau en fin de
hiérarchie, par exemple, conserve toute la sélection.

À l'import, en revanche, les clés caduques sont élaguées sans question : le
fichier fait foi.

## Export image

**SVG** (vectoriel), **PNG** et **JPG** (rastérisés à ×2 pour rester nets à
l'impression). Le JPG reçoit un fond blanc opaque, le PNG garde la
transparence. L'image est recadrée sur le contenu réel, avec une marge de
16 px. Le SVG exporté embarque ses propres styles : il s'ouvre seul, hors de
l'app. Seules des polices système sont utilisées — une webfont disparaîtrait
à la rastérisation.

## Organisation du code

| Fichier | Rôle | Pur ? |
|---|---|---|
| `lattice.js` | Sémantique OLAP : treillis, dérivations, analyses, SQL, format JSON | oui |
| `render.js` | Géométrie et dessin : disposition, tracé des liens, génération du SVG | oui |
| `files.js` | Sorties : téléchargement JSON, export image | non (Blob, canvas) |
| `index.html` | État, panneau de saisie, événements | non (DOM) |

Les deux modules purs ne connaissent ni le DOM ni l'état de l'app : `render.js`
reçoit un modèle **déjà résolu** — qui dérive de quoi, quelle analyse est
servie par qui — et se contente de placer et de dessiner. C'est ce qui permet à
`verify.mjs` de contrôler le dessin comme il contrôle le treillis, échappement
des libellés compris.

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

66 contrôles : les 16 nœuds et les 24 arêtes de la p.34, la chaîne de
dérivation de la p.35, les sources forcées, le rattachement des analyses, le
SQL de la p.62, la décomposition des moyennes, l'échappement des identifiants,
les attributs faibles, l'élagage de la sélection, le tracé des liens qui
enjambent une rangée, la génération du SVG, le round-trip JSON, et la
conversion depuis le format d'appmodelisationolap.

## Déploiement sur GitHub Pages

Pas de build, pas de workflow : les fichiers sont servis tels quels.

1. Créer le dépôt sur GitHub et y pousser la branche `main`.
2. *Settings → Pages → Build and deployment → Source : **Deploy from a
   branch**, branche `main`, dossier `/ (root)`*.

> **À chaque modification d'un module, incrémenter la constante `V` en tête du
> script de `index.html`.** GitHub Pages sert la page et chaque module avec
> `Cache-Control: max-age=600`, mis en cache séparément : sans marqueur de
> version, un visiteur peut récupérer un `index.html` neuf et garder un module
> périmé, qui n'exporte pas encore ce que la page importe. L'import échoue
> alors — et un module ES qui échoue ne laisse *rien* à l'écran.
>
> `V` est unique et les trois modules sont chargés par import dynamique, pour
> qu'il n'y ait qu'**un** endroit à incrémenter : avec trois littéraux, on en
> oublie. `node verify.mjs` refuse d'ailleurs toute version écrite en dur.
> Enfin, un filet dans la page transforme un démarrage raté en message lisible
> (« recharge avec Ctrl+F5 ») plutôt qu'en page blanche.

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
