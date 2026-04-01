import * as Y from 'yjs';

/**
 * Bidirectional bridge between React Hook Form and Yjs Y.Map / Y.Text.
 *
 * - Discrete form fields (dropdowns, numbers, short text) are stored in a Y.Map
 *   keyed by field name, enabling last-writer-wins CRDT merging.
 * - Long text fields (SOAP notes, report content) use Y.Text for character-level
 *   conflict-free merging with cursor preservation.
 */
export class FormYjsBridge {
  private doc: Y.Doc;
  private formMap: Y.Map<unknown>;
  private textFields: Map<string, Y.Text>;
  private suppressRemote: boolean;

  constructor(doc: Y.Doc) {
    this.doc = doc;
    this.formMap = doc.getMap('form');
    this.textFields = new Map();
    this.suppressRemote = false;
  }

  /**
   * Set a discrete field value in the shared Y.Map.
   * Call this when the local user changes a form field.
   */
  setFieldValue(name: string, value: unknown): void {
    this.suppressRemote = true;
    try {
      this.doc.transact(() => {
        this.formMap.set(name, value);
      }, 'local');
    } finally {
      this.suppressRemote = false;
    }
  }

  /**
   * Get the current value of a discrete field from the shared Y.Map.
   */
  getFieldValue(name: string): unknown {
    return this.formMap.get(name);
  }

  /**
   * Get or create a Y.Text instance for collaborative text editing.
   * Use this for long-form text fields that benefit from character-level CRDT.
   */
  getTextField(name: string): Y.Text {
    let yText = this.textFields.get(name);
    if (!yText) {
      yText = this.doc.getText(name);
      this.textFields.set(name, yText);
    }
    return yText;
  }

  /**
   * Initialize the Y.Map with form default values without overwriting
   * existing CRDT state (e.g., from a reconnecting peer).
   */
  initializeDefaults(defaults: Record<string, unknown>): void {
    this.doc.transact(() => {
      for (const [key, value] of Object.entries(defaults)) {
        if (!this.formMap.has(key)) {
          this.formMap.set(key, value);
        }
      }
    }, 'local');
  }

  /**
   * Observe remote changes on the Y.Map and invoke a callback for each changed field.
   * Changes originating from `setFieldValue` (local) are suppressed.
   *
   * Returns an unsubscribe function.
   */
  observeChanges(
    onFieldChange: (name: string, value: unknown) => void,
  ): () => void {
    const handler = (event: Y.YMapEvent<unknown>, tx: Y.Transaction) => {
      // Skip changes triggered by local setFieldValue
      if (this.suppressRemote || tx.origin === 'local') return;

      event.changes.keys.forEach((change, key) => {
        if (change.action === 'add' || change.action === 'update') {
          onFieldChange(key, this.formMap.get(key));
        }
      });
    };

    this.formMap.observe(handler);
    return () => this.formMap.unobserve(handler);
  }

  /**
   * Clean up the Y.Doc and all associated state.
   */
  destroy(): void {
    this.textFields.clear();
    this.doc.destroy();
  }
}
