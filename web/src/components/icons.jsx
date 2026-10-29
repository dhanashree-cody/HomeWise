/**
 * Thin-stroke line icons, drawn on a 24px grid at 1.6 stroke weight to match
 * the rest of the interface. They inherit colour from the element they sit in,
 * so a nav item highlighting itself recolours its icon with no extra work.
 */
const base = {
  width: 17,
  height: 17,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
};

export const Icon = {
  dashboard: (p) => (
    <svg {...base} {...p}><rect x="3" y="3" width="7" height="8" rx="2" /><rect x="14" y="3" width="7" height="5" rx="2" /><rect x="14" y="11" width="7" height="10" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /></svg>
  ),
  plus: (p) => (
    <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 8.5v7M8.5 12h7" /></svg>
  ),
  list: (p) => (
    <svg {...base} {...p}><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /></svg>
  ),
  user: (p) => (
    <svg {...base} {...p}><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></svg>
  ),
  request: (p) => (
    <svg {...base} {...p}><path d="M4 5h16v9a2 2 0 0 1-2 2h-4l-2 3-2-3H6a2 2 0 0 1-2-2z" /><path d="M9 10h6" /></svg>
  ),
  box: (p) => (
    <svg {...base} {...p}><path d="M3 8l9-4 9 4v8l-9 4-9-4z" /><path d="M3 8l9 4 9-4M12 12v8" /></svg>
  ),
  drop: (p) => (
    <svg {...base} {...p}><path d="M12 3c3.5 4 6 6.8 6 9.8A6 6 0 0 1 6 12.8C6 9.8 8.5 7 12 3z" /></svg>
  ),
  calendar: (p) => (
    <svg {...base} {...p}><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
  ),
  route: (p) => (
    <svg {...base} {...p}><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8.5 6H14a3.5 3.5 0 0 1 0 7h-4a3.5 3.5 0 0 0 0 7h5.5" /></svg>
  ),
  sliders: (p) => (
    <svg {...base} {...p}><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2.2" /><circle cx="8" cy="17" r="2.2" /></svg>
  ),
  shield: (p) => (
    <svg {...base} {...p}><path d="M12 3l7 3v6c0 4.2-2.9 7.8-7 9-4.1-1.2-7-4.8-7-9V6z" /><path d="M9.2 12.2l2 2 3.6-3.8" /></svg>
  ),
  alert: (p) => (
    <svg {...base} {...p}><path d="M12 4.5l8.5 15h-17z" /><path d="M12 10v4M12 17h.01" /></svg>
  ),
  check: (p) => (
    <svg {...base} {...p} strokeWidth="2.2"><path d="M5 12.5l4.5 4.5L19 7" /></svg>
  ),
  info: (p) => (
    <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.8h.01" /></svg>
  ),
  bang: (p) => (
    <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5M12 16.2h.01" /></svg>
  ),
  search: (p) => (
    <svg {...base} {...p}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>
  ),
  sun: (p) => (
    <svg {...base} {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" /></svg>
  ),
  moon: (p) => (
    <svg {...base} {...p}><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" /></svg>
  ),
  logout: (p) => (
    <svg {...base} {...p}><path d="M14 7V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-2" /><path d="M10 12h10M17 9l3 3-3 3" /></svg>
  ),
};
