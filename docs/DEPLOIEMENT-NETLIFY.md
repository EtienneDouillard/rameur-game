# Déploiement automatique sur Netlify (GitHub)

Objectif : **à chaque `git push` sur GitHub**, Netlify reconstruit et publie le site sans action manuelle.

Le fichier [`netlify.toml`](../netlify.toml) à la racine du dépôt définit déjà :

- commande de build : `npm run build`
- dossier publié : `dist`
- Node.js 20

---

## Configuration en une fois (recommandé)

### 1. Compte Netlify

1. Allez sur [https://app.netlify.com](https://app.netlify.com) et connectez-vous (ou créez un compte).
2. Autorisez Netlify à accéder à **GitHub** quand on vous le demande.

### 2. Importer le dépôt

1. **Add new site** → **Import an existing project**.
2. **GitHub** → choisir le dépôt **`EtienneDouillard/rameur-game`** (ou votre fork).
3. Netlify détecte en général `netlify.toml` automatiquement. Vérifiez :

   | Champ | Valeur |
   |--------|--------|
   | Branch to deploy | `main` |
   | Build command | `npm run build` |
   | Publish directory | `dist` |

4. Cliquez **Deploy site**.

### 3. Déploiement automatique activé

Dès que le site est lié au dépôt :

- **Push sur `main`** → nouveau build + mise en ligne de la prod.
- **Pull request** → Netlify peut créer une **preview URL** (option « Deploy previews » dans *Site configuration → Build & deploy → Continuous deployment*).

Vous n’avez **pas** besoin de GitHub Actions pour ce flux : c’est Netlify qui écoute GitHub.

### 4. Vérifier que l’auto-deploy est bien ON

Dans Netlify :

**Site configuration** → **Build & deploy** → **Continuous deployment**

- **Build settings** : branch de production = `main`
- **Deploy contexts** : *Production branch* = builds sur `main`

---

## Workflow au quotidien

```bash
# Après vos modifications locales
git add .
git commit -m "feat: ma modification"
git push origin main
```

1. Ouvrez l’onglet **Deploys** sur Netlify : un nouveau déploiement apparaît en quelques secondes.
2. Attendez la fin du build (souvent 1–3 min, à cause du téléchargement des deps et du bundle TF.js).
3. L’URL du site (ex. `https://something.netlify.app`) sert la nouvelle version.

---

## HTTPS et caméra

Netlify fournit **HTTPS** par défaut — nécessaire pour `getUserMedia` (caméra) en production.

---

## Dépannage

| Problème | Piste |
|----------|--------|
| Pas de deploy après un push | Le site est-il bien lié au bon repo / branche `main` ? |
| Build failed | Ouvrir le log du deploy ; souvent `npm ci` / version Node → `NODE_VERSION=20` dans `netlify.toml` |
| Ancienne version en cache | Hard refresh (Ctrl+Shift+R) ou navigation privée |
| Repo privé | Compte Netlify gratuit : builds OK sur repo privé GitHub (selon offre Netlify actuelle) |

---

## Déploiement manuel (secours)

Sans Git, depuis votre machine :

```bash
npm install
npm run build
npx netlify-cli deploy --prod --dir=dist
```

(Nécessite `netlify login` et un site déjà créé.)

---

## Résumé

| Question | Réponse |
|----------|---------|
| Faut-il un serveur ? | Non, site statique dans `dist/` |
| Auto-deploy ? | Oui, après liaison **GitHub ↔ Netlify** une seule fois |
| Quelle branche ? | `main` (recommandé) |
| Fichier de config | `netlify.toml` à la racine |
