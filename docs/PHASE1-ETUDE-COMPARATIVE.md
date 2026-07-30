# Row Battle — Phase 1 : étude comparative des moteurs de pose estimation (navigateur)

**Date :** juillet 2026  
**Statut :** recherche avant développement (aucun code applicatif)  
**Critère n°1 du projet :** fluidité, faible latence, stabilité perçue, expérience utilisateur — **pas** la précision biomécanique.

---

## 1. Contexte d’évaluation

| Contrainte | Implication pour le choix du moteur |
|------------|-------------------------------------|
| 2 rameurs côte à côte, **filmés de face** | Mouvement surtout en profondeur (avant/arrière) ; signaux = variation d’échelle du torse, épaules, bras |
| iPad / Mac / PC, une URL Netlify | Inférence **100 % client** ; chargement initial des modèles + WASM/WebGL |
| Partie **90 s** continues | Pas de fuite mémoire, pas de dégradation thermique inacceptable ; viser **≥ 24 FPS** stables |
| Bras qui masquent le torse, bras hors champ | Ne pas dépendre d’un seul landmark ; fusion multi-signaux + lissage temporel |
| Gameplay via **événements** uniquement | Le moteur doit fournir des poses stables assez souvent ; la « vérité » est le rythme détecté, pas la pose |

