# Migration de l’IHM Maket V2

Ce document est la matrice de migration de l’interface. La cible n’est pas une
nouvelle application dessinée à côté de l’existante : le Web et Electron
montent le même `AppShell` React, alimenté par le même store Zustand et les
mêmes contrats HTTP/WS. Electron ajoute seulement le cycle de vie natif, le
menu système et un bridge preload typé.

## Organisation cible et réemploi

| Zone V2 | Orchestrateur | Composants métier réemployés | Capacités conservées |
| --- | --- | --- | --- |
| Bibliothèque gauche | `LibraryPanel` | `DocsTab`, `DocsToolbar`, `DocsCategory`, `DocItem`, `DocMenu`, `BulkActionBar`, `ChartesTab`, `CharteEditModal`, `PhotosTab`, `CollectionsTab` | Recherche, filtres, arborescence, liste/vignettes, import/export, actions documentaires, sélection multiple, chartes, photos et catalogue de collections |
| Barre haute globale | `WorkspaceHeader` | `DataSourceToolbarControl`, commandes de lecture et de zoom existantes | Bascule du panneau gauche, document et fil d’Ariane, liaison de données, modes d’un document vivant, lecture, recadrage, verrouillage, impression et recadrage automatique ; la même barre occupe le chrome Electron et reste en tête de la vue Web |
| Espace central | `AppShell` | `Board`, `WorkspaceDoc`, `PageCanvas`, `Popover`, `StateEnumSelect` | Multi-document, pages, zoom/pan, sélection et édition HTML, états, placeholders, annotations, verrouillage et rendu de collection |
| Collection inférieure | `CollectionWorkspace` | Éditeur de schéma, table et contrôles de données existants | Champs, lignes, copier-coller tabulaire, brouillon, validation, sauvegarde, reset, curseur, précédent/suivant, pin, split et expansion |
| Panneau droit | `MessagesPanel` | File d’échanges et cartes existantes | Notes document/élément, ouverture de la cible, résolution et synchronisation multi-fenêtre |
| Rail global | `UtilityRail` | Commandes aide, langue et thème existantes | Échanges, aide, langue, thème et compteur d’activité |
| Lecture | `ReadingWorkspace` | Rendu et navigation de lecture existants | Lecture sans outils d’auteur, navigation documents/pages, états locaux et raccourcis |
| Electron | `main`, `preload`, `desktopCommands`, menu natif | Le même `AppShell` servi par le serveur | Workspace, navigateur, URL serveur, mises à jour et commandes d’IHM sans accès Node dans le renderer |

Les libellés viennent du catalogue i18n existant et les pictogrammes restent
les icônes Lucide déjà utilisées par Maket. Aucun jeu d’icônes métier parallèle
n’est introduit.

## Cinématique des panneaux

- Le sélecteur de la bibliothèque remplace le contenu du même emplacement
  gauche entre Documents, Chartes, Photos et Collections.
- Sur un écran d’au moins 960 px, les emplacements gauche et droit sont
  indépendants. Leurs largeurs sont redimensionnables et persistées séparément.
- Sous 960 px, un seul panneau devient un tiroir superposé. Ouvrir l’autre
  ferme le premier.
- `Escape` ferme le dernier panneau activé et rend le focus à l’espace de
  travail.
- Ouvrir les données depuis un document lié produit un split avec la collection
  en bas. L’expansion conserve une miniature du document pour revenir au split.
- Ouvrir une collection depuis le catalogue donne la priorité aux données. Si
  elle n’est pas liée au document actif, la table occupe tout l’espace central ;
  l’ouverture ne crée jamais de liaison implicite.

## Matrice de non-régression

| Domaine | Preuve publique |
| --- | --- |
| Shell partagé et responsive | `shell-v2.spec.ts`, tests `AppShell`, `LibraryPanel`, `UtilityRail` |
| Documents et organisation | `documents.spec.ts`, tests `docs/*` |
| Canvas, édition, états et verrouillage | tests `Board`, `WorkspaceDoc`, `PageCanvas`, `presentation-policy` |
| Chartes et rendu | `chartes.spec.ts`, `rendering-surfaces.spec.ts`, test `CharteEditModal` |
| Photos | `photos.spec.ts` |
| Collections et curseur serveur | `collections.spec.ts`, tests `CollectionWorkspace`, `DataSourceToolbarControl` |
| Échanges et annotations | `messages.spec.ts`, tests `MessagesPanel` |
| Lecture et viewer | `ReadingWorkspace.test.tsx`, `viewer.spec.ts` |
| Impression, snapshot, PDF et bundles | `exports.spec.ts`, `portability.spec.ts`, `starters.spec.ts` |
| Préférences | `preferences.spec.ts` |
| Menu et preload Electron | tests `desktopCommands`, `menu`, `preload` et `workspace-controller` |

Les évolutions du diagnostic/réparation MCP, de la distribution signée et du
pipeline de publication restent suivies par l’issue 73 ; elles n’entraînent pas
une seconde implémentation de l’IHM documentaire.
