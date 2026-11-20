# Démo — Administration La Tortue

Démonstration de l'interface d'administration que j'ai développée pour **La Tortue** (location de camping-car) : tableau de bord, liste des locations et calendrier avec gestion à la demi-journée.

**Toutes les données sont fictives** (noms, emails en `@example.com`, numéros de la plage réservée à la fiction). Il n'y a aucun serveur : le vrai back-end (Express + SQLite) est remplacé par `site/mock-api.js`, qui tourne dans le navigateur et enregistre les modifications dans le `localStorage`. Le bouton « Réinitialiser » du bandeau remet la démo à zéro.

- Connexion : identifiant `demo`, mot de passe `demo` (déjà pré-remplis).
- Les règles métier du vrai projet sont reprises : validation des saisies, chevauchements refusés à la demi-journée près, restant dû, statistiques.

## Lancer en local

```bash
npm start      # http://localhost:4173
npm test       # tests du faux back-end
```

Node 20 ou plus, aucune dépendance.

## Organisation

```
site/
  index.html     page de l'interface
  admin.js       interface (JS sans build)
  admin.css      styles
  mock-api.js    faux back-end + données fictives
test/            tests du faux back-end
```

Projet réalisé avec l'accord du client.
