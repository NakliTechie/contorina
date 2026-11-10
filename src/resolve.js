import { syncInstances } from './components.js';
import { measureTexts } from './text.js';
import { layoutAll } from './layout.js';

// Derived state after every edit: instances from mains, text sizes from content, then auto layout.
// Text is measured again after layout because a fill-width text node wraps to its new width.
export function resolve(tx) {
  syncInstances(tx);
  measureTexts(tx);
  layoutAll(tx);
  measureTexts(tx);
  layoutAll(tx);
}
