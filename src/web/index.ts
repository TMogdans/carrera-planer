/**
 * Einstieg der Browser-Oberfläche (Spec M2, Abschnitt „Smoke“): index.html → ui → editor → Kern.
 */
import { mount } from "./ui/app.js";

const root = document.getElementById("app");
if (root !== null) mount(root);
