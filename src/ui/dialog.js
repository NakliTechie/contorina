// Styled dialogs (the NakliOS contract asks apps not to use native alert, confirm and prompt).
import { h } from './dom.js';

export function dialog({ title, body, buttons, input }) {
  return new Promise((resolve) => {
    const field = input ? h('input.dlg-input', { type: 'text', value: input.value || '', placeholder: input.placeholder || '' }) : null;
    const close = (v) => { d.close(); d.remove(); resolve(v); };
    const d = h('dialog.dlg',
      h('h2', title),
      body ? h('p', body) : null,
      field,
      h('div.dlg-buttons', buttons.map((b, i) => h('button' + (b.primary ? '.primary' : '') + (b.danger ? '.danger' : ''), {
        type: 'button', on: { click: () => close(field && b.value !== false ? (b.value === undefined ? field.value : b.value) : b.value) },
        autofocus: b.primary && !field,
      }, b.label))),
    );
    d.addEventListener('cancel', (e) => { e.preventDefault(); close(buttons.find((b) => b.cancel)?.value ?? null); });
    d.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && field) { e.preventDefault(); close(field.value); }
    });
    document.body.appendChild(d);
    d.showModal();
    if (field) { field.focus(); field.select(); }
  });
}
export const confirmDialog = (title, body, okLabel = 'OK', danger = false) =>
  dialog({ title, body, buttons: [{ label: 'Cancel', value: false, cancel: true }, { label: okLabel, value: true, primary: !danger, danger }] });
export const promptDialog = (title, value, okLabel = 'OK') =>
  dialog({ title, input: { value }, buttons: [{ label: 'Cancel', value: null, cancel: true }, { label: okLabel, primary: true }] });

let toastTimer;
export function toast(msg, kind = 'info') {
  let el = document.getElementById('toast');
  if (!el) { el = h('div.toast', { role: 'status', 'aria-live': 'polite' }); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), kind === 'error' ? 6000 : 2500);
}
