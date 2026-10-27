import {useEffect} from 'react'

/**
 * Streamdown ships markup, not layout: its own classes are Tailwind utilities
 * that this Studio doesn't load, and its stylesheet is animations only. So
 * everything below is ours, mapped onto Sanity UI's theme variables so
 * rendered Markdown inherits the Studio's colours, fonts and dark mode.
 *
 * Two scales. The base is sized for Markdown inside a dialog or a banner,
 * where the text sits beside Studio chrome and should match it. Wrapping a
 * renderer in `PROSE_CLASS` switches to the reading scale: larger body text, a
 * heading ramp in proportion to it, and the vertical rhythm a long document
 * needs. Without the ramp, headings fall back to browser defaults — an h1 at
 * roughly 2.5x the body text, which is what a skill preview looked like.
 *
 * Rules hang off `PROSE_CLASS` and plain element selectors rather than
 * Streamdown's `data-streamdown` values: the values name individual elements
 * (`heading-1`, `table-cell`), so a descendant selector off the bare
 * attribute matches inconsistently depending on what wraps what.
 *
 * Injected once per document, keyed by element ID, so several components can
 * call this without stacking duplicate <style> tags.
 */
const STYLE_ID = 'streamdown-bridge-css'

/** Wrap a Streamdown renderer in this class to get the reading scale. */
export const PROSE_CLASS = 'sd-prose'

const CSS = `
[data-streamdown] {
  --sd-font-size: 0.8125rem;
  --sd-line-height: 1.5;
  --sd-font-family: inherit;
  --sd-code-font: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, 'DejaVu Sans Mono', monospace;
  --sd-text-color: var(--card-fg-color);
  --sd-muted-color: var(--card-muted-fg-color);
  --sd-border-color: var(--card-border-color);
  --sd-bg-color: transparent;
  --sd-code-bg: var(--card-code-bg-color, rgba(128, 128, 128, 0.1));
  --sd-radius: 3px;
}
[data-streamdown] pre { border-radius: 3px; padding: 0.75rem; }
[data-streamdown] code { font-size: 0.75rem; }
[data-streamdown] a { color: var(--card-link-color, var(--card-fg-color)); text-decoration: underline; }
[data-streamdown] p { margin: 0.5em 0; }
[data-streamdown] p:first-child { margin-top: 0; }
[data-streamdown] p:last-child { margin-bottom: 0; }

/* --- Reading scale --- */
.${PROSE_CLASS} {
  font-size: 0.9375rem;
  line-height: 1.65;
  color: var(--card-fg-color);
}

.${PROSE_CLASS} h1,
.${PROSE_CLASS} h2,
.${PROSE_CLASS} h3,
.${PROSE_CLASS} h4,
.${PROSE_CLASS} h5,
.${PROSE_CLASS} h6 {
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: -0.01em;
  margin: 1.7em 0 0.5em;
}
.${PROSE_CLASS} h1 { font-size: 1.375rem; }
.${PROSE_CLASS} h2 { font-size: 1.125rem; }
.${PROSE_CLASS} h3 { font-size: 1rem; }
.${PROSE_CLASS} h4,
.${PROSE_CLASS} h5,
.${PROSE_CLASS} h6 {
  font-size: 0.9375rem;
  color: var(--card-muted-fg-color);
}

.${PROSE_CLASS} p { margin: 0 0 0.9em; }
.${PROSE_CLASS} ul,
.${PROSE_CLASS} ol { margin: 0 0 0.9em; padding-left: 1.4em; }
.${PROSE_CLASS} li { margin: 0.25em 0; }
.${PROSE_CLASS} li > ul,
.${PROSE_CLASS} li > ol { margin: 0.25em 0 0.15em; }
.${PROSE_CLASS} li > p { margin: 0 0 0.35em; }

.${PROSE_CLASS} code {
  font-family: var(--sd-code-font);
  font-size: 0.85em;
  padding: 0.12em 0.35em;
  border-radius: 3px;
  background: var(--card-code-bg-color, rgba(128, 128, 128, 0.12));
}
.${PROSE_CLASS} pre {
  margin: 1em 0;
  padding: 0.9rem 1rem;
  border-radius: 4px;
  overflow-x: auto;
  background: var(--card-code-bg-color, rgba(128, 128, 128, 0.12));
}
.${PROSE_CLASS} pre code {
  font-size: 0.8125rem;
  padding: 0;
  background: none;
}

.${PROSE_CLASS} a {
  color: var(--card-link-color, inherit);
  text-decoration: underline;
  text-underline-offset: 2px;
  background: none;
  word-break: break-word;
}
.${PROSE_CLASS} strong { font-weight: 600; }
.${PROSE_CLASS} blockquote {
  margin: 1em 0;
  padding-left: 1em;
  border-left: 2px solid var(--card-border-color);
  color: var(--card-muted-fg-color);
}
.${PROSE_CLASS} hr {
  margin: 1.8em 0;
  border: 0;
  border-top: 1px solid var(--card-border-color);
}

/* Tables carry no layout of their own, so cells run together without this. */
.${PROSE_CLASS} [data-streamdown="table-wrapper"] { overflow-x: auto; margin: 1em 0; }
.${PROSE_CLASS} table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}
.${PROSE_CLASS} th,
.${PROSE_CLASS} td {
  border: 1px solid var(--card-border-color);
  padding: 0.4em 0.65em;
  text-align: left;
  vertical-align: top;
}
.${PROSE_CLASS} th {
  font-weight: 600;
  background: var(--card-code-bg-color, rgba(128, 128, 128, 0.08));
}

.${PROSE_CLASS} img { max-width: 100%; height: auto; }
`

export function useStreamdownStyles(): void {
  useEffect(() => {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = CSS
    document.head.appendChild(style)
  }, [])
}
