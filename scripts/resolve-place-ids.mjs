#!/usr/bin/env node
/**
 * Look up a Google Maps place ID for each card venue ("{place}, {city}, CA").
 *
 *   GOOGLE_MAPS_API_KEY=… node scripts/resolve-place-ids.mjs           # dry run: print matches
 *   GOOGLE_MAPS_API_KEY=… node scripts/resolve-place-ids.mjs --write   # save placeId into data/cultures.json
 *   … --all       re-check cards that already have a placeId
 *   … --id lebanese,german-saktoberfest
 *
 * Only cards without a placeId are looked up unless --all. Review the dry run before --write:
 * a street, a plaza, or a park name can match the wrong pin.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = path.join(root, 'data', 'cultures.json');

const apiKey = process.env.GOOGLE_MAPS_API_KEY;
if (!apiKey) {
  console.error('GOOGLE_MAPS_API_KEY is not set.');
  process.exit(1);
}

const write = process.argv.includes('--write');
const all = process.argv.includes('--all');
const idArg = process.argv[process.argv.indexOf('--id') + 1];
const onlyIds = process.argv.includes('--id') && idArg ? new Set(idArg.split(',')) : null;

const SACRAMENTO = { latitude: 38.5816, longitude: -121.4944 };

async function searchPlace(textQuery) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress',
    },
    body: JSON.stringify({
      textQuery,
      pageSize: 1,
      locationBias: { circle: { center: SACRAMENTO, radius: 50000 } },
    }),
  });
  if (!res.ok) throw new Error(`Places ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.places?.[0] || null;
}

/** Insert placeId right after city so the JSON stays readable. */
function withPlaceId(item, placeId) {
  const next = {};
  for (const [key, value] of Object.entries(item)) {
    if (key === 'placeId') continue;
    next[key] = value;
    if (key === 'city') next.placeId = placeId;
  }
  if (!('placeId' in next)) next.placeId = placeId;
  return next;
}

const cultures = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

async function resolve(item) {
  if (onlyIds && !onlyIds.has(item.id)) return item;
  if (item.mapPoint) return item;
  if (item.placeId && !all) return item;
  const query = [item.place, item.city, 'CA'].filter(Boolean).join(', ');
  const match = await searchPlace(query);
  if (!match) {
    console.log(`${item.id.padEnd(24)} NO MATCH  ${query}`);
    return item;
  }
  const changed = match.id !== item.placeId ? '' : '  (unchanged)';
  console.log(
    `${item.id.padEnd(24)} ${query}\n${''.padEnd(25)}→ ${match.displayName?.text} · ${match.formattedAddress}${changed}`,
  );
  return withPlaceId(item, match.id);
}

const next = [];
for (const item of cultures) {
  const resolved = await resolve(item);
  if (Array.isArray(resolved.alternates)) {
    const alternates = [];
    for (const alt of resolved.alternates) alternates.push(await resolve(alt));
    resolved.alternates = alternates;
  }
  next.push(resolved);
}

if (write) {
  fs.writeFileSync(dataPath, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`\nWrote ${dataPath}`);
} else {
  console.log('\nDry run. Add --write to save.');
}
