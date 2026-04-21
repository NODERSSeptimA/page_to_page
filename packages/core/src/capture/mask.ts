/**
 * Build CSS rules that visually blank out any element matching the given
 * selectors, plus hide each matched element's direct children.
 *
 * Applied via `page.addStyleTag({ content })` rather than inline
 * `style.setProperty(...)`. This is critical for apps whose change-detection
 * cycle replaces DOM subtrees (Angular, many web-component frameworks) —
 * inline styles get wiped when the component re-renders; stylesheet rules
 * re-apply on every restyle pass, so the mask survives.
 *
 * Each selector produces its own rule block. If a selector is malformed
 * the CSS parser drops only that rule — the remaining masks still apply.
 * This is safer than a single comma-joined group selector, where one bad
 * selector invalidates every entry in the group.
 */
export function buildMaskCss(selectors: ReadonlyArray<string>): string {
  if (selectors.length === 0) return '';
  const hostBlock = (sel: string) => `${sel} {
  background: #cccccc !important;
  color: transparent !important;
  border: none !important;
  box-shadow: none !important;
}`;
  const childBlock = (sel: string) => `${sel} > * {
  visibility: hidden !important;
}`;
  return [...selectors.map(hostBlock), ...selectors.map(childBlock)].join('\n');
}
