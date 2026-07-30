# Row Battle

Prototype de jeu navigateur : deux rameurs, une caméra frontale, aucun capteur — la détection du rythme repose sur la vision par ordinateur côté client.

## Phase 1 (actuelle) — Recherche

Avant tout développement applicatif, la documentation suivante est disponible :

| Document | Contenu |
|----------|---------|
| [docs/PHASE1-ETUDE-COMPARATIVE.md](docs/PHASE1-ETUDE-COMPARATIVE.md) | Benchmark argumenté des moteurs de pose (MediaPipe, BlazePose, MoveNet, etc.), validation technique, **choix recommandé** |
| [docs/ARCHITECTURE-TECHNIQUE.md](docs/ARCHITECTURE-TECHNIQUE.md) | Architecture Vision → Événements → Gameplay, déploiement Netlify sans backend |

### Recommandation (résumé)

**MoveNet SinglePose Lightning** (TensorFlow.js) en **double ROI** (joueur gauche / joueur droit), avec repli **MoveNet MultiPose Lightning** si l’iPad ne tient pas deux inférences en parallèle.

Critère prioritaire : **fluidité, latence faible, stabilité perçue** — pas la précision biomécanique.

## Phase 2 (à venir)

Prototype jouable déployé sur Netlify (URL unique, iPad / Mac / PC).
