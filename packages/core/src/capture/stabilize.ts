export const STABILIZE_INIT_SCRIPT = `
(() => {
  const FROZEN_NOW = 1704067200000;
  const OriginalDate = Date;
  const FrozenDate = function (...args) {
    if (args.length === 0) return new OriginalDate(FROZEN_NOW);
    return new OriginalDate(...args);
  };
  FrozenDate.now = () => FROZEN_NOW;
  FrozenDate.parse = OriginalDate.parse;
  FrozenDate.UTC = OriginalDate.UTC;
  FrozenDate.prototype = OriginalDate.prototype;
  globalThis.Date = FrozenDate;
  Math.random = () => 0.5;
})();
`;

export function stabilizeStyleTag(): string {
  return `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}`;
}
