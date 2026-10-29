// Text a reader never sees in an HTML email, which a model reading the mail
// could still obey: hidden by style (display:none, visibility:hidden, opacity
// 0, a 0 or 1 px font, zero height or width with overflow hidden), coloured
// like its background (white on white, transparent), pushed off-screen
// (far negative offsets, text-indent, clip), the hidden attribute, HTML
// comments, the <title> and picture descriptions (alt). Inline styles, the
// old <font color> and bgcolor attributes and simple class rules in <style>
// blocks are read; full CSS selectors and media queries are not.
// Only the injection checks read it (Prompt Guard 2 and the rules' orders to
// the checker): the visible text that the senior and every other check see
// stays as it was, since hidden preheaders are normal in newsletters.

export const HIDDEN_MAX = 3000;
const HTML_MAX = 400000;
const MAX_DEPTH = 256; // unclosed tags in broken mail cannot make the walk slow
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
// A hidden run of text ends where a block ends, as the visible text does.
const BLOCK = new Set(["address", "article", "blockquote", "br", "center", "dd", "div", "dl", "dt", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "ol", "p", "pre", "section", "table", "td", "th", "tr", "ul"]);
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", eacute: "é", egrave: "è", agrave: "à", ccedil: "ç", ecirc: "ê", euro: "€",
  rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", hellip: "…", mdash: "—", ndash: "–", zwnj: "", zwj: "", shy: "" };
const decode = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === "#") {
    const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  }
  return ENTITIES[e.toLowerCase()] ?? m;
});
// Zero-width and invisible fillers (preheaders pad with them).
const INVISIBLE = /[​-‏⁠﻿͏­]/g;

const NAMED = { white: [255, 255, 255], black: [0, 0, 0], red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255], gray: [128, 128, 128],
  grey: [128, 128, 128], silver: [192, 192, 192], whitesmoke: [245, 245, 245], snow: [255, 250, 250], ivory: [255, 255, 240],
  ghostwhite: [248, 248, 255], floralwhite: [255, 250, 240], azure: [240, 255, 255], aliceblue: [240, 248, 255], mintcream: [245, 255, 250] };

// [r, g, b], "transparent", or null when the value is not a colour we read.
export function parseColor(value) {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v) return null;
  if (v === "transparent") return "transparent";
  if (NAMED[v]) return NAMED[v];
  let m = v.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) {
      const [r, g, b, a] = [...h].map((c) => parseInt(c + c, 16));
      return a === 0 ? "transparent" : [r, g, b];
    }
    if (h.length === 6 || h.length === 8) {
      const n = (i) => parseInt(h.slice(i, i + 2), 16);
      return h.length === 8 && n(6) === 0 ? "transparent" : [n(0), n(2), n(4)];
    }
    return null;
  }
  m = v.match(/^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    const ch = (x) => Math.round(x.endsWith("%") ? parseFloat(x) * 2.55 : parseFloat(x));
    const alpha = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return alpha === 0 ? "transparent" : [ch(m[1]), ch(m[2]), ch(m[3])];
  }
  return null;
}

// Text in its background's colour (within a few shades: #fffffe on white).
const sameColor = (color, bg) => color === "transparent"
  || (Array.isArray(color) && Array.isArray(bg) && color.every((c, i) => Math.abs(c - bg[i]) <= 16));

function declarations(style = "") {
  const out = Object.create(null);
  for (const part of decode(style).split(";")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    const prop = part.slice(0, i).trim().toLowerCase();
    if (prop) out[prop] = part.slice(i + 1).trim().toLowerCase().replace(/\s*!important\s*$/, "");
  }
  return out;
}

