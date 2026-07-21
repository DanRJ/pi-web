import { html, type TemplateResult } from "lit";

export function renderProjectIcon(): TemplateResult {
  return html`<svg class="hierarchy-icon project-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h7l2 2h9v10H3z"></path></svg>`;
}

export function renderWorkspaceIcon(): TemplateResult {
  return html`<svg class="hierarchy-icon workspace-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="5" r="2"></circle><circle cx="6" cy="19" r="2"></circle><circle cx="18" cy="7" r="2"></circle><path d="M6 7v10M8 17c5 0 8-3 8-8"></path></svg>`;
}

export function renderSessionIcon(): TemplateResult {
  return html`<svg class="hierarchy-icon session-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"></path></svg>`;
}
