# Row Battle

Jeu navigateur : deux rameurs, une caméra frontale, détection du rythme par **MoveNet** (TensorFlow.js) — 100 % côté client.

## Jouer en local

```bash
npm install
npm run dev
```

Ouvrir l’URL affichée (HTTPS requis en production pour la caméra). Utilisez **Chrome** ou **Safari** sur iPad / Mac / PC.

## Déploiement Netlify (automatique)

1. **Une seule fois** : [Netlify](https://app.netlify.com) → *Import from Git* → repo `rameur-game` → branche **`main`**.
2. Netlify lit [`netlify.toml`](netlify.toml) (`npm run build` → `dist`).
3. **Ensuite** : chaque `git push origin main` redéploie le site tout seul.

Guide détaillé : **[docs/DEPLOIEMENT-NETLIFY.md](docs/DEPLOIEMENT-NETLIFY.md)**.

## Architecture

| Couche | Dossier |
|--------|---------|
| Vision (caméra, dual-ROI MoveNet) | `src/vision/` |
| Événements (rythme, calibration 10 coups) | `src/events/` |
| Gameplay (90 s, score, combo) | `src/game/` |
| UI + particules + audio | `src/ui/`, `src/audio/` |

Documentation : [`docs/ARCHITECTURE-TECHNIQUE.md`](docs/ARCHITECTURE-TECHNIQUE.md), [`docs/PHASE1-ETUDE-COMPARATIVE.md`](docs/PHASE1-ETUDE-COMPARATIVE.md).

## Règles (résumé)

README.md
- Score basé sur régularité et **combo** (×1 → ×10).
- Rythme irrégulier : combo à zéro.
- Calibration automatique (**15 s** de préparation puis **10 coups**, puis **3-2-1 EN MER**) au début de chaque partie.
