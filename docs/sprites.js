/* Drawings, not emoji.
 *
 * Emoji were doing two jobs badly. As player characters they came out of a
 * random pick, so a child could get a different animal every time they joined
 * and two children in the same class could end up as the same one. As interface
 * icons they render differently on every device and look like filler.
 *
 * So both are drawn here as SVG: one character set built from a colour and a
 * silhouette (96 combinations, chosen by index, never at random), and one flat
 * icon set. Everything scales, keeps its colour on a projector, and looks the
 * same on a school laptop as on a phone.
 */
(function (global) {
  'use strict';

  const SKIN = ['#F4364C', '#4F6BFF', '#FFC53D', '#12BE8E', '#6C4CF1', '#2BA8FF', '#FF7A45', '#00B8A9',
                '#E8467C', '#7BC62D', '#FF9A3D', '#3AC0D8'];

  /* Each silhouette is what sits on top of the same round body, so a child can
   * tell their character from the back of the classroom by shape alone. */
  const CREST = [
    // Every silhouette is anchored inside the head so it reads as part of the
    // character rather than something balanced on top of it.
    '<path d="M10 22 C8 14 10 8 14 6 C18 8 20 14 20 20 Z"/><path d="M38 22 C40 14 38 8 34 6 C30 8 28 14 28 20 Z"/>',   // wide ears
    '<rect x="14" y="4" width="7" height="20" rx="3.5"/><rect x="27" y="4" width="7" height="20" rx="3.5"/>',            // long ears
    '<path d="M24 4 C27 10 28 16 27 22 L21 22 C20 16 21 10 24 4 Z"/>',                                                   // single horn
    '<circle cx="12" cy="8" r="3.6"/><circle cx="36" cy="8" r="3.6"/><path d="M12 8 C13 14 16 17 19 19 M36 8 C35 14 32 17 29 19" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/>', // antennae
    '<path d="M24 3 C27 9 28 14 27 20 L21 20 C20 14 21 9 24 3 Z"/><path d="M14 9 C18 13 19 17 19 21 L13 21 C12 17 12 12 14 9 Z"/><path d="M34 9 C30 13 29 17 29 21 L35 21 C36 17 36 12 34 9 Z"/>', // crest of three
    '<circle cx="11" cy="15" r="7.5"/><circle cx="37" cy="15" r="7.5"/>',                                                // round ears
    '<path d="M9 22 C9 10 16 4 24 4 C32 4 39 10 39 22 Z"/>',                                                             // dome
    '<path d="M6 22 C8 12 15 6 24 10 C33 6 40 12 42 22 Z"/>',                                                            // wide frill
    '<rect x="21.5" y="6" width="5" height="14" rx="2.5"/><circle cx="24" cy="5" r="5.5"/>',                              // bobble
    '<path d="M24 4 C31 9 35 15 36 22 L12 22 C13 15 17 9 24 4 Z"/>',                                                     // peak
    '<path d="M24 5 C28 9 30 14 30 20 L18 20 C18 14 20 9 24 5 Z"/><path d="M13 12 C17 15 18 18 18 21 L11 21 C10 18 11 14 13 12 Z"/><path d="M35 12 C31 15 30 18 30 21 L37 21 C38 18 37 14 35 12 Z"/>', // sprout
    '<circle cx="24" cy="8" r="6.5"/><circle cx="12" cy="16" r="5"/><circle cx="36" cy="16" r="5"/>'                     // three tufts
  ];

  const dark = '#181030';

  /** A player's character. `index` is stored with the player, so it never changes. */
  function face(index, size = 48) {
    const n = Math.abs(Math.round(Number(index) || 0));
    const colour = SKIN[n % SKIN.length];
    const crest = CREST[Math.floor(n / SKIN.length) % CREST.length];
    return `<svg class="face-svg" viewBox="0 0 48 48" width="${size}" height="${size}" aria-hidden="true">
      <g fill="${colour}" color="${colour}">${crest}</g>
      <circle cx="24" cy="30" r="16" fill="${colour}"/>
      <circle cx="18" cy="27" r="3.1" fill="${dark}"/>
      <circle cx="30" cy="27" r="3.1" fill="${dark}"/>
      <circle cx="19.1" cy="26" r="1.05" fill="#fff"/>
      <circle cx="31.1" cy="26" r="1.05" fill="#fff"/>
      <path d="M19 35 Q24 39 29 35" stroke="${dark}" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    </svg>`;
  }

  const COMBINATIONS = SKIN.length * CREST.length;

  /* Handing out 0, 1, 2, 3 would give the first twelve children the same silhouette
   * in twelve colours, which is exactly the thing that makes a class look alike.
   * Stepping by 13 through 144 visits every combination once (13 and 144 share no
   * factor) and changes both the colour and the shape each time. */
  const STRIDE = 13;
  const nth = (k) => (k * STRIDE) % COMBINATIONS;

  /** The first character no one in this game has taken. */
  function freeFace(taken) {
    const used = new Set((taken || []).map(Number));
    for (let k = 0; k < COMBINATIONS; k++) if (!used.has(nth(k))) return nth(k);
    return nth(Math.floor(Math.random() * COMBINATIONS));
  }

  /* ── interface icons ─────────────────────────────────────
   * One flat style: 24x24, filled, no strokes to go thin when scaled down. */
  const ICON = {
    play:     '<path d="M8 5.5v13l11-6.5z"/>',
    copy:     '<rect x="8" y="2.5" width="12" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="2.2"/><rect x="3.5" y="6.5" width="12" height="15" rx="2.5"/>',
    trophy:   '<path d="M7 3h10v5a5 5 0 0 1-10 0z"/><path d="M4 4h3v3a3 3 0 0 1-3-3zM17 4h3a3 3 0 0 1-3 3z"/><rect x="10.5" y="13" width="3" height="4"/><rect x="7" y="17" width="10" height="3" rx="1.2"/>',
    flame:    '<path d="M13.6 1.4c.6 3.4-1.9 4.6-1.9 6.9 0 1 .6 1.7 1.4 1.7 1.1 0 1.6-.9 1.7-2.1 1.9 1.7 3.2 3.9 3.2 6.2a6.2 6.2 0 0 1-12.4 0c0-3.1 1.8-5 3.4-6.6 1.9-1.9 3.9-3.4 4.6-6.1z"/><path d="M12 13c1.6 1 2.4 2.2 2.4 3.5a2.4 2.4 0 0 1-4.8 0c0-1.2.9-2.4 2.4-3.5z" fill="rgba(0,0,0,.25)"/>',
    clock:    '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 5v5.2l4 2.4-1 1.7-5-3V7z"/>',
    medal:    '<path d="M6 2h4l3 7H9zM14 2h4l-3 7h-4z"/><circle cx="12" cy="16" r="6"/>',
    target:   '<circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="12" cy="12" r="1.9"/>',
    laser:    '<path d="M3 8h9v3.2l8-4.2v10.4l-8-4.2V17a3 3 0 0 1-6 0v-3H3z"/>',
    kart:     '<path d="M3 15h18l-2-5h-4l-2-3H8l-1 3H5z"/><circle cx="7" cy="18" r="2.6"/><circle cx="17" cy="18" r="2.6"/>',
    bricks:   '<rect x="2" y="4" width="9" height="6" rx="1"/><rect x="13" y="4" width="9" height="6" rx="1"/><rect x="2" y="14" width="9" height="6" rx="1"/><rect x="13" y="14" width="9" height="6" rx="1"/>',
    gem:      '<path d="M7 3h10l5 6-10 12L2 9z"/>',
    dragon:   '<path d="M4 12a8 8 0 0 1 16 0v3a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M6 4l3 4M18 4l-3 4" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round"/><circle cx="9.5" cy="12" r="1.8" fill="#fff"/><circle cx="14.5" cy="12" r="1.8" fill="#fff"/>',
    key:      '<circle cx="8" cy="8" r="5"/><path d="M11 11l9 9-2 2-2-2-2 2-2-2 2-2z"/>',
    inbox:    '<path d="M12 2v9M8 8l4 4 4-4" stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 14v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5h-5l-1.5 2.5h-5L8 14z"/>',
    save:     '<path d="M3.5 3.5h12.5l4.5 4.5v12.5h-17z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><rect x="8" y="3.5" width="6" height="5"/><rect x="7" y="13" width="10" height="7.5" rx="1"/>',
    spark:    '<path d="M12 1l2.2 6.4L21 9.5l-6.8 2.1L12 18l-2.2-6.4L3 9.5l6.8-2.1z"/><path d="M19 15l1 2.6 2.7.9-2.7.9L19 22l-1-2.6-2.7-.9 2.7-.9z"/>',
    flag:     '<path d="M5 2v20h2.5v-8H20l-3-5 3-5z"/>',
    tick:     '<path d="M9.6 17.2 4.4 12l1.9-1.9 3.3 3.3 7.9-7.9L19.4 7z"/>',
    cross:    '<path d="M18.4 7 17 5.6 12 10.6 7 5.6 5.6 7l5 5-5 5L7 18.4l5-5 5 5 1.4-1.4-5-5z"/>',
    ghost:    '<path d="M4 21V11a8 8 0 0 1 16 0v10l-3-2-2.5 2L12 19l-2.5 2L7 19z"/><circle cx="9.5" cy="10" r="1.9" fill="#fff"/><circle cx="14.5" cy="10" r="1.9" fill="#fff"/>',
    warn:     '<path d="M12 2 23 21H1z"/><rect x="10.8" y="8" width="2.4" height="7" rx="1.2" fill="#fff"/><circle cx="12" cy="17.6" r="1.4" fill="#fff"/>',
    wave:     '<path d="M7 12V4.5a1.8 1.8 0 0 1 3.5 0V11V3a1.8 1.8 0 0 1 3.5 0v8V5a1.8 1.8 0 0 1 3.5 0v8.5c0 4.5-2.5 7.5-6 7.5s-6-2.6-7-6l-1-3.4a1.7 1.7 0 0 1 3-1.6z"/>',
    handshake:'<path d="M2 8.5h5.5L12 6l4.5 2.5H22v6.5h-4l-2.5 3.5-3.5-2.5-3.5 2.5L6 15H2z"/>'
  };

  function icon(name, size = 20, colour) {
    const body = ICON[name];
    if (!body) return '';
    return `<svg class="icon" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"` +
           `${colour ? ` style="color:${colour}"` : ''} fill="currentColor">${body}</svg>`;
  }

  global.Sprite = { face, icon, freeFace, COMBINATIONS, names: Object.keys(ICON) };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = globalThis.Sprite;
