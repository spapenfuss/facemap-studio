// OnFleek knowledge tables: eyebrow advice per face shape, plain-language face-shape explanations,
// and season-specific makeup + neutral colors. Everything here is data + small pure functions (tested in tests/profiles.test.mjs).

// ------------------------------------------------------------ eyebrow advice ----
export const BROW_REC = {
  Oval: {
    name: 'Soft rounded arch',
    why: 'Oval faces are already balanced, so the brow should add softness rather than change anything. A gently curved brow with the peak about two-thirds of the way along follows the natural curve of your face.',
    avoid: 'Very high, sharply angled arches (they can make the face look surprised) and very straight, flat brows (they can make an oval face look longer).',
  },
  Round: {
    name: 'Soft angled brow with a defined arch',
    why: 'Round faces are about as wide as they are long. A brow with a clear lift and a slight angle at the arch draws the eye up and out, which adds structure and the impression of length.',
    avoid: 'Very round, arched-over brows (they echo the roundness of the face) and very thick, short brows (they can make the face look wider).',
  },
  Square: {
    name: 'Softly curved brow with a gentle arch',
    why: 'Square faces have a strong jaw and forehead with straight lines. A softly curved brow with a medium arch balances those angles instead of repeating them.',
    avoid: 'Straight, flat brows and very sharp, angular arches. Both emphasise the strong lines of the jaw and forehead.',
  },
  Heart: {
    name: 'Rounded brow with a low, soft arch',
    why: 'Heart-shaped faces are widest across the forehead and narrow toward the chin. A rounded brow with a lower, softer peak keeps the top of the face from looking wider and balances the lower face.',
    avoid: 'High, sharply angled arches and very thin brows. They add width and lift at the top of the face.',
  },
  Oblong: {
    name: 'Flat to softly arched brow',
    why: 'Oblong faces are noticeably longer than they are wide. A straighter brow with only a hint of an arch, kept slightly longer, adds visual width and shortens the length of the face.',
    avoid: 'High, dramatic arches. A tall arch adds even more vertical length.',
  },
  Diamond: {
    name: 'Curved brow with a soft lift',
    why: 'Diamond faces are widest at the cheekbones, with a narrower forehead and chin. A curved brow with a softly lifted arch balances the prominent cheekbones without adding width.',
    avoid: 'Very angular, hard arches and very short brows. They can make the cheekbones look even wider.',
  },
};

// ------------------------------------------------------- face shape explained ----
// Same prototype values the C++ engine uses (see engine/engine.cpp PROTO).
export const PROTO = {
  Oval: { len: 1.08, fr: 0.64, jr: 0.82, chin: 140, jaw: 164 },
  Round: { len: 0.96, fr: 0.64, jr: 0.85, chin: 150, jaw: 168 },
  Square: { len: 0.98, fr: 0.66, jr: 0.92, chin: 146, jaw: 160 },
  Heart: { len: 1.07, fr: 0.69, jr: 0.70, chin: 125, jaw: 156 },
  Oblong: { len: 1.22, fr: 0.64, jr: 0.82, chin: 132, jaw: 165 },
  Diamond: { len: 1.08, fr: 0.57, jr: 0.70, chin: 128, jaw: 159 },
};
const word = (v, lo, hi, a, b, c) => (v < lo ? a : v > hi ? b : c);

