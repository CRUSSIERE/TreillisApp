# Treillis d'agrégats OLAP

Application web 100 % client pour construire les **treillis d'agrégats** du
cours de modélisation multidimensionnelle de F. Ravat : le **treillis complet**
de tous les agrégats possibles (p.34), et le **treillis partiel** des vues
réellement matérialisées (p.35, p.61-62). Aucun backend, aucun compte, aucune
dépendance : trois fichiers statiques.

**Essayer en ligne :** *(à compléter après activation de GitHub Pages)*

## Ce que fait l'app

- **Treillis complet** — à partir des hiérarchies saisies, l'app génère tous
  les agrégats possibles : le produit cartésien des niveaux de chaque
  dimension, augmenté du niveau `All`. Deux dimensions de trois niveaux
  donnent 4 × 4 = 16 nœuds, exactement la planche p.34. Les arêtes sont les
  roll-up : une arête ne remonte **qu'une** dimension, **d'un** niveau.
- **Treillis partiel** — on clique les nœuds à matérialiser. L'app en déduit
  les arêtes de dérivation : chaque agrégat se calcule depuis son **plus
  proche ancêtre matérialisé**, pas depuis les données détaillées. C'est ce
  qui donne la chaîne `VENTES → Agg1 → Agg2` de la p.35 plutôt que deux
  agrégats branchés en parallèle sur la table de faits.
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

### Basculer complet / partiel

Le commutateur en haut à gauche. En mode complet, **cliquer un nœud** le
marque comme matérialisé (il passe en bleu). En mode partiel, seuls les nœuds
marqués restent affichés, reliés par leurs arêtes de dérivation et nommés
`Agg1`, `Agg2`… dans l'ordre topologique. Le nœud de base — les données
détaillées — est toujours matérialisé : c'est la table de faits elle-même, il
n'est pas décochable.

### Re-agrégation des mesures

Le SQL tient compte du fait qu'un agrégat calculé depuis un autre agrégat ne
se recalcule pas toujours avec la même fonction :

| Fonction | Depuis les données détaillées | Depuis un agrégat |
|---|---|---|
| `SUM`, `MIN`, `MAX` | identique | identique |
| `COUNT` | `COUNT` | `SUM` — on cumule des comptes |
| `AVG` | `AVG` | **non additive** : un commentaire signale qu'il faut repartir du détail |

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

18 contrôles : les 16 nœuds et les 24 arêtes de la p.34, la chaîne de
dérivation de la p.35, le SQL de la p.62, le round-trip JSON, et la
conversion depuis le format d'appmodelisationolap.

## Déploiement sur GitHub Pages

Pas de build, pas de workflow : les fichiers sont servis tels quels.

1. Créer le dépôt sur GitHub et y pousser la branche `main`.
2. *Settings → Pages → Build and deployment → Source : **Deploy from a
   branch**, branche `main`, dossier `/ (root)`*.

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
