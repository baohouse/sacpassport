#!/usr/bin/env node
/**
 * Candidate restaurants per culture from Google Places text search, Greater Sacramento only.
 *
 *   GOOGLE_MAPS_API_KEY=… node scripts/find-restaurants.mjs              # search + print top candidates
 *   … --id ethiopian,lao        limit to these cultures
 *   … --top 8                   rows printed per culture (default 6)
 *   … --cached                  reprint from the last run without calling the API
 *
 * Price: prefer $$–$$$ (listed first); fall back to $ or $$$$ only when a culture has no
 * fitting restaurant in that band.
 *
 * The ranking is only a shortlist. A person picks up to three per culture and writes
 * { name, city, placeId } into that culture's `restaurants` array in data/cultures.json.
 * Places content other than the place ID may not be stored, so ratings stay in the
 * gitignored cache and never go into the site data.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cachePath = path.join(root, 'scripts', '.restaurant-candidates.json');

const args = process.argv.slice(2);
const argValue = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
const onlyIds = argValue('--id') ? new Set(argValue('--id').split(',')) : null;
const top = Number(argValue('--top') || 6);
const cached = args.includes('--cached');

const apiKey = process.env.GOOGLE_MAPS_API_KEY;
if (!apiKey && !cached) {
  console.error('GOOGLE_MAPS_API_KEY is not set.');
  process.exit(1);
}

// Sacramento, Yolo, Placer, and west-slope El Dorado, plus Lodi. The box is the
// search area; the county check drops Solano, Amador, Yuba, and the rest of San Joaquin.
const REGION = {
  rectangle: {
    low: { latitude: 38.08, longitude: -121.95 },
    high: { latitude: 39.1, longitude: -120.7 },
  },
};
const COUNTIES = new Set(['Sacramento County', 'Yolo County', 'Placer County', 'El Dorado County']);
const EXTRA_CITIES = new Set(['Lodi']);

function component(place, type) {
  return place.addressComponents?.find((c) => c.types?.includes(type))?.longText || '';
}

function inRegion(place) {
  return COUNTIES.has(component(place, 'administrative_area_level_2')) ||
    EXTRA_CITIES.has(component(place, 'locality'));
}

// Search terms per culture id. Cultures with no cuisine of their own (Sikh, Iu Mien
// without a listed restaurant) are left out rather than forced onto a neighbor's food.
const QUERIES = {
  romanian: ['Romanian restaurant'],
  greek: ['Greek restaurant'],
  german: ['German restaurant'],
  fijian: ['Fijian restaurant', 'Fiji Indian restaurant'],
  native: ['Native American restaurant'],
  jewish: ['Jewish deli', 'kosher restaurant'],
  hmong: ['Hmong restaurant'],
  korean: ['Korean restaurant', 'Korean BBQ'],
  portuguese: ['Portuguese restaurant', 'Portuguese bakery'],
  filipino: ['Filipino restaurant'],
  japanese: ['Japanese restaurant', 'izakaya', 'ramen'],
  indian: ['Indian restaurant'],
  ukrainian: ['Ukrainian restaurant'],
  polish: ['Polish restaurant', 'Polish deli'],
  hawaiian: ['Hawaiian restaurant', 'Samoan Tongan restaurant'],
  peruvian: ['Peruvian restaurant'],
  'iu-mien': ['Mien restaurant'],
  chinese: ['Chinese restaurant', 'dim sum', 'Sichuan restaurant'],
  'chinese-american': ['Chinese American restaurant', 'chop suey', 'old school Chinese restaurant'],
  'black-american': ['soul food restaurant', 'Southern restaurant', 'fried chicken and waffles', 'Cajun Creole restaurant'],
  'cajun-creole': ['Cajun restaurant', 'Creole restaurant', 'Louisiana restaurant', 'gumbo', 'po boy'],
  nigerian: ['Nigerian restaurant'],
  mexican: ['Mexican restaurant', 'taqueria', 'Oaxacan restaurant'],
  brazilian: ['Brazilian restaurant'],
  colombian: ['Colombian restaurant'],
  salvadoran: ['Salvadoran restaurant pupuseria'],
  armenian: ['Armenian restaurant'],
  punjabi: ['Punjabi restaurant'],
  egyptian: ['Egyptian restaurant', 'koshari'],
  italian: ['Italian restaurant'],
  serbian: ['Serbian restaurant'],
  scottish: ['Scottish restaurant'],
  irish: ['Irish pub'],
  croatian: ['Croatian restaurant'],
  pakistani: ['Pakistani restaurant'],
  australian: ['Australian restaurant', 'Australian meat pie'],
  spanish: ['Spanish restaurant tapas'],
  lebanese: ['Lebanese restaurant'],
  thai: ['Thai restaurant'],
  bengali: ['Bangladeshi restaurant'],
  tamil: ['South Indian restaurant dosa', 'Tamil restaurant'],
  marathi: ['Maharashtrian restaurant'],
  malayali: ['Kerala restaurant'],
  slavic: ['Russian restaurant'],
  caribbean: ['Caribbean restaurant', 'Jamaican restaurant'],
  french: ['French restaurant'],
  indonesian: ['Indonesian restaurant'],
  ethiopian: ['Ethiopian restaurant'],
  sudanese: ['Sudanese restaurant'],
  mongolian: ['Mongolian restaurant'],
  persian: ['Persian restaurant'],
  cambodian: ['Cambodian restaurant'],
  afghan: ['Afghan restaurant'],
  nicaraguan: ['Nicaraguan restaurant'],
  moldovan: ['Moldovan restaurant'],
  bosnian: ['Bosnian restaurant'],
  chaldean: ['Iraqi restaurant', 'Chaldean restaurant'],
  lao: ['Lao restaurant'],
  turkish: ['Turkish restaurant'],
  swedish: ['Swedish restaurant'],
  basque: ['Basque restaurant'],
  czech: ['Czech restaurant', 'kolache'],
  kurdish: ['Kurdish restaurant'],
  nepali: ['Nepalese restaurant'],
  taiwanese: ['Taiwanese restaurant'],
  burmese: ['Burmese restaurant'],
  belarusian: ['Belarusian restaurant'],
  tibetan: ['Tibetan restaurant'],
  finnish: ['Finnish restaurant'],
  chilean: ['Chilean restaurant'],
  maya: ['Yucatecan restaurant', 'Guatemalan restaurant'],
  moroccan: ['Moroccan restaurant'],
  vietnamese: ['Vietnamese restaurant', 'pho', 'bun bo Hue', 'com tam'],
};

// Google cuisine types that count as this culture's food. Candidates with a match list
// first; a few without one still print (marked ?) because small places are often typed
// only `restaurant`.
const TYPE_MATCH = {
  greek: /greek/,
  german: /german/,
  korean: /korean/,
  filipino: /filipino/,
  japanese: /japanese|sushi|ramen|yakitori|tonkatsu/,
  indian: /indian/,
  ukrainian: /ukrainian/,
  polish: /polish/,
  hawaiian: /hawaiian/,
  peruvian: /peruvian/,
  chinese: /chinese|cantonese|dim_sum|sichuan|szechuan|hunan/,
  'chinese-american': /chinese|cantonese/,
  'black-american': /soul|southern|cajun|creole|barbecue/,
  'cajun-creole': /cajun|creole|louisiana/,
  mexican: /mexican/,
  brazilian: /brazilian/,
  colombian: /colombian/,
  italian: /italian/,
  irish: /irish/,
  pakistani: /pakistani/,
  australian: /australian/,
  spanish: /spanish|tapas/,
  lebanese: /lebanese/,
  thai: /thai/,
  bengali: /bangladeshi/,
  tamil: /south_indian/,
  slavic: /russian|ukrainian|eastern_european/,
  caribbean: /caribbean|jamaican|trinidad/,
  french: /french/,
  indonesian: /indonesian/,
  ethiopian: /ethiopian/,
  persian: /persian/,
  cambodian: /cambodian/,
  afghan: /afghani/,
  turkish: /turkish/,
  czech: /czech/,
  nepali: /nepal|tibetan/,
  taiwanese: /taiwanese/,
  burmese: /burmese/,
  tibetan: /tibetan/,
  moroccan: /moroccan/,
  basque: /basque/,
  swedish: /scandinavian|swedish/,
  vietnamese: /vietnamese/,
};
const EATERY = /restaurant|cafe|bakery|deli|pub|diner|bistro|meal_takeaway|food_court|bar_and_grill/;

const FIELDS = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.addressComponents',
  'places.rating',
  'places.userRatingCount',
  'places.primaryType',
  'places.types',
  'places.businessStatus',
  'places.priceLevel',
];

const PRICE = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};
// $$ and $$$ are preferred; $ and $$$$ only when a culture has nothing in that band.
const inPriceBand = (row) => row.price === 2 || row.price === 3;

async function searchPage(textQuery, pageToken) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': [...FIELDS, 'nextPageToken'].join(','),
    },
    body: JSON.stringify({
      textQuery,
      pageSize: 20,
      locationRestriction: REGION,
      ...(pageToken ? { pageToken } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Places ${res.status}: ${await res.text()}`);
  return res.json();
}

async function search(textQuery, pages = 3) {
  const places = [];
  let token = null;
  for (let page = 0; page < pages; page += 1) {
    const data = await searchPage(textQuery, token);
    places.push(...(data.places || []));
    token = data.nextPageToken;
    if (!token) break;
  }
  return places;
}

function cityOf(place) {
  const locality = component(place, 'locality');
  if (locality) return locality;
  const parts = (place.formattedAddress || '').split(', ');
  return parts.length >= 3 ? parts[parts.length - 3] : '';
}

// Bayesian average: a 4.8 from 40 reviews should not outrank a 4.6 from 2,000.
const PRIOR_REVIEWS = 150;
const PRIOR_RATING = 4.3;
function score({ rating, reviews }) {
  return (reviews * (rating || 0) + PRIOR_REVIEWS * PRIOR_RATING) / (reviews + PRIOR_REVIEWS);
}

async function candidatesFor(id) {
  const byId = new Map();
  for (const query of QUERIES[id]) {
    for (const place of await search(query)) {
      if (place.businessStatus && place.businessStatus !== 'OPERATIONAL') continue;
      if (!inRegion(place)) continue;
      byId.set(place.id, {
        placeId: place.id,
        name: place.displayName?.text,
        city: cityOf(place),
        address: place.formattedAddress,
        rating: place.rating ?? null,
        reviews: place.userRatingCount ?? 0,
        price: PRICE[place.priceLevel] ?? null,
        primaryType: place.primaryType || '',
        types: place.types || [],
        query,
      });
    }
  }
  return [...byId.values()]
    .map((row) => ({ ...row, score: Number(score(row).toFixed(3)) }))
    .sort((a, b) => b.score - a.score);
}

const ids = Object.keys(QUERIES).filter((id) => !onlyIds || onlyIds.has(id));
let results = {};
if (cached) {
  results = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
} else {
  if (fs.existsSync(cachePath)) results = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  for (const id of ids) {
    try {
      results[id] = await candidatesFor(id);
    } catch (error) {
      console.error(`${id}: ${error.message}`);
    }
  }
  fs.writeFileSync(cachePath, `${JSON.stringify(results, null, 2)}\n`);
}

const priceLabel = (row) => (row.price == null ? '?' : '$'.repeat(Math.max(row.price, 1)));
const line = (row, mark) =>
  `${mark} ${row.score.toFixed(2)}  ${String(row.rating ?? '-').padEnd(3)} (${String(row.reviews).padStart(5)})  ${priceLabel(row).padEnd(4)}  ${row.name} — ${row.city}  [${row.primaryType}]  ${row.placeId}`;

for (const id of ids) {
  const rows = (results[id] || [])
    .filter((row) => row.types.some((type) => EATERY.test(type)))
    .sort((a, b) => inPriceBand(b) - inPriceBand(a));
  const match = TYPE_MATCH[id];
  const typed = match ? rows.filter((row) => row.types.some((type) => match.test(type))) : [];
  const untyped = match ? rows.filter((row) => !typed.includes(row)) : rows;
  console.log(`\n## ${id}  (${typed.length} typed, ${untyped.length} other)`);
  for (const row of typed.slice(0, top)) console.log(line(row, '*'));
  for (const row of untyped.slice(0, match ? 4 : top)) console.log(line(row, '?'));
}
