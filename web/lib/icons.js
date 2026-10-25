/** 内联 SVG 图标。全部 24×24 描边风格，currentColor 上色。 */
import { html } from 'htm/preact';

export const ICON_PATHS = {
  target:
    '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.6"/><circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none"/>',
  calendar:
    '<rect x="3" y="5" width="18" height="16" rx="2.6"/><path d="M8 3v4M16 3v4M3 10.5h18"/>',
  chart: '<path d="M3 20.5h18"/><path d="M6.5 20.5V12M12 20.5V5.5M17.5 20.5v-6"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2.6"/><path d="M7.5 4v16M16.5 4v16M3 9.3h4.5M3 14.7h4.5M16.5 9.3H21M16.5 14.7H21"/>',
  sliders:
    '<path d="M5 21v-6.5M5 10.5V3M12 21v-9M12 8V3M19 21v-4.5M19 12.5V3"/><path d="M2.5 14.5h5M9.5 8h5M16.5 16.5h5"/>',
  check: '<path d="M20 6.5L9.2 17.3 4 12.1"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  play: '<path d="M8 5.2v13.6l11.2-6.8z"/>',
  upload: '<path d="M12 16.5V4.5M7 9.5L12 4.5l5 5"/><path d="M4 16.5v2A1.8 1.8 0 005.8 20.3h12.4A1.8 1.8 0 0020 18.5v-2"/>',
  download: '<path d="M12 4.5v12M7 11.5l5 5 5-5"/><path d="M4 20.5h16"/>',
  refresh: '<path d="M3.5 12a8.5 8.5 0 0114.4-6.1"/><path d="M18.6 3.2v4.4h-4.4"/><path d="M20.5 12a8.5 8.5 0 01-14.4 6.1"/><path d="M5.4 20.8v-4.4h4.4"/>',
  sparkles:
    '<path d="M11.5 3.5l1.8 4.4 4.4 1.8-4.4 1.8-1.8 4.4-1.8-4.4L5.3 9.7l4.4-1.8z"/><path d="M18 14.5l.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.2V12l3.6 2.1"/>',
  flame:
    '<path d="M12 21.5c3.9 0 6.4-2.6 6.4-6 0-4.3-3.9-6.2-3.9-10.1 0 0-2.2 1-2.2 3.5 0 1.6 1 2.4 1 2.4s-2.3-1.6-2.3-4.4C11 3.7 8.4 2 8.4 2c1.4 3.1-2.8 5.4-2.8 13 0 3.4 2.5 6.5 6.4 6.5z"/>',
  chevronLeft: '<path d="M15 5l-7 7 7 7"/>',
  chevronRight: '<path d="M9 5l7 7-7 7"/>',
  chevronDown: '<path d="M5.5 9l6.5 6.5L18.5 9"/>',
  trash:
    '<path d="M4 7h16M9.2 7V4.6A1.6 1.6 0 0110.8 3h2.4a1.6 1.6 0 011.6 1.6V7"/><path d="M6.2 7l.9 12.6A1.6 1.6 0 008.7 21h6.6a1.6 1.6 0 001.6-1.4L17.8 7"/>',
  edit: '<path d="M12.5 20.5H21"/><path d="M16.6 3.6a2 2 0 012.8 2.8L7.2 18.6 3.4 19.6l1-3.8z"/>',
  alert:
    '<path d="M12 3.4L22.2 20.6H1.8z"/><path d="M12 9.6v4.8"/><circle cx="12" cy="17.4" r="1.05" fill="currentColor" stroke="none"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11.2v5"/><circle cx="12" cy="7.7" r="1.05" fill="currentColor" stroke="none"/>',
  sun: '<circle cx="12" cy="12" r="4.4"/><path d="M12 2.2v2.4M12 19.4v2.4M2.2 12h2.4M19.4 12h2.4M5.1 5.1l1.7 1.7M17.2 17.2l1.7 1.7M18.9 5.1l-1.7 1.7M6.8 17.2l-1.7 1.7"/>',
  moon: '<path d="M20.4 14.6A8.6 8.6 0 019.4 3.6 8.6 8.6 0 1020.4 14.6z"/>',
  more: '<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  list: '<path d="M8.5 6.5h12.5M8.5 12h12.5M8.5 17.5h12.5"/><circle cx="4" cy="6.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="4" cy="17.5" r="1.3" fill="currentColor" stroke="none"/>',
  mic: '<rect x="9" y="2.8" width="6" height="11" rx="3"/><path d="M5 11.2a7 7 0 0014 0M12 18.2V21M8.4 21h7.2"/>',
  wand: '<path d="M4.5 19.5L15.5 8.5"/><path d="M13.8 3.4l1 2.2 2.2 1-2.2 1-1 2.2-1-2.2-2.2-1 2.2-1z"/><path d="M19 12.6l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8z"/>',
  lock: '<rect x="4.6" y="10.2" width="14.8" height="10.8" rx="2.4"/><path d="M8.2 10.2V7.2a3.8 3.8 0 017.6 0v3"/>',
  database:
    '<ellipse cx="12" cy="6" rx="7.8" ry="2.9"/><path d="M4.2 6v6c0 1.6 3.5 2.9 7.8 2.9s7.8-1.3 7.8-2.9V6"/><path d="M4.2 12v6c0 1.6 3.5 2.9 7.8 2.9s7.8-1.3 7.8-2.9v-6"/>',
  cpu: '<rect x="6.2" y="6.2" width="11.6" height="11.6" rx="2"/><path d="M10 2.4v3.8M14 2.4v3.8M10 17.8v3.8M14 17.8v3.8M2.4 10h3.8M2.4 14h3.8M17.8 10h3.8M17.8 14h3.8"/>',
  book: '<path d="M4.2 5.6A2.6 2.6 0 016.8 3H20v14.6H6.8A2.6 2.6 0 004.2 20.2z"/><path d="M4.2 20.2V5.6"/>',
  camera:
    '<path d="M4.2 8.2h2.9l1.5-2.2h6.8l1.5 2.2h2.9a1.6 1.6 0 011.6 1.6v7.6a1.6 1.6 0 01-1.6 1.6H4.2a1.6 1.6 0 01-1.6-1.6v-7.6a1.6 1.6 0 011.6-1.6z"/><circle cx="12" cy="13.2" r="3.4"/>',
  flag: '<path d="M5.5 21V3.6h9.6l-1.2 3 1.2 3H5.5"/>',
  send: '<path d="M3.8 12L20.6 3.4l-6.2 17-3.4-6.9z"/>',
  arrowRight: '<path d="M4.5 12h14M12.5 6l6 6-6 6"/>',
  grid: '<rect x="3.2" y="3.2" width="7.2" height="7.2" rx="1.6"/><rect x="13.6" y="3.2" width="7.2" height="7.2" rx="1.6"/><rect x="3.2" y="13.6" width="7.2" height="7.2" rx="1.6"/><rect x="13.6" y="13.6" width="7.2" height="7.2" rx="1.6"/>',
  bolt: '<path d="M13.4 2.5L4.8 13.8h5.6l-1 7.7 8.8-11.5h-5.6z"/>',
  eye: '<path d="M2.2 12S5.4 5.6 12 5.6 21.8 12 21.8 12 18.6 18.4 12 18.4 2.2 12 2.2 12z"/><circle cx="12" cy="12" r="3.1"/>',
  copy: '<rect x="8.4" y="8.4" width="12.4" height="12.4" rx="2.2"/><path d="M15.6 5.2A2.2 2.2 0 0013.4 3H5.4a2.2 2.2 0 00-2.2 2.2v8a2.2 2.2 0 002.2 2.2"/>',
  shoe: '<path d="M2.6 16.8h18.8v2.6H2.6z"/><path d="M2.6 16.8c0-2.4 1.4-3.6 3.2-4.4l3-1.4V8.2h2.6l.8 2.6 4 1c2.4.6 4.2 1.6 4.2 5"/>',
  pause: '<rect x="7" y="5" width="3.4" height="14" rx="1"/><rect x="13.6" y="5" width="3.4" height="14" rx="1"/>',
};

export function Icon({ name, size = 16, class: cls = '', style }) {
  const body = ICON_PATHS[name];
  if (!body) return null;
  return html`<svg
    viewBox="0 0 24 24"
    width=${size}
    height=${size}
    fill="none"
    stroke="currentColor"
    stroke-width="1.85"
    stroke-linecap="round"
    stroke-linejoin="round"
    class=${cls}
    style=${style}
    aria-hidden="true"
    dangerouslySetInnerHTML=${{ __html: body }}
  />`;
}

export default Icon;
