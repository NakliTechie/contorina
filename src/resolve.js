import { syncInstances } from './components.js';
import { measureTexts } from './text.js';
import { layoutAll } from './layout.js';
import { applyVariables } from './variables.js';
import { syncBooleans } from './commands-vector.js';

// Derived state after every edit: instances from mains, bound variables, text sizes, then auto layout.
// Text is measured again after layout because a fill-width text node wraps to its new width.
export function resolve(tx) {
  syncInstances(tx);
  applyVariables(tx);
  measureTexts(tx);
  layoutAll(tx);
  measureTexts(tx);
  layoutAll(tx);
  syncBooleans(tx);
}
