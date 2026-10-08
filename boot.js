"use strict";
// Runs in <head> before the first paint: sets the color theme and light/dark so the page never flashes the wrong one.
// scheme: "auto" (follow the phone) | "light" | "dark", kept in localStorage like the theme.
(function () {
  const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const root = document.documentElement;
  const mq = window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : null;
  window.applyScheme = function (pref) {
    pref = pref || get("scheme") || "auto";
    const dark = pref === "dark" || (pref === "auto" && !!mq && mq.matches);
    root.dataset.scheme = dark ? "dark" : "light";
    root.dataset.schemePref = pref;
  };
  let theme = get("theme");
  if (theme === "sunset") theme = "rose";
  root.dataset.theme = ["ocean", "rose", "forest", "graphite"].includes(theme) ? theme : "ocean";
  window.applyScheme();
  if (mq) {
    const follow = () => { if ((get("scheme") || "auto") === "auto") window.applyScheme("auto"); };
    if (mq.addEventListener) mq.addEventListener("change", follow); else if (mq.addListener) mq.addListener(follow);
  }
})();