function attributes(source = "") {
  const out = Object.create(null);
  for (const m of String(source).matchAll(/([^\s=/"'>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g)) {
    const key = m[1].toLowerCase();
    if (!(key in out)) out[key] = m[2] === undefined ? "" : decode(m[2].replace(/^["']|["']$/g, ""));
  }
  return out;
}

const len = (v) => {
  const m = String(v ?? "").trim().match(/^(-?[\d.]+)\s*(px|pt|em|rem|%|vw|vh)?/);
  return m && Number.isFinite(parseFloat(m[1])) ? { n: parseFloat(m[1]), unit: m[2] || "px" } : null;
};
const isZero = (v) => len(v)?.n === 0;
// Far enough to leave any screen: -500 px (or -50 em) and beyond, or +5000 px.
const offScreen = (v) => {
  const l = len(v);
  if (!l) return false;
  const px = /^(em|rem)$/.test(l.unit) ? l.n * 16 : l.n;
  return px <= -500 || px >= 5000;
};

// Does this element's own style or attributes hide what it contains?
function hides(d, attrs) {
  if ("hidden" in attrs) return true;
  if (d.display === "none" || d["mso-hide"] === "all") return true;
  if (/^(hidden|collapse)$/.test(d.visibility || "")) return true;
  if (d.opacity !== undefined && parseFloat(d.opacity) === 0) return true;
  const font = len(d["font-size"]);
  if (font && (font.n <= 0 || (/^(px|pt)$/.test(font.unit) && font.n <= 1) || (/^(em|rem)$/.test(font.unit) && font.n <= 0.1) || (font.unit === "%" && font.n <= 10))) return true;
  const clipped = [d.overflow, d["overflow-x"], d["overflow-y"]].some((v) => /hidden|clip/.test(v || ""));
  if (clipped && ["max-height", "height", "max-width", "width"].some((k) => isZero(d[k]))) return true;
  const positioned = /^(absolute|fixed)$/.test(d.position || "");
  if (positioned && ["left", "top", "right", "bottom"].some((k) => offScreen(d[k]))) return true;
  if (["text-indent", "margin-left", "margin-top"].some((k) => offScreen(d[k]))) return true;
  if (positioned && /rect\(\s*(0|1px)[\s,]+(0|1px)[\s,]+(0|1px)[\s,]+(0|1px)\s*\)/.test(d.clip || "")) return true;
  if (/inset\(\s*(50|100)%|circle\(\s*0/.test(d["clip-path"] || "")) return true;
  if (/scale[xy]?\(\s*0(\.0*)?\s*[,)]/.test(d.transform || "")) return true;
  return false;
}

// The first real colour in a background, a background-color or a bgcolor.
function backgroundOf(d, attrs) {
  const shorthand = String(d.background || "").replace(/\([^)]*\)/g, (m) => m.replace(/\s+/g, "")).split(/\s+/);
  for (const v of [d["background-color"], ...shorthand, attrs.bgcolor]) {
    const c = parseColor(v);
    if (Array.isArray(c)) return c;
  }
  return null;
}

// <tag>…</tag> blocks out of the source, each content to fn, in one forward
// pass (a block that never closes ends the pass).
function cutBlocks(src, tag, fn) {
  const opening = new RegExp(`<${tag}(?![\\w:-])`, "gi");
  const closing = new RegExp(`</${tag}(?![\\w:-])`, "gi");
  let out = "";
  let i = 0;
  for (;;) {
    opening.lastIndex = i;
    const start = opening.exec(src)?.index ?? -1;
    const open = start < 0 ? -1 : src.indexOf(">", start);
    if (open < 0) break;
    closing.lastIndex = open;
    const close = closing.exec(src)?.index ?? -1;
    if (close < 0) break;
    const end = src.indexOf(">", close);
    fn?.(src.slice(open + 1, close));
    out += `${src.slice(i, start)} `;
    i = end < 0 ? src.length : end + 1;
  }
  return out + src.slice(i);
}

const tidy = (s) => decode(String(s).replace(/<[^<>]*>/g, " ")).replace(INVISIBLE, "").replace(/\s+/g, " ").trim();

export function hiddenTextFromHtml(html = "") {
  let src = String(html || "").slice(0, HTML_MAX);
  if (!src.includes("<")) return "";
  const pieces = [];
  const hiddenClasses = new Set();
  src = cutBlocks(src, "style", (css) => {
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!hides(declarations(rule[2]), Object.create(null))) continue;
      for (const selector of rule[1].split(",")) {
        const cls = selector.trim().match(/^[a-z0-9]*\.([\w-]+)$/i);
        if (cls) hiddenClasses.add(cls[1].toLowerCase());
      }
    }
  });
  src = cutBlocks(src, "script");
  src = cutBlocks(src, "title", (title) => pieces.push(title));

  const stack = [{ tag: "", hidden: false, color: [0, 0, 0], bg: [255, 255, 255] }];
  let run = "";
  const flush = () => { if (run.trim()) pieces.push(run); run = ""; };
  for (const m of src.matchAll(/<!--([\s\S]*?)(?:-->|$)|<(\/?)([a-zA-Z][\w:-]*)((?:[^<>"']|"[^"<>]*"|'[^'<>]*')*)>|([^<]+)|</g)) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) { flush(); pieces.push(m[1]); continue; }
    if (m[3]) {
      const tag = m[3].toLowerCase();
      if (BLOCK.has(tag)) flush();
      if (m[2]) {
        let at = stack.length - 1;
        while (at > 0 && stack[at].tag !== tag) at--;
        if (at > 0) stack.length = at;
        continue;
      }
      const attrs = attributes(m[4]);
      if (attrs.alt && /^(img|area|input)$/.test(tag)) { flush(); pieces.push(attrs.alt); }
      if (VOID.has(tag) || /\/\s*$/.test(m[4]) || stack.length > MAX_DEPTH) continue;
      const d = declarations(attrs.style);
      const classes = String(attrs.class || "").toLowerCase().split(/\s+/).filter(Boolean);
      stack.push({
        tag,
        hidden: top.hidden || hides(d, attrs) || classes.some((c) => hiddenClasses.has(c)),
        color: parseColor(d["-webkit-text-fill-color"]) || parseColor(d.color) || (tag === "font" ? parseColor(attrs.color) : null) || top.color,
        bg: backgroundOf(d, attrs) || top.bg,
      });
      continue;
    }
    const text = m[5] ?? m[0];
    if (!text.replace(INVISIBLE, "").trim()) { if (run) run += " "; continue; }
    if (top.hidden || sameColor(top.color, top.bg)) run += ` ${text}`;
    else flush();
  }
  flush();
  const seen = new Set();
  const out = [];
  for (const piece of pieces.map(tidy)) {
    if (!/[\p{L}\p{N}]/u.test(piece) || seen.has(piece)) continue;
    seen.add(piece);
    out.push(piece);
  }
  return out.join("\n").slice(0, HIDDEN_MAX);
}
