const footerEl = document.querySelector(".app__footer");

const FALLBACK_VERSION = "0.1.21";
const APP_VERSION =
  new URL(import.meta.url).searchParams.get("v") || window.APP_VERSION || FALLBACK_VERSION;

const appUrl = new URL("./app/main_app.js", import.meta.url);
appUrl.searchParams.set("v", APP_VERSION);

import(appUrl.href).catch((error) => {
  console.error("Failed to load app module:", error);
  if (footerEl) {
    footerEl.textContent = `App load error: ${error?.message || String(error)}`;
  }
});
