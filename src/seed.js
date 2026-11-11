// The starter document: a button component, an auto-layout card using two instances, and a colour style,
// so a first visit shows the main features within a second.
import { emptyDoc, Tx, makeNode } from './doc.js';
import { resolve } from './resolve.js';

export function seedDoc() {
  const tx = new Tx(emptyDoc('Welcome to Contorina'));
  tx.setStyle('sBrand', { type: 'color', name: 'Brand', value: '#0D99FF' });
  tx.setStyle('sInk', { type: 'color', name: 'Ink', value: '#1E1E1E' });
  tx.setStyle('sTitle', { type: 'text', name: 'Title', fontSize: 22, fontFamily: 'Inter', fontWeight: 700, lineHeight: 1.25 });

  const btn = tx.add(makeNode('frame', {
    id: 'mainButton', name: 'Button', x: 0, y: -160, w: 120, h: 40, radius: 8, fillStyle: 'sBrand', fill: '#0D99FF', component: true,
    layout: { mode: 'row', wrap: false, gap: 8, pad: [10, 20, 10, 20], align: 'center', justify: 'center' }, sizing: { h: 'hug', v: 'hug' },
  }));
  tx.add(makeNode('text', { id: 'mainButtonLabel', name: 'Label', text: 'Get started', fill: '#FFFFFF', fontSize: 14, fontWeight: 600 }), btn.id);

  const card = tx.add(makeNode('frame', {
    id: 'card', name: 'Card', x: 0, y: 0, w: 360, h: 240, radius: 16, fill: '#FFFFFF', stroke: '#E6E6E6', strokeWidth: 1,
    layout: { mode: 'column', wrap: false, gap: 12, pad: [24, 24, 24, 24], align: 'start', justify: 'start' }, sizing: { h: 'fixed', v: 'hug' },
  }));
  tx.add(makeNode('rect', { id: 'cardImage', name: 'Image', w: 312, h: 120, radius: 10, fill: '#E5F4FF', sizing: { h: 'fill', v: 'fixed' } }), card.id);
  tx.add(makeNode('text', { id: 'cardTitle', name: 'Title', text: 'Design in one file', textStyle: 'sTitle', fillStyle: 'sInk', fill: '#1E1E1E', fontSize: 22, fontWeight: 700 }), card.id);
  tx.add(makeNode('text', {
    id: 'cardBody', name: 'Body', text: 'Frames, auto layout, components and styles. Your files stay on your disk.',
    fill: '#5C5C5C', fontSize: 14, autoSize: 'height', w: 312, sizing: { h: 'fill', v: 'hug' },
  }), card.id);
  const row = tx.add(makeNode('frame', {
    id: 'cardActions', name: 'Actions', fill: null, w: 312, h: 40, layout: { mode: 'row', wrap: false, gap: 8, pad: [4, 0, 0, 0], align: 'center', justify: 'start' }, sizing: { h: 'fill', v: 'hug' },
  }), card.id);
  tx.add(makeNode('instance', { id: 'btnPrimary', name: 'Button', mainId: 'mainButton', overrides: {} }), row.id);
  tx.add(makeNode('instance', {
    id: 'btnSecondary', name: 'Button', mainId: 'mainButton',
    overrides: { $root: { fill: '#F0F0F0', fillStyle: null }, mainButtonLabel: { text: 'Later', fill: '#1E1E1E' } },
  }), row.id);
  tx.add(makeNode('text', { id: 'hint', name: 'Hint', x: 0, y: 330, text: 'Press ⌘K (Ctrl+K) for every command. Shift+A adds auto layout.', fill: '#8A8A8A', fontSize: 13 }));
  resolve(tx);
  return tx.doc;
}