/** Plain-language list of the measured proportions and how each relates to the detected shape. */
export function explainShape(shape, m) {
  const P = PROTO[shape]; if (!P || !m) return [];
  const rows = [];
  const near = (v, t, tol) => Math.abs(v - t) <= tol;
  rows.push({
    key: 'length', title: 'Length compared with width', value: m.lengthToWidth.toFixed(2),
    text: `Your face is ${word(m.lengthToWidth, 0.99, 1.15, 'close to as wide as it is long', 'noticeably longer than it is wide', 'a little longer than it is wide')}.`,
    fits: near(m.lengthToWidth, P.len, 0.09),
    note: near(m.lengthToWidth, P.len, 0.09) ? `This matches what we expect for a ${shape.toLowerCase()} face.` : `A ${shape.toLowerCase()} face is usually a bit ${P.len > m.lengthToWidth ? 'longer' : 'shorter'} than this, so other measurements carried the result.`,
  });
  rows.push({
    key: 'forehead', title: 'Forehead compared with cheekbones', value: m.foreheadToCheek.toFixed(2),
    text: `Your forehead is ${word(m.foreheadToCheek, 0.6, 0.67, 'narrower than', 'nearly as wide as', 'a little narrower than')} your cheekbones.`,
    fits: near(m.foreheadToCheek, P.fr, 0.05),
    note: near(m.foreheadToCheek, P.fr, 0.05) ? 'This fits the shape.' : 'This differs a little from the typical pattern for the shape.',
  });
  rows.push({
    key: 'jaw', title: 'Jaw compared with cheekbones', value: m.jawToCheek.toFixed(2),
    text: `Your jaw is ${word(m.jawToCheek, 0.76, 0.88, 'much narrower than', 'almost as wide as', 'somewhat narrower than')} your cheekbones.`,
    fits: near(m.jawToCheek, P.jr, 0.07),
    note: near(m.jawToCheek, P.jr, 0.07) ? 'This fits the shape.' : 'This differs a little from the typical pattern for the shape.',
  });
  rows.push({
    key: 'chin', title: 'Chin', value: `${Math.round(m.chinAngle)}°`,
    text: `Your chin is ${word(m.chinAngle, 133, 146, 'fairly pointed', 'rounded and soft', 'gently tapered')}.`,
    fits: near(m.chinAngle, P.chin, 9),
    note: near(m.chinAngle, P.chin, 9) ? 'This fits the shape.' : 'This differs a little from the typical pattern for the shape.',
  });
  rows.push({
    key: 'jawangle', title: 'Jaw corners', value: `${Math.round(m.jawAngle)}°`,
    text: `Your jaw corners are ${word(m.jawAngle, 160, 166, 'more angular', 'soft and rounded', 'moderately defined')}.`,
    fits: near(m.jawAngle, P.jaw, 5),
    note: near(m.jawAngle, P.jaw, 5) ? 'This fits the shape.' : 'This differs a little from the typical pattern for the shape.',
  });
  return rows;
}

/** Small SVG diagram: a face outline with the three widths and the length drawn to scale. */
export function shapeDiagramSVG(m) {
  const cheek = 100, fore = cheek * m.foreheadToCheek, jaw = cheek * m.jawToCheek, len = cheek * m.lengthToWidth;
  const cx = 110, top = 22, bot = top + len * 1.08, yF = top + len * 0.2, yC = top + len * 0.42, yJ = top + len * 0.78;
  const f = (v) => v.toFixed(1);
  const outline = `M ${f(cx - fore / 2)} ${f(yF)} C ${f(cx - fore / 2)} ${f(top - 6)}, ${f(cx + fore / 2)} ${f(top - 6)}, ${f(cx + fore / 2)} ${f(yF)}
    C ${f(cx + cheek / 2 + 4)} ${f(yF + 8)}, ${f(cx + cheek / 2)} ${f(yC - 6)}, ${f(cx + cheek / 2)} ${f(yC)}
    C ${f(cx + cheek / 2)} ${f(yC + 20)}, ${f(cx + jaw / 2)} ${f(yJ - 12)}, ${f(cx + jaw / 2)} ${f(yJ)}
    C ${f(cx + jaw / 2 - 6)} ${f(bot - 10)}, ${f(cx + 12)} ${f(bot)}, ${f(cx)} ${f(bot)}
    C ${f(cx - 12)} ${f(bot)}, ${f(cx - jaw / 2 + 6)} ${f(bot - 10)}, ${f(cx - jaw / 2)} ${f(yJ)}
    C ${f(cx - jaw / 2)} ${f(yJ - 12)}, ${f(cx - cheek / 2)} ${f(yC + 20)}, ${f(cx - cheek / 2)} ${f(yC)}
    C ${f(cx - cheek / 2)} ${f(yC - 6)}, ${f(cx - cheek / 2 - 4)} ${f(yF + 8)}, ${f(cx - fore / 2)} ${f(yF)} Z`;
  const h = (y, w, label, col) => `<line x1="${f(cx - w / 2)}" y1="${f(y)}" x2="${f(cx + w / 2)}" y2="${f(y)}" stroke="${col}" stroke-width="2.4" stroke-linecap="round"/>
    <circle cx="${f(cx - w / 2)}" cy="${f(y)}" r="3" fill="${col}"/><circle cx="${f(cx + w / 2)}" cy="${f(y)}" r="3" fill="${col}"/>
    <text x="${f(cx + w / 2 + 8)}" y="${f(y + 4)}" font-size="11" fill="${col}">${label}</text>`;
  return `<svg viewBox="0 0 250 ${Math.ceil(bot + 16)}" role="img" aria-label="Diagram of your face proportions" class="shape-svg">
    <path d="${outline}" fill="rgba(200,160,140,.16)" stroke="currentColor" stroke-width="1.6"/>
    <line x1="${cx}" y1="${f(top - 4)}" x2="${cx}" y2="${f(bot + 4)}" stroke="#9a8d86" stroke-dasharray="3 4"/>
    ${h(yF, fore, 'Forehead', '#b9776f')}${h(yC, cheek, 'Cheekbones', '#6d8f7d')}${h(yJ, jaw, 'Jaw', '#7a79b3')}
    <text x="${cx + 4}" y="${f(bot + 14)}" font-size="11" fill="#9a8d86">Length</text></svg>`;
}

