// Before the first paint: public/index.html loads this classic script in its
// <head>, so it runs before the body is drawn (a few lines; the CSP allows no
// inline script). It sets three classes on <html> that landing/landing.css reads:
// - js: scripts run, so the forms and the language buttons show and their
//   plain fallbacks hide;
// - in-app: the app instead of the landing, when the prudence_in cookie says
//   someone signed in on this browser (src/auth.js sets it beside the session
//   cookie and clears it at sign-out) or the address is a #/ route (#/demo,
//   #/guardian?accepted=1, any deep link); js/main.js confirms with /api/status;
// - l-fr: the landing in French, from the language the app keeps (ss_lang) or
//   the browser's, so a French visitor never sees the English first.
(function () {
  var c = document.documentElement.classList;
  c.add("js");
  try {
    if (/(?:^|;\s*)prudence_in=1(?:;|$)/.test(document.cookie) || location.hash.indexOf("#/") === 0) c.add("in-app");
    var saved = null;
    try { saved = localStorage.getItem("ss_lang"); } catch (e) { /* private mode: the browser's language */ }
    if (String(saved || navigator.language || "").toLowerCase().indexOf("fr") === 0) c.add("l-fr");
  } catch (e) { /* the landing shows, in English */ }
})();
