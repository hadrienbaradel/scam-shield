// The Settings screen's words (public/js/views/settings.js): the My people
// and "Tell Thomas automatically" rows from /api/guardians, the Text size
// step, every /api/audit event in plain words in English and French. Pure
// helpers only: no DOM, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { STRINGS, setLang } from "../public/js/i18n.js";
import { relationWords, sortPeople, personWords, peopleState, tellRow, sizeStep, eventWords } from "../public/js/views/settings.js";

const thomas = { id: "g1", name: "Thomas Martin", relation: "My Son", status: "active", email: "thomas@example.com" };
const anna = { id: "g2", name: "Anna", relation: "", status: "invited", email: "anna@example.com" };
const inFrench = (fn) => {
  globalThis.document = { documentElement: {} }; // setLang records the language on <html>
  try { setLang("fr"); return fn(); } finally { setLang("en"); delete globalThis.document; }
};

test("the relation reads after \"your\": no leading my, lower case", () => {
  assert.equal(relationWords("My Son"), "son");
  assert.equal(relationWords("  grandson "), "grandson");
  assert.equal(relationWords("mon fils"), "fils");
  assert.equal(relationWords("ma petite-fille"), "petite-fille");
  assert.equal(relationWords(null), "");
});

test("My people: the first person, how many more, nobody, or nothing when the list failed", () => {
  assert.equal(personWords(thomas), "Thomas Martin, your son");
  assert.equal(personWords(anna), "Anna, your trusted person");
  assert.equal(peopleState([thomas]), "Thomas Martin, your son");
  assert.equal(peopleState([anna, thomas]), "Thomas Martin, your son, and one more person", "the person who said yes comes first");
  assert.equal(peopleState([anna, thomas, { ...anna, id: "g3" }]), "Thomas Martin, your son, and 2 more people");
  assert.equal(peopleState([]), "No one yet");
  assert.equal(peopleState(null), null);
  assert.deepEqual(sortPeople([anna, thomas]).map((g) => g.id), ["g1", "g2"]);
  assert.equal(inFrench(() => peopleState([thomas])), "Thomas Martin, votre son");
});

test("Tell automatically names the first person who said yes, by first name; nobody ready: the plain words", () => {
  assert.deepEqual(tellRow([anna, thomas], false), {
    name: "Tell Thomas automatically", state: "Off. Nothing is shared unless you tap “Ask Thomas”.", verb: "Turn on" });
  assert.equal(tellRow([thomas], true).state, "On. When a scam asks for money or secrecy, Prudence tells Thomas.");
  assert.equal(tellRow([thomas], true).verb, "Turn off");
  assert.deepEqual(tellRow([anna], false), {
    name: "Tell my trusted person automatically", state: "Off. Nothing is shared unless you choose to.", verb: "Turn on" });
  assert.equal(tellRow(null, true).state, "On. When a scam asks for money or secrecy, Prudence tells your trusted person.");
  assert.equal(inFrench(() => tellRow([thomas], false).name), "Prévenir Thomas automatiquement");
});

test("Text size goes Normal, Larger, Largest, then back to normal", () => {
  assert.deepEqual(sizeStep(1), { state: "size_1", verb: "set_larger", next: 1.2 });
  assert.deepEqual(sizeStep(1.2), { state: "size_2", verb: "set_larger", next: 1.4 });
  assert.deepEqual(sizeStep(1.4), { state: "size_3", verb: "set_normal", next: 1 });
  assert.deepEqual(sizeStep(undefined), sizeStep(1));
});

test("every event the server writes has plain words in English and French", () => {
  // The event names given to audit() anywhere under src/.
  const names = new Set();
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (p.endsWith(".js")) for (const m of readFileSync(p, "utf8").matchAll(/audit\([^,]+,\s*(?:[^,]*\?\s*)?"([a-z_]+)"(?:\s*:\s*"([a-z_]+)")?/g)) { names.add(m[1]); if (m[2]) names.add(m[2]); }
    }
  };
  walk(new URL("../src", import.meta.url).pathname);
  for (const branch of ["moved_out_of_inbox", "labeled", "guardian_asked", "guardian_auto_alerted"]) assert.ok(names.has(branch), `${branch} found`); // both sides of a ? :
  assert.ok(names.size >= 15, `found the audit events (${[...names].join(", ")})`);
  for (const name of names) {
    const keys = name === "labeled" ? ["set_ev_labeled", "set_ev_labeled_scam", "set_ev_labeled_careful"]
      : name === "act_mode_changed" ? ["set_ev_mode_move", "set_ev_mode_label"] : [`set_ev_${name}`];
    for (const k of keys) for (const l of ["en", "fr"]) assert.ok(STRINGS[l][k], `${l}.${k} (${name})`);
  }
  assert.equal(eventWords({ event: "labeled", detail: { verdict: "scam" } }), "Marked a message as a scam");
  assert.equal(eventWords({ event: "labeled", detail: { verdict: "be_careful" } }), "Marked a message “Be careful”");
  assert.equal(eventWords({ event: "act_mode_changed", detail: { actMode: "label" } }), "You chose: only add a red label");
  assert.equal(eventWords({ event: "put_back" }), "You put a message back in your inbox");
  assert.equal(eventWords({ event: "something_new" }), "Something new", "an unknown event keeps its name, spaced");
  assert.equal(inFrench(() => eventWords({ event: "device_paired" })), "Un téléphone a été ajouté");
});
