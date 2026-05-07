import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { composerStyles } from "./shared";

@customElement("chat-composer")
export class Composer extends LitElement {
  @property({ type: Boolean }) disabled = false;
  @property({ attribute: false }) onSend?: (text: string) => void;
  @property({ attribute: false }) onStopSession?: () => void;
  @state() private draft = "";

  render() {
    return html`
      <footer>
        <textarea
          .value=${this.draft}
          ?disabled=${this.disabled}
          @input=${(e: Event) => (this.draft = (e.target as HTMLTextAreaElement).value)}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              this.send();
            }
          }}
          placeholder="Message pi..."
        ></textarea>
        <button ?disabled=${this.disabled} @click=${this.send}>Send</button>
        <button ?disabled=${this.disabled} @click=${() => this.onStopSession?.()}>Stop session</button>
      </footer>
    `;
  }

  private send() {
    const text = this.draft.trim();
    if (!text || this.disabled) return;
    this.draft = "";
    this.onSend?.(text);
  }

  static styles = composerStyles;
}
