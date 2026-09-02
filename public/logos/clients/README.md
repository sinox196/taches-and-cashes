# Logos des clients

Les fichiers déposés ici sont servis sur `/logos/clients/<nom-du-fichier>`,
comme les logos CNSS / ANETI / TEJ de `public/logos/`.

Pour qu'un logo apparaisse dans le bandeau « Ils nous font confiance » de la
page d'accueil, renseigner son `name` et son `src` dans `CLIENT_LOGOS`
([src/components/landing/ClientLogos.tsx](../../../src/components/landing/ClientLogos.tsx)) :

```ts
{ name: 'Cabinet Untel', src: '/logos/clients/cabinet-untel.png' },
```

Format : PNG ou SVG à fond transparent, hauteur utile ~80 px (le bandeau les
ramène à 44 px de haut). Une entrée sans `src` — ou dont le fichier est
introuvable — s'affiche en emplacement vide, pas en image cassée.

N'y mettre que des clients qui ont donné leur accord : afficher le logo d'une
entreprise qui n'est pas cliente lui fait dire qu'elle vous recommande.
