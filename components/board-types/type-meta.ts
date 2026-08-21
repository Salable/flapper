/**
 * A board type as the client sees it: the registry metadata a server
 * component serializes for the new-board screen and Settings. Adding a type
 * adds a card with zero changes to either.
 */
export type TypeMeta = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  /** Outcome labels - what you get, not how it works. */
  capabilities: string[];
  /** A line for the card's preview. */
  sample?: string;
  /** The default for most walls; marked on the card. */
  recommended?: boolean;
  /** Named when the type is locked behind an account tier. */
  tier?: string;
  createParams: {
    key: string;
    kind: 'text' | 'number' | 'select' | 'checkbox' | 'message';
    label: string;
    hint?: string;
    default?: unknown;
    required?: boolean;
    /** Not asked at creation; the default applies and Settings → General edits it. */
    advanced?: boolean;
    min?: number;
    max?: number;
    options?: { value: string; label: string }[];
  }[];
};
