# Row Battle

Jeu navigateur : deux rameurs, une caméra frontale, détection du rythme par **MoveNet** (TensorFlow.js) — 100 % côté client.

## Jouer en local

```bash
npm install
npm run dev
```

Ouvrir l’URL affichée (HTTPS requis en production pour la caméra). Utilisez **Chrome** ou **Safari** sur iPad / Mac / PC.

## Déploiement Netlify

- Build : `npm run build`
- Publish directory : `dist`
- Fichier `netlify.toml` inclus

## Architecture

| Couche | Dossier |
|--------|---------|
| Vision (caméra, dual-ROI MoveNet) | `src/vision/` |
| Événements (rythme, calibration 5 s) | `src/events/` |
| Gameplay (90 s, score, combo) | `src/game/` |
| UI + particules + audio | `src/ui/`, `src/audio/` |

Documentation : [`docs/ARCHITECTURE-TECHNIQUE.md`](docs/ARCHITECTURE-TECHNIQUE.md), [`docs/PHASE1-ETUDE-COMPARATIVE.md`](docs/PHASE1-ETUDE-COMPARATIVE.md).

## Règles (résumé)

- **90 secondes**, 2 joueurs (gauche / droite dans le champ caméra).
- Score basé sur régularité et **combo** (×1 → ×10).
- Rythme irrégulier : combo à zéro.
- Calibration automatique **5 s** au début de chaque partie.