**Référence de démo officielle (à tester sur votre matériel) :**  
[TensorFlow.js Pose Detection Demo](https://storage.googleapis.com/tfjs-models/demos/pose-detection/index.html?model=movenet)

---

## 2. Périmètre des solutions comparées

| Solution | Nature | Multi-personnes (officiel) | Points clés |
|----------|--------|----------------------------|-------------|
| **MediaPipe Pose Landmarker** (`@mediapipe/tasks-vision`) | BlazePose GHUM, pipeline Tasks API | `num_poses` > 1 exposé, mais modèle **single-person** par design | 33 landmarks 2D (+ 3D relatifs), lite / full / heavy |
| **BlazePose** (via `@tensorflow-models/pose-detection`) | Même famille de modèles, 2 runtimes | **1 personne** (detector-tracker) | Runtime MediaPipe WASM+GPU ou TF.js WebGL |
| **MoveNet Lightning** | TF Hub / TF.js | Single-pose ; recentre sur la personne la plus centrale | 17 keypoints, 192×192, latence minimale |
| **MoveNet Thunder** | TF Hub / TF.js | Idem single-pose | 256×256, plus précis, plus lent |
| **MoveNet MultiPose Lightning** | TF.js | **Jusqu’à 6 poses**, tracking bbox intégré | 17 keypoints, entrée 256×256 |
| **TensorFlow.js Pose Detection** | Façade unifiée | Agrège MoveNet, BlazePose, PoseNet | Point d’entrée npm recommandé pour MoveNet/BlazePose |
| **PoseNet** (legacy) | TF.js | Multi-pose (ancien) | Précision et vitesse inférieures à MoveNet ; **non recommandé** |
| **ONNX Runtime Web / modèles custom** | Générique | Variable | Intégration lourde, peu de gain pour un prototype jeu ; écarté pour la v1 |

*Note : « BlazePose » dans les docs Google désigne la famille de modèles ; « Pose Landmarker » est le produit Tasks API actuel.*

---

## 3. Grille comparative (benchmark argumenté)

Les chiffres FPS ci-dessous proviennent des **tableaux officiels** TensorFlow (blog MoveNet mai 2021, README `pose-detection`, fiche modèle MoveNet) et de la doc / retours d’usage MediaPipe Tasks (GPU vs CPU). Ce sont des **ordres de grandeur** : la cible réelle est **votre iPad posé devant les rameurs**. La Phase 2 devra confirmer sur ce matériel.

Légende : **●●●●** excellent · **●●●○** bon · **●●○○** moyen · **●○○○** faible / risqué

### 3.1 Synthèse par critère

| Critère | MediaPipe Pose Landmarker (lite) | BlazePose (TF.js runtime, lite) | BlazePose (MediaPipe runtime) | MoveNet Lightning | MoveNet Thunder | MoveNet MultiPose Lightning | PoseNet |
|---------|----------------------------------|-----------------------------------|-------------------------------|-------------------|-----------------|-----------------------------|---------|
| **Précision biomécanique** | ●●●● (33 pts) | ●●●● | ●●●● | ●●●○ | ●●●● | ●●●○ (≈ Lightning) | ●●○○ |
| **Rapidité / latence (Mac WebGL)** | ●●●● (GPU Tasks) | ●●●○ | ●●●● | ●●●● (104 FPS ref.) | ●●●○ (77) | ●●●● (54) | ●●○○ |
| **Rapidité iPhone 12 (WebGL)** | À valider (Tasks GPU) | ●●●○ (34 lite) | ●○○○ (N/A iPhone ref.) | ●●●● (51) | ●●●○ (43) | ●●●○ (24) | ●●○○ |
| **Poids modèle** | ~5,8 Mo (lite.task) + WASM | ~similaire TF.js | + ~1 Mo vs TF.js | Très léger | Plus lourd | Léger (1 passe multi) | Léger |
| **Temps de chargement** | WASM + modèle : **2–8 s** (réseau) | TF.js + modèles | WASM MediaPipe | TF.js bundle + hub | Idem | Idem | Idem |
| **Safari iPad** | **GPU delegate** souvent bon ; worker recommandé | TF.js runtime **mieux que** runtime MediaPipe sur iPhone (blog Google) | Runtime MP **faible sur iOS** (9–6 FPS ref. GHUM) | Bon candidat ; surveiller backend WebGL | Plus lent | 24 FPS ref. iPhone 12 | Risqué |
| **Chrome desktop / Android** | ●●●● | ●●●● | ●●●● | ●●●● | ●●●○ | ●●●● | ●●○○ |
| **Facilité d’intégration** | API Tasks claire ; pin de version | Via `pose-detection` | Config runtime + WASM paths | **Très simple** via `pose-detection` | Idem | + tracking bbox | Ancienne API |
| **Multi-personnes (2 joueurs)** | **●○○○** (hors scope modèle ; swaps d’ID) | ●○○○ | ●○○○ | ●○○○ (1 pers. centrée) | ●○○○ | **●●●●** (jusqu’à 6) | ●●○○ instable |
| **Occlusion partielle (bras)** | ●●●○ | ●●●○ | ●●●○ | ●●●○ (entraîné fitness) | ●●●○ | ●●●○ | ●●○○ |
| **Avance / recul (profondeur)** | Échelle 2D des landmarks | Idem | Idem | Idem ; bon pour amplitude | Idem, un peu plus stable | Idem | Idem |
| **100 % navigateur** | ●●●● | ●●●● | ●●●● | ●●●● | ●●●● | ●●●● | ●●●● |

### 3.2 Détail par solution

#### MediaPipe Pose Landmarker (BlazePose GHUM, Tasks API)

- **Précision :** 33 landmarks, segmentation optionnelle ; excellent pour bras/coudes/poignets.
- **Vitesse :** avec `delegate: "GPU"`, retours terrain **60+ FPS** possibles sur Mac (intégré) ; sans GPU, retombée CPU **10–15 FPS** (inacceptable pour Row Battle).
- **Poids :** lite ~5,8 Mo ; full ~9,4 Mo ; + runtime WASM `@mediapipe/tasks-vision`.
- **Multi-joueurs :** le paramètre `num_poses` existe, mais la [fiche modèle BlazePose GHUM](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf) indique explicitement que **plusieurs personnes sur une image sont hors périmètre**. En pratique : détection intermittente du 2ᵉ joueur, **permuations d’identité** entre gauche et droite — inacceptable pour un score par joueur.
- **Safari iPad :** Tasks Vision + GPU est la voie moderne ; inférence dans un **Web Worker** fortement recommandée ([guide Google](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js)).
- **Verdict Row Battle :** excellent moteur **mono-ROI** (une personne par crop), **mauvais choix en une seule passe multi-personnes**.

#### BlazePose (package `pose-detection`, historique)

- Deux runtimes : **MediaPipe** (rapide desktop/Android, **pas** iPhone dans les benchmarks GHUM) vs **TF.js WebGL** (souvent **meilleur sur iPhone/iPad** selon le blog TensorFlow août 2021).
- Même limite **une personne** par flux (tracker sur crop).
- **Verdict :** redondant avec Pose Landmarker pour une nouvelle codebase ; utile seulement si vous restez déjà sur `pose-detection` pour MoveNet.

#### MoveNet Lightning (SinglePose)

- **17 keypoints** : nez, yeux, oreilles, épaules, coudes, poignets, hanches, genoux, chevilles — **suffisants** pour rythme d’aviron de face (épaules, coudes, poignets, distance tête–torse proxy via nez/épaules).
- Entraîné pour **mouvements fitness rapides** et flou ([fiche modèle](https://storage.googleapis.com/movenet/MoveNet.SinglePose%20Model%20Card.pdf)).
- **~51 FPS** iPhone 12 WebGL (réf. officielle) ; **~104 FPS** MacBook Pro 2019.
- **Limite :** ignore les personnes non centrales → pour 2 joueurs, il faut **découper la scène** (ROI gauche / ROI droite) ou utiliser MultiPose.

#### MoveNet Thunder (SinglePose)

- Meilleure précision, **~43 FPS** iPhone 12 vs 51 Lightning ; utile si Lightning trop bruité — **coût latence** pour un jeu rythmique. Réserve pour A/B sur device, pas choix par défaut.

#### MoveNet MultiPose Lightning

- **Jusqu’à 6 personnes** ; vitesse d’inférence **indépendante du nombre de personnes** (doc TF.js).
- **~24 FPS** iPhone 12 WebGL (réf.) ; **~54 FPS** MacBook Pro 2019 — largement suffisant pour 90 s à 24–30 FPS effectifs après lissage.
- Tracking par **bounding box** (`enableTracking`) pour stabiliser les IDs entre images — à **compléter** par une règle métier « joueur gauche / joueur droit » (centroïde X) car les swaps restent possibles si les corps se croisent peu (peu probable sur rameurs côte à côte).
- **Verdict :** seule option **une inférence / frame** nativement multi-joueurs dans l’écosystème TF.js recommandé.

#### TensorFlow.js Pose Detection (façade)

- N’est pas un modèle distinct : **couche d’intégration** pour MoveNet et BlazePose.
- Backends : WebGL (défaut performant), WASM, WebGPU (Chrome récent ; Safari iPadOS 26+).
- **Risque Safari :** historique de blocages WebGL ([issues TF.js](https://github.com/tensorflow/tfjs/issues/7399)) ; stratégie de repli **backend CPU sur iOS** si détection de hang au boot (à implémenter en Phase 2).

#### PoseNet

- Dépassé par MoveNet sur vitesse et robustesse fitness ; **non retenu**.

#### Autres (mention)

- **Vision Framework (Apple)** : natif iOS uniquement, pas web.
- **cloud APIs** : exclues par le cahier des charges.

---

## 4. Scénarios d’architecture vision (2 joueurs)

Deux patterns réalistes pour Row Battle :

| Pattern | Description | Avantages | Inconvénients |
|---------|-------------|-----------|---------------|
| **A — MultiPose une passe** | `MULTIPOSE_LIGHTNING` + assignation gauche/droite par position X | Code simple, 1 modèle, 1 worker | ~24 FPS iPad ref. ; swaps d’ID rares mais possibles |
| **B — Dual ROI SinglePose** | Deux crops (~45 % largeur chacun) + 2× `SINGLEPOSE_LIGHTNING` (workers parallèles) | **Identité fixe** gauche/droite = aligné UI ; meilleure précision par joueur | Contention GPU ; 2× chargement modèle si mal factorisé ; tuning crop |
| **C — Dual Pose Landmarker lite** | Comme B avec `@mediapipe/tasks-vision` | 33 landmarks, GPU MediaPipe sur Mac | 2× inférence ; multi-personnes non supportée par modèle mais **OK en mono-ROI** |

**Recommandation produit :** démarrer en **B (Dual ROI MoveNet Lightning)** pour la stabilité identité + fluidité sur Mac ; **repli A (MultiPose)** si l’iPad ne tient pas deux inférences GPU en parallèle après mesure.

---

## 5. Choix unique retenu

### **MoveNet SinglePose Lightning** (TensorFlow.js `@tensorflow-models/pose-detection`), déployé en **double ROI parallèle** (joueur gauche / joueur droit)

**Plan de repli documenté :** MoveNet **MultiPose Lightning** (une passe) si le parallélisme dual-ROI échoue sur l’iPad cible.

### Justification par rapport au critère n°1 (fluidité, fun, latence)

1. **Latence :** Lightning est le variant le plus rapide de l’écosystème ; sur iPhone 12, **~51 FPS** en single-pose (réf. Google) vs **~24 FPS** en MultiPose — la double ROI parallèle vise à rester **au-dessus de 30 FPS effectifs** sur Mac et **≥ 24 FPS** sur iPad, ce qui permet feedback visuel/sonore **synchrone** avec le coup de rame perçu.

2. **Stabilité identité = stabilité score :** un swap J1/J2 détruit la confiance (« injuste »). Les deux colonnes physiques et l’UI imposent une **correspondance spatiale fixe** ; le dual-ROI évite le problème structurel de BlazePose/Pose Landmarker multi-`num_poses`.

3. **Robustesse mouvement fitness :** MoveNet est explicitement tuné pour **mouvements rapides / flou** — plus proche d’un arcade que BlazePose « pose yoga ».

4. **Simplicité opérationnelle :** une seule stack npm (`@tensorflow/tfjs`, `@tensorflow-models/pose-detection`), hébergement statique Netlify, pas de WASM MediaPipe supplémentaire à versionner (réduction des risques de régression Safari).

5. **Précision volontairement secondaire :** 17 points suffisent pour les signaux composites (épaules, coudes, poignets, amplitude torse) ; la couche **détection d’événements** appliquera filtrage One Euro / fenêtre médiane / calibration 5 s — le gameplay ne lit jamais le squelette brut.

6. **Pourquoi pas MediaPipe Pose Landmarker en choix principal ?** Meilleur sur le papier (33 pts), mais **multi-joueurs sur une frame non fiable** ; en dual-ROI il devient concurrent de MoveNet — à benchmarker sur iPad en Phase 2 comme **optimisation optionnelle**, pas comme pari initial du prototype démo.

7. **Pourquoi pas Thunder ?** Gain de précision marginal pour la détection de **cycles** ; coût direct sur la sensation de réactivité.

---

## 6. Validation technique (avant code)

| Question | Réponse |
|----------|---------|
| **Toute l’IA dans le navigateur ?** | **Oui.** MoveNet s’exécute en TF.js (WebGL/WASM/WebGPU) ; la vidéo ne quitte pas l’appareil si vous ne l’envoyez pas à un serveur. |
| **Déploiement Netlify simple ?** | **Oui.** Site statique (Vite/React/vanilla) ; modèles depuis CDN TF Hub ou assets dans `/public` ; `netlify.toml` pour headers cache et COOP/COEP si WASM multithread. |
| **Backend nécessaire ?** | **Non** pour le prototype : pas de WebSocket, pas de DB, pas de matchmaking serveur. (Multijoueur local = 2 joueurs, 1 caméra, 1 écran.) |
| **Safari iPad supporte-t-il l’approche ?** | **Oui, avec réserves.** `getUserMedia` caméra frontale : supporté ; permission **à chaque chargement** sur iOS. TF.js WebGL : généralement OK sur iOS récents ; prévoir **détection de backend** et repli WASM/CPU si gel au démarrage. iPadOS 26+ : WebGPU possible pour TF.js à terme. MediaPipe Tasks GPU : alternative si tests dual-ROI MoveNet insuffisants. |
| **Caméra frontale suffisante ?** | **Oui** pour le setup décrit (tablette face aux rameurs). Résolution 720p@30 suffit ; éviter 4K. `facingMode: 'user'` ; champ large pour deux corps. Éclairage homogène recommandé (confort visuel + contrastes landmarks). |
| **Performances sur 90 secondes ?** | **Oui, attendu**, si FPS stables et pas de fuite (détecteur créé une fois, pas de `createDetector` par frame). Surveiller chauffe iPad : si throttling, réduire résolution d’inférence (192) et sauter 1 frame sur 2 **côté vision uniquement** sans bloquer le gameplay (horloge jeu indépendante). |

### Risques résiduels (à traiter en Phase 2)

| Risque | Mitigation |
|--------|------------|
| WebGL qui freeze sur certaines versions iOS | Timeout boot + bascule backend ; écran « navigateur non supporté » clair |
| Bras hors champ | Signaux multi-landmarks + seuils calibrés ; ignorer landmarks sous `minPartConfidence` |
| Mouvement en profondeur | Calibration amplitude sur 5 s ; features normalisées par largeur d’épaules |
| Latence audio/visuel | Effets déclenchés sur **événements** lissés, pas sur frame brute |

---

## 7. Implications pour la détection de rythme (sans coder)

Signaux recommandés (fusion, pas un seul point) :

- Distance **nez ↔ milieu épaules** (proxy avancée du buste)
- **Largeur épaules** (échelle / profondeur)
- Hauteur relative **poignets** et **angle coude** (bras)
- Vitesse du **centre du torse** (moyenne épaules/hanches)
- **Filtrage :** One Euro ou EMA sur chaque feature ; détection de pic / passage de phase pour `StrokeDetected`
- **Calibration 5 s :** min/max amplitude, période médiane, seuils dynamiques

---

## 8. Prochaines étapes (Phase 2)

1. Benchmark sur **iPad réel** : dual-ROI Lightning vs MultiPose vs (option) dual Pose Landmarker lite.  
2. Implémenter la stack **Vision → Événements → Gameplay** décrite dans `ARCHITECTURE-TECHNIQUE.md`.  
3. Prototype Netlify jouable en < 30 s après ouverture URL (chargement modèle en arrière-plan + écran « Prêt »).

---

## 9. Sources

- [MoveNet + TF.js (blog TensorFlow, 2021)](https://blog.tensorflow.org/2021/05/next-generation-pose-detection-with-movenet-and-tensorflowjs.html)
- [README MoveNet — tfjs-models](https://github.com/tensorflow/tfjs-models/blob/master/pose-detection/src/movenet/README.md)
- [MoveNet SinglePose Model Card (PDF)](https://storage.googleapis.com/movenet/MoveNet.SinglePose%20Model%20Card.pdf)
- [BlazePose GHUM — TF.js blog (2021)](https://blog.tensorflow.org/2021/08/3d-pose-detection-with-mediapipe-blazepose-ghum-tfjs.html)
- [Pose Landmarker Web — Google AI Edge](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js)
- [BlazePose GHUM Model Card — multi-person out of scope](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf)
- [Démo pose-detection TF.js](https://storage.googleapis.com/tfjs-models/demos/pose-detection/index.html?model=movenet)
