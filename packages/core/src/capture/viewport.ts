import { DEFAULT_VIEWPORTS, type ViewportSpec } from '../types.js';

export function resolveViewports(custom: ReadonlyArray<ViewportSpec> | undefined): ReadonlyArray<ViewportSpec> {
  if (!custom || custom.length === 0) return DEFAULT_VIEWPORTS;
  return custom;
}