// -------------------------------------------------------------------- lips ----
/** Lip shape from landmarks (0..1 normalised, any head size). Returns plain-language advice. */
export function lipAnalysis(lm, W, H) {
  const P = (i) => [lm[i * 3] * W, lm[i * 3 + 1] * H], d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const width = d(P(61), P(291)), upper = d(P(0), P(13)), lower = d(P(14), P(17)), face = d(P(234), P(454));
  const ratio = lower > 0 ? upper / lower : 1, full = (upper + lower) / width, wide = width / face;
  const out = [];
  out.push(full < 0.27 ? 'Your lips are on the slimmer side. Line just outside your natural lip line and use satin or glossy formulas for a fuller look.'
    : full > 0.40 ? 'Your lips are full. Line right on the natural edge, and matte or satin formulas keep the shape crisp.'
    : 'Your lips are medium in fullness, so you can follow your natural lip line closely.');
  out.push(ratio < 0.62 ? 'Your upper lip is thinner than your lower. Draw a touch outside the upper lip line, especially at the peaks, to balance them.'
    : ratio > 0.95 ? 'Your upper and lower lips are close to equal. Keep the line symmetrical and softly blended.'
    : 'Your upper lip is a little thinner than your lower, which is very common. A soft line on the cupid\'s bow evens it out.');
  out.push(wide > 0.40 ? 'Your mouth is wide, so soften the outer corners and bring color slightly in from the very edge.'
    : wide < 0.31 ? 'Your mouth is on the narrower side, so take color all the way to the corners to add width.'
    : 'Your mouth width is balanced with your face. Follow the corners naturally.');
  return out;
}

