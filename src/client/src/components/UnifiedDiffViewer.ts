import { LitElement, css, html, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { parseUnifiedDiff, type UnifiedDiffLine, type UnifiedDiffTextSpan } from "../diff/unifiedDiff";

@customElement("unified-diff-viewer")
export class UnifiedDiffViewer extends LitElement {
  @property() diff = "";

  override render(): TemplateResult {
    const lines = parseUnifiedDiff(this.diff);
    if (lines.length === 0) return html`<p class="empty">No diff.</p>`;
    return html`
      <div class="scroller">
        <div class="diff-grid" role="table" aria-label="Unified diff">
          ${lines.map((line) => this.renderLine(line))}
        </div>
      </div>
    `;
  }

  private renderLine(line: UnifiedDiffLine): TemplateResult {
    const kindClass = line.kind;
    return html`
      <div class="line" role="row">
        <span class=${`cell line-number old ${kindClass}`} role="cell">${formatLineNumber(line.oldLineNumber)}</span>
        <span class=${`cell line-number new ${kindClass}`} role="cell">${formatLineNumber(line.newLineNumber)}</span>
        <span class=${`cell prefix ${kindClass}`} role="cell">${line.prefix}</span>
        <span class=${`cell content ${kindClass}`} role="cell">${renderSpans(line.spans)}</span>
      </div>
    `;
  }

  static override styles = css`
    :host { display: block; min-height: 0; height: 100%; color: var(--pi-text); background: var(--pi-code-background, var(--pi-bg)); }
    .empty { box-sizing: border-box; margin: 0; padding: 0.625rem; color: var(--pi-muted); }
    .scroller { height: 100%; min-height: 0; overflow: auto; border-top: var(--pi-code-surface-rule-width, 0px) solid var(--pi-border-muted); background: var(--pi-code-background, var(--pi-bg)); }
    .diff-grid { display: grid; grid-template-columns: max-content max-content 2ch max-content; width: max-content; min-width: 100%; padding: 0.375rem 0; font: 0.75rem ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; line-height: 1.45; }
    .line { display: contents; }
    .cell { min-height: 1.45em; white-space: pre; }
    .line-number { min-width: 4ch; padding: 0 8px; border-right: 1px solid var(--pi-border-muted); color: var(--pi-dim); text-align: right; user-select: none; }
    .prefix { padding: 0 4px; color: var(--pi-dim); text-align: center; user-select: none; }
    .content { padding: 0 12px 0 4px; }
    .meta { color: var(--pi-dim); }
    .hunk { background: color-mix(in srgb, var(--pi-accent) 9%, transparent); color: var(--pi-accent); }
    .add { border-left: var(--pi-diff-add-rule, 0px solid transparent); background: color-mix(in srgb, var(--pi-success) 12%, transparent); }
    .remove { border-left: var(--pi-diff-remove-rule, 0px solid transparent); background: color-mix(in srgb, var(--pi-danger) 12%, transparent); color: var(--pi-unified-diff-remove-color, var(--pi-text)); text-decoration: var(--pi-unified-diff-remove-decoration, none); }
    .marker { color: var(--pi-dim); }
    .content.add .inline-change { border-radius: var(--pi-diff-inline-radius, 2px); background: color-mix(in srgb, var(--pi-success) 36%, transparent); color: var(--pi-text); }
    .content.remove .inline-change { border-radius: var(--pi-diff-inline-radius, 2px); background: color-mix(in srgb, var(--pi-danger) 36%, transparent); color: var(--pi-unified-diff-remove-color, var(--pi-text)); text-decoration: var(--pi-unified-diff-remove-decoration, none); }
    :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .scroller { border-top-width: var(--pi-divider-width, 2px); overscroll-behavior: contain; }
    :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .line-number { border-right-width: var(--pi-divider-width, 2px); }
  `;
}

function renderSpans(spans: UnifiedDiffTextSpan[]): TemplateResult[] {
  return spans.map((span) => html`<span class=${span.changed ? "inline-change" : ""}>${span.text}</span>`);
}

function formatLineNumber(lineNumber: number | undefined): string {
  return lineNumber === undefined ? "" : String(lineNumber);
}
