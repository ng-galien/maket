/**
 * Duotone SVG illustrations for the demo documents — strictly the site
 * palette (ink #101c19, teal #00a99d, mint #a3f2ea, paper #fbfaf6). Kept as
 * data URIs so scenarios and generated starters stay self-contained.
 */

const INK = "#101c19";
const TEAL = "#00a99d";
const MINT = "#a3f2ea";
const PAPER = "#fbfaf6";

export const svgUri = (body: string, viewBox = "0 0 64 64"): string =>
	`data:image/svg+xml,${encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`,
	)}`;

/** Per-product duotone icons for the price-label collection. */
export const PRODUCT_ICONS: Record<string, string> = {
	tomato: svgUri(
		`<circle cx="32" cy="38" r="19" fill="${TEAL}"/><circle cx="26" cy="34" r="5" fill="${MINT}" opacity="0.55"/><path d="M32 20 C28 14 24 13 20 15 C26 16 28 18 29 21 Z" fill="${INK}"/><path d="M32 20 C36 14 40 13 44 15 C38 16 36 18 35 21 Z" fill="${INK}"/><rect x="30.6" y="12" width="2.8" height="9" rx="1.4" fill="${INK}"/>`,
	),
	honey: svgUri(
		`<rect x="18" y="22" width="28" height="30" rx="7" fill="${MINT}"/><rect x="18" y="30" width="28" height="10" fill="${TEAL}"/><rect x="16" y="14" width="32" height="8" rx="3" fill="${INK}"/><path d="M32 56 c-3 0 -4 -2.4 -4 -4 0 -2.6 4 -6 4 -6 s4 3.4 4 6 c0 1.6 -1 4 -4 4 Z" fill="${TEAL}"/>`,
	),
	cheese: svgUri(
		`<path d="M8 40 L56 26 L56 48 L8 48 Z" fill="${MINT}"/><path d="M8 40 L56 26 L52 22 L10 36 Z" fill="${TEAL}"/><circle cx="24" cy="43" r="3" fill="${PAPER}"/><circle cx="38" cy="40" r="2.4" fill="${PAPER}"/><circle cx="47" cy="43" r="2" fill="${PAPER}"/>`,
	),
	bread: svgUri(
		`<ellipse cx="32" cy="40" rx="22" ry="12" fill="${TEAL}"/><path d="M14 36 Q32 22 50 36 Q50 30 44 27 Q36 22 24 25 Q16 28 14 36 Z" fill="${MINT}"/><path d="M24 33 l5 -5 M32 31 l5 -5 M40 32 l5 -5" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>`,
	),
	cider: svgUri(
		`<rect x="26" y="8" width="12" height="10" rx="2" fill="${INK}"/><path d="M26 18 C22 24 20 28 20 34 L20 52 A4 4 0 0 0 24 56 L40 56 A4 4 0 0 0 44 52 L44 34 C44 28 42 24 38 18 Z" fill="${TEAL}"/><rect x="20" y="36" width="24" height="12" fill="${MINT}"/>`,
	),
	oil: svgUri(
		`<rect x="28" y="6" width="8" height="8" rx="2" fill="${INK}"/><path d="M28 14 C26 20 22 24 22 32 L22 52 A4 4 0 0 0 26 56 L38 56 A4 4 0 0 0 42 52 L42 32 C42 24 38 20 36 14 Z" fill="${MINT}"/><rect x="22" y="34" width="20" height="12" fill="${TEAL}"/><circle cx="32" cy="40" r="3.4" fill="${PAPER}"/>`,
	),
};

/** Fixed produce crate for the price-label image slot. */
export const PRODUCE_CRATE = svgUri(
	`<rect x="8" y="28" width="48" height="26" rx="3" fill="${TEAL}"/><path d="M8 34 L56 34 M8 42 L56 42" stroke="${PAPER}" stroke-width="2" opacity="0.6"/><circle cx="22" cy="22" r="9" fill="${INK}"/><circle cx="38" cy="19" r="10" fill="${MINT}"/><circle cx="50" cy="24" r="7" fill="${INK}"/><path d="M38 9 C36 5 32 4 29 6 C33 7 35 8 36 10 Z" fill="${TEAL}"/>`,
);

/** Grocery basket hero for the wireframe onboarding screen. */
export const BASKET_HERO = svgUri(
	`<rect width="160" height="100" fill="${MINT}" opacity="0.35"/><path d="M40 46 L120 46 L110 84 A6 6 0 0 1 104 88 L56 88 A6 6 0 0 1 50 84 Z" fill="${TEAL}"/><path d="M60 46 L74 26 M100 46 L86 26" stroke="${INK}" stroke-width="4" stroke-linecap="round"/><circle cx="66" cy="40" r="9" fill="${INK}"/><circle cx="84" cy="36" r="10" fill="${PAPER}"/><circle cx="101" cy="40" r="8" fill="${INK}"/><path d="M52 58 L108 58 M55 68 L105 68 M58 78 L102 78" stroke="${PAPER}" stroke-width="2.4" opacity="0.7"/>`,
	"0 0 160 100",
);

/** Line-art plate for the bistro menu masthead. */
export const MENU_PLATE = svgUri(
	`<circle cx="80" cy="50" r="40" fill="none" stroke="${INK}" stroke-width="2.5"/><circle cx="80" cy="50" r="28" fill="none" stroke="${TEAL}" stroke-width="2"/><path d="M62 50 Q80 30 98 50 Q80 62 62 50 Z" fill="${TEAL}"/><circle cx="72" cy="48" r="2.6" fill="${PAPER}"/><path d="M98 50 L110 44 L110 56 Z" fill="${INK}"/><path d="M24 30 L24 70 M18 30 L18 44 Q18 48 24 48 M30 30 L30 44 Q30 48 24 48" stroke="${INK}" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M136 30 L136 70 M136 30 Q128 34 128 44 Q128 52 136 52" stroke="${INK}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`,
	"0 0 160 100",
);

/** Waves + moon poster artwork (teal night tide). */
export const POSTER_WAVES = svgUri(
	`<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${TEAL}"/><stop offset="1" stop-color="#72e2d7"/></linearGradient></defs><circle cx="320" cy="70" r="55" fill="${MINT}" opacity="0.9"/><path d="M0 220 Q100 160 200 210 T400 200 V300 H0 Z" fill="url(#g)" opacity="0.45"/><path d="M0 250 Q120 200 240 245 T400 240 V300 H0 Z" fill="url(#g)" opacity="0.85"/>`,
	"0 0 400 300",
);

/** Trumpet mark for the social announcement cards. */
export const TRUMPET_MARK = svgUri(
	`<path d="M10 26 L34 20 L34 44 L10 38 Z" fill="${TEAL}"/><rect x="34" y="24" width="6" height="16" fill="${MINT}"/><path d="M46 18 Q56 32 46 46" stroke="${MINT}" stroke-width="3.4" fill="none" stroke-linecap="round"/><path d="M50 12 Q64 32 50 52" stroke="${TEAL}" stroke-width="3.4" fill="none" stroke-linecap="round"/><rect x="14" y="38" width="5" height="12" rx="2" fill="${INK}"/>`,
);
