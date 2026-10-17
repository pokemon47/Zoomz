// Applies the saved theme before first paint (an external file, so the page CSP needs no
// inline scripts). Keep in sync with src/lib/theme.ts.
(function () {
  var pref = "system"
  try {
    pref = localStorage.getItem("zoomz.theme") || "system"
  } catch (e) {}
  var dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
  var root = document.documentElement
  if (pref === "system") root.removeAttribute("data-theme")
  else root.setAttribute("data-theme", pref)
  root.classList.toggle("dark", dark)
  root.classList.toggle("light", !dark)
  root.style.colorScheme = dark ? "dark" : "light"
})()
