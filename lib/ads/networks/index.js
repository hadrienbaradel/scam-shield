// The ad networks the studio can publish to, behind one adapter shape (_product/specs/ad-studio.md line 9;
// contract C3 in docs/plans/2026-11-04-ad-studio.md): label, configured(), missingKeys(), settings(),
// publish(), setStatus(), review(). Facebook is built; Snapchat and Google Demand Gen are Ideas.

import { facebook } from "./facebook.js";

const NETWORKS = Object.freeze({ facebook });

export const networkNames = () => Object.keys(NETWORKS);

export function getNetwork(name) {
  const key = String(name ?? "");
  if (!Object.hasOwn(NETWORKS, key)) throw new Error(`Unknown ad network "${key}": the known ones are ${networkNames().join(", ")}`);
  return NETWORKS[key];
}
