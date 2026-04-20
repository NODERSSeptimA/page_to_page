export function buildMaskScript(selectors: ReadonlyArray<string>): string {
  if (selectors.length === 0) return '';
  const jsonSelectors = JSON.stringify(selectors);
  return `
(() => {
  const selectors = ${jsonSelectors};
  for (const sel of selectors) {
    let els;
    try { els = document.querySelectorAll(sel); } catch { continue; }
    els.forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      el.style.setProperty('background', '#cccccc', 'important');
      el.style.setProperty('color', 'transparent', 'important');
      el.style.setProperty('border', 'none', 'important');
      el.style.setProperty('box-shadow', 'none', 'important');
      for (const child of Array.from(el.children)) {
        if (child instanceof HTMLElement) child.style.setProperty('visibility', 'hidden', 'important');
      }
    });
  }
})();
`;
}
