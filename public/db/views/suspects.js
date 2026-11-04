// Suspects: the lookup of a website, a sender address or a phone number
// (#/suspects?q=<indicator>). A placeholder until agent B's page lands
// (docs/plans/2026-11-04-public-database.md, Task B3).

export const label = "Suspects";

export async function render(root) {
  root.innerHTML = `<p class="muted">Coming in this build.</p>`;
}
