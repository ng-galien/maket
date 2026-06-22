# Collections et placeholders - MVP

Cette itération couvre le cas simple : des collections plates, des pages gabarits
contenant des placeholders, puis un rendu qui produit les pages finales en injectant
les membres de collection. Elle ne traite pas encore le livre, les breakpoints,
l'autolayout, les flux longs, les listes répétées ni les champs riches.

## Valeur métier

Une collection permet de produire des variantes contrôlées d'un document Maket sans
dupliquer manuellement les pages. Le cas visé est le publipostage simple : carte
client, invitation nominative, plaquette personnalisée, étiquette ou courrier.

Le document reste un document Maket normal. La collection ajoute une dimension de
variation portée par des données métier vérifiables.

## Principes

Les données, le gabarit et la présentation restent séparés.

| Couche | Contient | Ne contient pas |
|---|---|---|
| Collection | schéma JSON, membres, valeurs | HTML, CSS, placeholders |
| Page gabarit | HTML, placeholders, référence de collection | valeurs réelles |
| Charte | tokens, règles, CSS | données métier |

Le rendu est le seul point où ces couches se rejoignent.

## Modèle métier

Une collection est une ressource nommée.

```ts
export interface Collection {
  name: string;
  description?: string;
  schema: CollectionSchema;
  members: CollectionMember[];
}

export interface CollectionMember {
  id: string;
  position: number;
  data: Record<string, unknown>;
}
```

Le schéma est un JSON Schema. Il contrôle les champs disponibles, leur type, les
champs requis et les propriétés additionnelles. Pour le MVP, les placeholders inline
peuvent rendre uniquement les types scalaires `string`, `number`, `integer` et
`boolean`.

Chaque page peut référencer au plus une collection.

```ts
export interface CollectionReference {
  name: string;
}

export interface Page {
  collection?: CollectionReference;
}
```

Un document peut contenir plusieurs pages liées, éventuellement à des collections
différentes. Chaque page liée est rendue une fois par membre de sa collection. Les
pages non liées sont rendues normalement.

## Placeholders

Un placeholder est un emplacement sémantique du gabarit.

```html
<h1>{{ client_name }}</h1>
<span>Page {{ page.number }} / {{ page.total }}</span>
<span>Membre {{ member.number }} / {{ member.total }}</span>
```

Règles MVP :

- `{{ client_name }}` référence une propriété du JSON Schema de la collection liée ;
- les espaces autour du nom sont ignorés ;
- le nom est sensible à la casse ;
- les filtres, conditions, boucles, chemins arbitraires et expressions sont refusés ;
- les placeholders en attribut HTML sont refusés dans le MVP pour garantir une
  localisation DOM fiable côté front ;
- la substitution échappe toujours les valeurs de collection.

Les valeurs générées sont :

| Placeholder | Sens |
|---|---|
| `{{ page.number }}` | numéro 1-based de la page rendue |
| `{{ page.total }}` | nombre total de pages rendues |
| `{{ member.number }}` | rang 1-based du membre dans sa collection |
| `{{ member.total }}` | nombre total de membres de la collection |

Les placeholders doivent pouvoir être localisés par l'éditeur. Le gabarit annoté
utilise des marqueurs DOM stables :

```html
<span
  data-collection-placeholder="client_name"
  data-collection-placeholder-kind="collectionField"
  data-collection-bound="true"
>{{ client_name }}</span>
```

## Validation

Le rendu échoue explicitement si :

- la collection référencée n'existe pas ;
- le schéma JSON est invalide ;
- un membre ne respecte pas le schéma ;
- un placeholder référence un champ absent ;
- un placeholder référence une valeur générée inconnue ;
- un champ non scalaire est utilisé en inline ;
- le template utilise une fonctionnalité hors MVP ;
- un placeholder est placé dans un attribut HTML.

Une chaîne vide est autorisée seulement si elle est une vraie valeur du membre.

## Persistance

La base stocke une ressource collection et ses membres.

```sql
CREATE TABLE collections (
  name        TEXT PRIMARY KEY,
  description TEXT,
  schema      TEXT NOT NULL CHECK (json_valid(schema)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE collection_rows (
  collection_name TEXT NOT NULL REFERENCES collections(name) ON DELETE CASCADE,
  id              TEXT NOT NULL,
  position        INTEGER NOT NULL,
  data            TEXT NOT NULL CHECK (json_valid(data)),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (collection_name, id)
);
```

Le nom `collection_rows` est un détail relationnel. Le langage domaine reste
`CollectionMember`.

## Rendu

Le document stocké garde les pages gabarits. Le rendu produit un document dérivé.

Algorithme :

1. lire toutes les collections référencées par les pages ;
2. valider chaque collection et chaque page gabarit ;
3. calculer le nombre final de pages ;
4. rendre les pages non liées telles quelles ;
5. pour chaque page liée, produire une page par membre ;
6. remplacer les placeholders avec les valeurs échappées et les valeurs générées.

L'export `.maket` conserve le gabarit vivant, les références de pages et les
collections référencées. Il n'exporte pas les pages rendues comme pages persistées.

## UX/UI

La collection est une ressource workspace au même niveau que documents, chartes et
photos.

Fonctions MVP :

- lister les collections ;
- créer, éditer, dupliquer et supprimer une collection ;
- ouvrir une collection dans le workspace ;
- afficher un visualisateur tabulaire contrôlé par le JSON Schema ;
- éditer les valeurs des membres ;
- lier une collection à une page ;
- insérer un champ de collection ou une valeur générée dans le gabarit ;
- afficher les erreurs de placeholders et de données.

Le vocabulaire UI est : collection, membre, champ, valeur, page liée, placeholder.
On évite record, row, binding et repeat dans l'interface.

## Points d'entrée

Un service applicatif `collections` porte les opérations métier et passe par le store.
Les effets sont propagés par le bus.

Un outil MCP `maket_collection` expose :

| Action | Effet |
|---|---|
| `list` | liste les collections |
| `view` | affiche une collection |
| `set` | crée ou remplace une collection |
| `delete` | supprime une collection |
| `bind` | lie une collection à une page |

Les commandes WS couvrent la sauvegarde, la suppression et la liaison à une page.
Les signaux WS annoncent les changements aux clients.

## Qualité

La feature doit être couverte par :

- tests de parsing et validation ;
- tests de rendu avec valeurs générées ;
- tests store et service ;
- tests bundle `.maket` ;
- tests WS ;
- tests UI principaux ;
- `npm run quality`, incluant code-moniker.

Toute exception code-moniker doit être locale, explicite et justifiée au point de
violation.
