/* Gewähltes Design vor dem ersten Zeichnen setzen, damit nichts aufflackert.
   Eigene Datei statt Inline-Skript, damit die Content-Security-Policy ohne 'unsafe-inline' auskommt. */
document.documentElement.classList.add("js");
try { var d = localStorage.getItem("fathom.design"); if (d === "hell" || d === "dunkel") document.documentElement.dataset.theme = d === "hell" ? "light" : "dark"; } catch (e) {}