// ------------------------------------------------------ season makeup colors ----
// Each entry: [hex, name]. blush, shadowNeutral, shadowAccent, liner, lipEveryday, lipBold, lipLiner, neutrals (clothing).
const C = (...a) => a;
export const MAKEUP = {
  'light-spring': {
    blush: C(['#F6B49E', 'Soft peach'], ['#F4A58F', 'Light apricot'], ['#F29BA8', 'Warm petal pink']),
    shadowNeutral: C(['#F2DCC0', 'Champagne'], ['#D9B58E', 'Warm sand'], ['#B98B62', 'Golden taupe']),
    shadowAccent: C(['#7FD6D6', 'Soft aqua'], ['#F5A98C', 'Coral shimmer'], ['#A8DDB5', 'Mint']),
    combos: C(['Fresh daytime', ['#F2DCC0', '#D9B58E', '#B98B62']], ['Sea breeze', ['#F2DCC0', '#7FD6D6', '#8A6B4A']]),
    liner: C(['#6B4A32', 'Warm brown'], ['#8A6B4A', 'Golden brown'], ['#3F8C8C', 'Soft teal']),
    lipEveryday: C(['#EFA48F', 'Peachy nude'], ['#EC8F86', 'Light coral'], ['#E88B9A', 'Warm pink']),
    lipBold: C(['#F0705C', 'Bright coral'], ['#E5566B', 'Watermelon']),
    lipLiner: C(['#D98B76', 'Peach nude'], ['#D97A7F', 'Soft coral']),
    neutrals: C(['#F6E9D2', 'Cream'], ['#C9A57A', 'Camel'], ['#8E7A62', 'Warm taupe'], ['#7C9CB5', 'Soft navy-blue']),
  },
  'true-spring': {
    blush: C(['#F28C6B', 'Warm coral'], ['#F4A261', 'Apricot'], ['#EE7E6E', 'Salmon']),
    shadowNeutral: C(['#EBD3A8', 'Gold champagne'], ['#C99A5B', 'Honey bronze'], ['#8C5E34', 'Golden brown']),
    shadowAccent: C(['#00A896', 'Turquoise'], ['#7DB844', 'Spring green'], ['#E8963C', 'Marigold']),
    combos: C(['Golden hour', ['#EBD3A8', '#C99A5B', '#8C5E34']], ['Tropical', ['#EBD3A8', '#00A896', '#6B4426']]),
    liner: C(['#6B4426', 'Chestnut brown'], ['#2F6F5E', 'Deep teal'], ['#9A6A2F', 'Bronze']),
    lipEveryday: C(['#E58A66', 'Warm peach'], ['#E4745A', 'Soft coral'], ['#D9825B', 'Terracotta nude']),
    lipBold: C(['#F0462E', 'Poppy red'], ['#F26A21', 'Orange-red'], ['#E8504F', 'Tomato']),
    lipLiner: C(['#C9694B', 'Warm coral'], ['#B85C3A', 'Terracotta']),
    neutrals: C(['#F5E6C8', 'Warm ivory'], ['#C68B59', 'Camel'], ['#7A5230', 'Chocolate'], ['#2E6E73', 'Deep teal']),
  },
  'bright-spring': {
    blush: C(['#F77F73', 'Bright coral'], ['#F26A8F', 'Warm hot pink'], ['#F5896B', 'Vivid peach']),
    shadowNeutral: C(['#EAD9C4', 'Warm porcelain'], ['#B58A62', 'Clear bronze'], ['#5B3F30', 'Chocolate']),
    shadowAccent: C(['#00C2D1', 'Aqua'], ['#7B3FE4', 'Vivid violet'], ['#FFB000', 'Golden yellow']),
    combos: C(['Clear and bright', ['#EAD9C4', '#00C2D1', '#3B2F2F']], ['Orchid pop', ['#EAD9C4', '#B77BE0', '#3B2F2F']]),
    liner: C(['#3B2F2F', 'Dark chocolate'], ['#1E5FD0', 'Cobalt'], ['#00A3B0', 'Bright teal']),
    lipEveryday: C(['#EE7E78', 'Clear coral'], ['#E9739A', 'Warm rose'], ['#E8806B', 'Salmon pink']),
    lipBold: C(['#E8202A', 'Clear red'], ['#FF3E9D', 'Hot pink'], ['#FF5E3A', 'Vermilion']),
    lipLiner: C(['#D0566A', 'Warm rose'], ['#C73B3B', 'Clear red']),
    neutrals: C(['#FFFFFF', 'Warm white'], ['#3B2F2F', 'Dark chocolate'], ['#2B3A67', 'Navy'], ['#C9B28C', 'Warm stone']),
  },
  'light-summer': {
    blush: C(['#EDB4C0', 'Soft rose'], ['#F0B9C8', 'Powder pink'], ['#E8A9B0', 'Cool peach-pink']),
    shadowNeutral: C(['#E6DAD8', 'Pearl'], ['#C3B1B0', 'Soft taupe'], ['#9A8A8C', 'Cool mushroom']),
    shadowAccent: C(['#CDB8E8', 'Lavender'], ['#A8B8E0', 'Powder blue'], ['#E8B4C8', 'Rose quartz']),
    combos: C(['Soft daytime', ['#E6DAD8', '#C3B1B0', '#9A8A8C']], ['Lavender haze', ['#E6DAD8', '#CDB8E8', '#8F7F93']]),
    liner: C(['#6E6168', 'Soft taupe-brown'], ['#59627A', 'Slate'], ['#7C6A8C', 'Soft plum']),
    lipEveryday: C(['#DE9AA3', 'Soft rose'], ['#D8A0A8', 'Pink nude'], ['#D58A9C', 'Sheer raspberry']),
    lipBold: C(['#C95B84', 'Raspberry'], ['#D9728F', 'Cool pink']),
    lipLiner: C(['#BE8191', 'Rosy mauve'], ['#C47C8D', 'Soft raspberry']),
    neutrals: C(['#F2EEF2', 'Soft white'], ['#C9D3DB', 'Dove grey'], ['#8E97A8', 'Blue-grey'], ['#A89494', 'Rose taupe']),
  },
  'true-summer': {
    blush: C(['#D98BA2', 'Rose'], ['#E091AE', 'Cool pink'], ['#C97A96', 'Dusty rose']),
    shadowNeutral: C(['#DAD0D6', 'Cool pearl'], ['#A89AA6', 'Mauve taupe'], ['#7D6E7C', 'Cool brown-grey']),
    shadowAccent: C(['#7E9CCB', 'Cornflower'], ['#8B5E83', 'Soft plum'], ['#9DB8A5', 'Sage']),
    combos: C(['Rosy neutral', ['#DAD0D6', '#A89AA6', '#7D6E7C']], ['Blue hour', ['#DAD0D6', '#7E9CCB', '#5C6B8C']]),
    liner: C(['#5B4B58', 'Cool taupe-brown'], ['#4A5B80', 'Slate blue'], ['#6B4A68', 'Plum']),
    lipEveryday: C(['#C98096', 'Rosy mauve'], ['#C77A8E', 'Rose'], ['#BE7A90', 'Berry nude']),
    lipBold: C(['#A93B66', 'Raspberry'], ['#8E2F58', 'Berry'], ['#C23B72', 'Cool fuchsia']),
    lipLiner: C(['#A8607A', 'Rose berry'], ['#9A4E6C', 'Berry']),
    neutrals: C(['#E6E0EA', 'Soft white'], ['#6E7FA3', 'Blue-grey'], ['#5C6B8C', 'Slate navy'], ['#8D7B86', 'Cool taupe']),
  },
  'soft-summer': {
    blush: C(['#C98E9E', 'Dusty rose'], ['#B98298', 'Muted mauve'], ['#CC9A98', 'Soft rose-beige']),
    shadowNeutral: C(['#D8CDCB', 'Soft stone'], ['#A39694', 'Smoky taupe'], ['#6F6563', 'Grey-brown']),
    shadowAccent: C(['#7D5A7B', 'Smoky plum'], ['#8FA89B', 'Soft sage'], ['#6F7F8F', 'Dusty blue']),
    combos: C(['Blended taupe', ['#D8CDCB', '#A39694', '#6F6563']], ['Smoky plum', ['#D8CDCB', '#9A7A98', '#6A4E68']]),
    liner: C(['#5E5553', 'Soft charcoal-brown'], ['#4C5A68', 'Dusty navy'], ['#6A5068', 'Muted plum']),
    lipEveryday: C(['#BB808B', 'Mauve'], ['#C48B8F', 'Dusty rose'], ['#B9928F', 'Rose beige']),
    lipBold: C(['#A8546E', 'Muted berry'], ['#9A4560', 'Soft wine']),
    lipLiner: C(['#A06A76', 'Mauve rose'], ['#94586C', 'Muted berry']),
    neutrals: C(['#EDE6E2', 'Soft cream-white'], ['#A99A94', 'Greige'], ['#6F7F8F', 'Dusty blue-grey'], ['#5F5A63', 'Charcoal plum']),
  },
  'soft-autumn': {
    blush: C(['#D49A82', 'Soft terracotta'], ['#DBA58D', 'Dusty peach'], ['#C98E8A', 'Warm rose']),
    shadowNeutral: C(['#E4D3B8', 'Warm oat'], ['#B79A74', 'Soft bronze'], ['#7C6650', 'Warm taupe']),
    shadowAccent: C(['#8E9A6B', 'Sage olive'], ['#5F8D87', 'Muted teal'], ['#B07A5A', 'Soft copper']),
    combos: C(['Earthy everyday', ['#E4D3B8', '#B79A74', '#7C6650']], ['Olive glow', ['#E4D3B8', '#8E9A6B', '#5E5A3E']]),
    liner: C(['#5E4A3A', 'Soft brown'], ['#6A5E3A', 'Olive brown'], ['#4B6A68', 'Muted teal']),
    lipEveryday: C(['#C98C7C', 'Warm nude'], ['#C4807A', 'Muted rose'], ['#BE7F68', 'Soft terracotta']),
    lipBold: C(['#B25B4A', 'Brick rose'], ['#A94F4A', 'Muted red'], ['#B8664F', 'Burnt coral']),
    lipLiner: C(['#A8695A', 'Warm rose-brown'], ['#9C5A4C', 'Soft terracotta']),
    neutrals: C(['#EADFC8', 'Cream'], ['#B8A07C', 'Warm sand'], ['#7C6A50', 'Mocha'], ['#5E6B58', 'Moss']),
  },
  'true-autumn': {
    blush: C(['#D9805B', 'Terracotta'], ['#E39A63', 'Warm apricot'], ['#C96F4A', 'Burnt peach']),
    shadowNeutral: C(['#E0C79A', 'Golden sand'], ['#B98A52', 'Bronze'], ['#6E4A2C', 'Warm brown']),
    shadowAccent: C(['#6B7A2E', 'Olive'], ['#B87333', 'Copper'], ['#1F7A78', 'Deep teal']),
    combos: C(['Copper glow', ['#E0C79A', '#B87333', '#6E4A2C']], ['Forest', ['#E0C79A', '#6B7A2E', '#3E4A22']]),
    liner: C(['#5A3A22', 'Espresso brown'], ['#3F5A2E', 'Forest green'], ['#9A6A2F', 'Bronze']),
    lipEveryday: C(['#C9775A', 'Warm terracotta'], ['#BF6F52', 'Cinnamon'], ['#CF8662', 'Peachy brown']),
    lipBold: C(['#B03A25', 'Brick red'], ['#C4421E', 'Burnt orange-red'], ['#9A3324', 'Rust']),
    lipLiner: C(['#9E4E36', 'Brick'], ['#8E4630', 'Cinnamon brown']),
    neutrals: C(['#F0DDB4', 'Warm cream'], ['#8A4B2A', 'Rich brown'], ['#4B3A22', 'Dark olive-brown'], ['#2F5D3A', 'Forest green']),
  },
  'deep-autumn': {
    blush: C(['#B4573F', 'Deep terracotta'], ['#A9473F', 'Warm berry'], ['#C06A4A', 'Spiced copper']),
    shadowNeutral: C(['#CDB08A', 'Warm taupe'], ['#8A5E3A', 'Bronze brown'], ['#3E2A1E', 'Dark chocolate']),
    shadowAccent: C(['#3F4A2A', 'Forest'], ['#1F5E5B', 'Deep teal'], ['#9A3B2A', 'Burnt copper']),
    combos: C(['Chocolate bronze', ['#CDB08A', '#8A5E3A', '#3E2A1E']], ['Deep forest', ['#CDB08A', '#3F4A2A', '#2A2A1A']]),
    liner: C(['#2E1E16', 'Dark brown'], ['#1F3D2A', 'Deep green'], ['#5A3A22', 'Bronze brown']),
    lipEveryday: C(['#A9594A', 'Spiced rose'], ['#9C5043', 'Cinnamon'], ['#B26B58', 'Warm brown-rose']),
    lipBold: C(['#8B1E1E', 'Brick red'], ['#7A1F2B', 'Deep red-wine'], ['#6E2B2B', 'Chocolate cherry']),
    lipLiner: C(['#7E3A30', 'Deep brick'], ['#6A3030', 'Chocolate rose']),
    neutrals: C(['#E8D5B0', 'Warm ivory'], ['#4A2C20', 'Dark chocolate'], ['#2C3E2D', 'Deep forest'], ['#6B4F3A', 'Cocoa']),
  },
  'deep-winter': {
    blush: C(['#B65A78', 'Deep rose'], ['#A84660', 'Burgundy pink'], ['#C06A8A', 'Cool berry rose']),
    shadowNeutral: C(['#BFB5BD', 'Cool grey-taupe'], ['#6C5F6B', 'Charcoal plum'], ['#26212A', 'Soft black']),
    shadowAccent: C(['#2D1E5F', 'Midnight violet'], ['#0B6E4F', 'Emerald'], ['#14213D', 'Navy']),
    combos: C(['Smoky charcoal', ['#BFB5BD', '#6C5F6B', '#26212A']], ['Emerald night', ['#BFB5BD', '#0B6E4F', '#14213D']]),
    liner: C(['#1A1A1F', 'Black'], ['#14213D', 'Navy'], ['#3A2A4E', 'Deep plum']),
    lipEveryday: C(['#A8506C', 'Deep rose'], ['#9A4560', 'Berry rose'], ['#B0607A', 'Cool rosewood']),
    lipBold: C(['#7A1236', 'Black cherry'], ['#B0003A', 'Blue-red'], ['#5A0F2C', 'Deep wine']),
    lipLiner: C(['#7A2C48', 'Deep berry'], ['#6A1E3A', 'Plum wine']),
    neutrals: C(['#F5F5F5', 'Crisp white'], ['#111111', 'Black'], ['#14213D', 'Navy'], ['#4A4A55', 'Charcoal']),
  },
  'true-winter': {
    blush: C(['#D86A94', 'Cool pink'], ['#C8527F', 'Blue-rose'], ['#D9708D', 'Berry pink']),
    shadowNeutral: C(['#D6D0DA', 'Icy grey'], ['#8D8796', 'Cool taupe'], ['#2B2830', 'Charcoal']),
    shadowAccent: C(['#1E3A8A', 'Sapphire'], ['#5B2A86', 'Violet'], ['#E8B4D0', 'Icy pink']),
    combos: C(['Icy smoky', ['#D6D0DA', '#8D8796', '#2B2830']], ['Jewel', ['#D6D0DA', '#5B2A86', '#1E3A8A']]),
    liner: C(['#111111', 'Black'], ['#2B2830', 'Charcoal'], ['#1E3A8A', 'Sapphire']),
    lipEveryday: C(['#C45A82', 'Cool rose'], ['#C9648C', 'Cool pink'], ['#B8587A', 'Berry rose']),
    lipBold: C(['#DC143C', 'Blue-red'], ['#D6336C', 'Fuchsia'], ['#A0124A', 'Deep raspberry']),
    lipLiner: C(['#A8305A', 'Raspberry'], ['#B02448', 'Cool red']),
    neutrals: C(['#FFFFFF', 'Pure white'], ['#111111', 'Black'], ['#1E3A8A', 'Royal navy'], ['#C0C8D8', 'Icy grey']),
  },
  'bright-winter': {
    blush: C(['#E0508A', 'Vivid cool pink'], ['#D9457A', 'Raspberry'], ['#E8607A', 'Clear rose']),
    shadowNeutral: C(['#E4DCE8', 'Icy lilac-white'], ['#8F8A9A', 'Cool grey'], ['#1A1A1F', 'Black']),
    shadowAccent: C(['#1E6BFF', 'Electric blue'], ['#8A2BE2', 'Violet'], ['#00A86B', 'Emerald']),
    combos: C(['Black and ice', ['#E4DCE8', '#8F8A9A', '#1A1A1F']], ['Electric', ['#E4DCE8', '#1E6BFF', '#1A1A1F']]),
    liner: C(['#111111', 'Black'], ['#1E3FA8', 'Cobalt'], ['#00826A', 'Deep emerald']),
    lipEveryday: C(['#D45A86', 'Clear rose'], ['#D0507E', 'Bright berry rose'], ['#C4607E', 'Cool pink']),
    lipBold: C(['#E10600', 'True red'], ['#E0007A', 'Fuchsia'], ['#B0005A', 'Vivid berry']),
    lipLiner: C(['#B02458', 'Clear berry'], ['#C21F2A', 'True red']),
    neutrals: C(['#FFFFFF', 'Pure white'], ['#111111', 'Black'], ['#1A2A6B', 'Ink navy'], ['#9AA5B8', 'Cool silver-grey']),
  },
};

