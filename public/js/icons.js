// Hand-drawn 24px stroke icons + the ball illustration (gradients live in index.html).
const P = {
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="4.5"/><path d="M3.5 10h17M8 3v3.5M16 3v3.5"/>',
  bell: '<path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.6 1.6H4.4L6 16.5Z"/><path d="M10 20.8a2.2 2.2 0 0 0 4 0"/>',
  user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20.2c.8-3.7 3.7-5.6 7.5-5.6s6.7 1.9 7.5 5.6"/>',
  check: '<path d="m5 12.5 4.6 4.6L19 7.4"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  left: '<path d="m14.5 5.5-6.5 6.5 6.5 6.5"/>',
  right: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
  drop: '<path d="M12 3.2s6 6.2 6 10.8a6 6 0 0 1-12 0C6 9.4 12 3.2 12 3.2Z"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="3.2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  clock: '<circle cx="12" cy="12" r="8.7"/><path d="M12 7.3V12l3.2 2"/>',
  ball: '<circle cx="12" cy="12" r="8.6"/><path d="M12 3.4v17.2M3.4 12h17.2M6.2 6.4c3 3.2 3 8 0 11.2M17.8 6.4c-3 3.2-3 8 0 11.2"/>',
  share: '<path d="M12 14.5V3.5M8 7.2l4-4 4 4"/><path d="M8 10.5H6.8a2 2 0 0 0-2 2v6.2a2 2 0 0 0 2 2h10.4a2 2 0 0 0 2-2v-6.2a2 2 0 0 0-2-2H16"/>',
  plus: '<rect x="4" y="4" width="16" height="16" rx="4.6"/><path d="M12 8.4v7.2M8.4 12h7.2"/>',
  eye: '<path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>',
  eyeOff: '<path d="M10.2 5.9A9.6 9.6 0 0 1 12 5.8c6 0 9.5 6.2 9.5 6.2a15 15 0 0 1-2.6 3.2M6.3 7.6A15 15 0 0 0 2.5 12S6 18.2 12 18.2c1.5 0 2.8-.4 4-.9"/><path d="M9.9 9.9a2.8 2.8 0 0 0 4.2 3.6M4 4l16 16"/>',
  logout: '<path d="M9.5 4.5H7a2.5 2.5 0 0 0-2.5 2.5v10A2.5 2.5 0 0 0 7 19.5h2.5"/><path d="m15 8 4 4-4 4M19 12H9.5"/>',
  key: '<circle cx="8" cy="15.5" r="3.8"/><path d="m10.8 12.7 8.2-8.2M15.6 7.9l2.6 2.6M13.2 10.3l2 2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4"/>',
  info: '<circle cx="12" cy="12" r="8.7"/><path d="M12 11v5.2M12 7.8v.01"/>',
  phone: '<rect x="6.8" y="2.8" width="10.4" height="18.4" rx="3.2"/><path d="M10.6 18.4h2.8"/>',
  shield: '<path d="M12 3 5 5.8v5.6c0 4.3 2.9 7.7 7 9.2 4.1-1.5 7-4.9 7-9.2V5.8L12 3Z"/><path d="m9 12 2.2 2.2L15.4 10"/>',
  sparkle: '<path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18l-1.8-5.4L4.5 10.8 10.2 9 12 3.5Z"/>',
  hourglass: '<path d="M7 3.5h10M7 20.5h10M8 3.5c0 4 4 5 4 8.5s-4 4.5-4 8.5M16 3.5c0 4-4 5-4 8.5s4 4.5 4 8.5"/>',
  wave: '<path d="M7.5 11.5V6a1.5 1.5 0 0 1 3 0v4.5M10.5 10V4.5a1.5 1.5 0 0 1 3 0V10M13.5 10V5.5a1.5 1.5 0 0 1 3 0V13M16.5 9.5a1.5 1.5 0 0 1 3 0v4c0 4.2-2.8 7-6.700 7-2.600 0-4.100-1-5.500-3l-2.700-4a1.500 1.500 0 0 1 2.400-1.800l1.500 1.800"/>',
};

export const icon = (name, attrs = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${attrs}>${P[name] || ''}</svg>`;

export const dropFilled = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.8s6.4 6.6 6.4 11.4a6.4 6.4 0 0 1-12.800 0C5.600 9.400 12 2.800 12 2.800Z"/></svg>';

export const ball = (cls = 'ball') => `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true">
  <circle cx="50" cy="50" r="46" fill="url(#g-ball)"/>
  <g fill="none" stroke="#5a2208" stroke-opacity=".72" stroke-width="2.4" stroke-linecap="round">
    <path d="M50 4v92M4 50h92"/><path d="M21 15c13 17 13 53 0 70M79 15c-13 17-13 53 0 70"/>
  </g>
  <circle cx="50" cy="50" r="46" fill="url(#g-rim)"/>
  <ellipse cx="35" cy="26" rx="15" ry="8.5" fill="#fff" opacity=".42" transform="rotate(-28 35 26)"/>
</svg>`;
