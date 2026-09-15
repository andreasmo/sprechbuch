import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";
import { injectMarkerCss } from "./lib/markers";
import { registerServiceWorker } from "./lib/pwa.svelte";

injectMarkerCss();
registerServiceWorker();

export default mount(App, { target: document.getElementById("app")! });