// -------------------------------------------------- season in plain language ----
const TDESC = (T) => (T > 0.55 ? { w: 'warm', t: 'Your skin, hair and eyes lean golden or yellow-based.', fav: 'golden, peachy and earthy shades' }
  : T > 0.2 ? { w: 'warm-leaning', t: 'Your coloring leans a little golden, but not strongly.', fav: 'softly warm shades' }
  : T < -0.55 ? { w: 'cool', t: 'Your skin, hair and eyes lean pink, rosy or blue-based.', fav: 'rosy, blue-based and icy shades' }
  : T < -0.2 ? { w: 'cool-leaning', t: 'Your coloring leans a little pink or blue-based, but not strongly.', fav: 'softly cool shades' }
  : { w: 'neutral', t: 'Your coloring sits between warm and cool.', fav: 'balanced shades' });
const DDESC = (D) => (D > 0.4 ? { w: 'deep', t: 'You have strong depth, so your hair and eyes are fairly dark compared with your skin.' }
  : D < -0.4 ? { w: 'light', t: 'You have light overall coloring, with softer contrast between hair, eyes and skin.' } : { w: 'medium', t: 'Your coloring is medium in depth.' });
const CDESC = (C) => (C > 0.4 ? { w: 'bright and clear', t: 'Your coloring is clear and vivid, so clean saturated colors flatter you.' }
  : C < -0.4 ? { w: 'soft and muted', t: 'Your coloring is soft and blended, so gentle, slightly grayed colors flatter you.' } : { w: 'balanced', t: 'Your coloring is neither very vivid nor very soft.' });

/** What a season means, in everyday words, based on the user's own estimate. */
export function explainSeason(season, est) {
  const e = est || { T: season.T, D: season.D, C: season.C };
  const t = TDESC(e.T), d = DDESC(e.D), c = CDESC(e.C);
  const lead = { T: t.w, D: d.w, C: c.w }[season.P];
  return {
    summary: `${season.name} belongs to the ${season.family} family, and it is the ${lead} one. ${season.blurb}`,
    points: [
      `Undertone: ${t.w}. ${t.t}`,
      `Depth: ${d.w}. ${d.t}`,
      `Clarity: ${c.w}. ${c.t}`,
    ],
    why: `Colors in ${season.name} share your ${t.w} undertone and ${c.w} clarity, so they sit in harmony with your skin, hair and eyes instead of fighting them. That is why ${t.fav} tend to look natural on you.`,
    avoidWhy: `Shades from the opposite end (very different in temperature, brightness or depth) can make skin look sallow, gray or shadowed next to your face. You can still wear them lower down, or away from your face.`,
  };
}

/** Season-specific makeup, or null if no season. */
export const makeupFor = (seasonId) => MAKEUP[seasonId] || null;
