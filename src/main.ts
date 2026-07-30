import "./styles.css";
import { App } from "./ui/app";

const root = document.querySelector<HTMLElement>("#app");
const video = document.querySelector<HTMLVideoElement>("#cam");

if (!root || !video) {
  throw new Error("Éléments racine manquants");
}

const app = new App(root, video);

window.addEventListener("beforeunload", () => app.destroy());
