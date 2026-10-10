#!/usr/bin/env node
/**
 * Build data/population.json: each culture's population in Greater Sacramento
 * (Sacramento-Roseville-Folsom metro: Sacramento, Placer, El Dorado, Yolo).
 *
 *   node scripts/build-population.mjs            # print the table, write nothing
 *   node scripts/build-population.mjs --write    # save data/population.json
 *
 * Sources are the Census Bureau's keyless ACS 5-year files (api.census.gov now needs a key):
 * table-based summary files for detailed race, Hispanic origin, and ancestry, and the
 * California person microdata (PUMS) for language spoken at home and ancestries the tables
 * do not break out. Downloads are cached in $ACS_CACHE (default: the OS temp dir); the
 * PUMS zip is about 270 MB and needs `unzip` on PATH.
 *
 * Every culture in data/cultures.json needs an entry in SOURCES below, even if it is
 * `none` (no reliable count). The script fails on an unmapped culture.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const culturesPath = path.join(root, 'data', 'cultures.json');
const outPath = path.join(root, 'data', 'population.json');

const ACS_YEAR = 2024;
const VINTAGE = `ACS ${ACS_YEAR - 4}–${ACS_YEAR} 5-year`;
const CBSA = '40900';
const METRO_GEO_ID = `310M700US${CBSA}`;
const METRO_COUNTIES = new Set(['017', '061', '067', '113']);
const SUMMARY_BASE = `https://www2.census.gov/programs-surveys/acs/summary_file/${ACS_YEAR}/table-based-SF/data/5YRData`;
const PUMS_URL = `https://www2.census.gov/programs-surveys/acs/data/pums/${ACS_YEAR}/5-Year/csv_pca.zip`;
const PUMA_CROSSWALK_URL = 'https://www2.census.gov/geo/docs/maps-data/data/rel2020/2020_Census_Tract_to_2020_PUMA.txt';
const PUMS_INFO_URL = 'https://www.census.gov/programs-surveys/acs/microdata.html';
const cacheDir = process.env.ACS_CACHE || path.join(os.tmpdir(), `sacpassport-acs-${ACS_YEAR}`);

const write = process.argv.includes('--write');

const table = (id, lines, measure, extra = {}) => ({ kind: 'table', id, lines, measure, ...extra });
const anc = (codes, measure, extra = {}) => ({ kind: 'pums', field: 'anc', codes, measure, ...extra });
const lang = (codes, measure, extra = {}) => ({ kind: 'pums', field: 'lang', codes, measure, ...extra });
const sameAs = (id, extra = {}) => ({ kind: 'sameAs', id, ...extra });
const estimate = (fields) => ({ kind: 'estimate', ...fields });
const none = (note) => ({ kind: 'none', note });

// Table lines are B-table line numbers in the ACS summary file shells. A negative line is subtracted.
// PUMS ancestry codes match either reported ancestry (ANC1P or ANC2P); language is LANP (age 5+).
const SOURCES = {
  romanian: table('B04006', [63], 'Romanian ancestry'),
  greek: table('B04006', [44], 'Greek ancestry'),
  german: table('B04006', [42], 'German ancestry'),
  fijian: table('B02019', [11], 'Fijian, alone or in any combination', {
    note: 'Indo-Fijians often answer Asian Indian, so this undercounts Fiji’s community.',
  }),
  native: table('B02010', [1], 'American Indian and Alaska Native, alone or in any combination'),
  jewish: estimate({
    count: 23750,
    measure: 'Jewish population, Jewish Federation of the Sacramento Region service area',
    source: 'American Jewish Year Book 2024 (Sheskin & Dashefsky)',
    url: 'https://www.jewishdatabank.org/api/download/?mediaId=bjdb%5CUnitedStatesJewishPopulation_2024_AJYB.pdf&studyId=1398',
    note: 'The Census does not ask religion. The Federation’s area also takes in Nevada and Butte counties.',
  }),
  hmong: table('B02018', [3], 'Hmong, alone or in any combination'),
  korean: table('B02018', [5], 'Korean, alone or in any combination'),
  portuguese: table('B04006', [62], 'Portuguese ancestry'),
  filipino: table('B02018', [12], 'Filipino, alone or in any combination'),
  japanese: table('B02018', [4], 'Japanese, alone or in any combination'),
  indian: table('B02018', [21], 'Asian Indian, alone or in any combination'),
  ukrainian: table('B04006', [92], 'Ukrainian ancestry'),
  polish: table('B04006', [61], 'Polish ancestry'),
  hawaiian: table('B02019', [1, -11], 'Native Hawaiian and Pacific Islander groups other than Fijian', {
    note: 'Groups tallied, so a person who reports two groups counts twice.',
  }),
  peruvian: table('B03001', [23], 'Peruvian (Hispanic origin)'),
  'iu-mien': table('B02018', [16], 'Mien, alone or in any combination'),
  chinese: table('B02018', [2], 'Chinese (except Taiwanese), alone or in any combination'),
  nigerian: table('B04006', [79], 'Nigerian ancestry'),
  mexican: table('B03001', [4], 'Mexican (Hispanic origin)'),
  brazilian: table('B04006', [22], 'Brazilian ancestry'),
  colombian: table('B03001', [20], 'Colombian (Hispanic origin)'),
  salvadoran: table('B03001', [14], 'Salvadoran (Hispanic origin)'),
  armenian: table('B04006', [16], 'Armenian ancestry'),
  punjabi: lang([1420], 'Speak Punjabi at home (age 5+)'),
  egyptian: table('B04006', [7], 'Egyptian ancestry'),
  italian: table('B04006', [51], 'Italian ancestry'),
  serbian: table('B04006', [68], 'Serbian ancestry'),
  scottish: table('B04006', [67], 'Scottish ancestry'),
  irish: table('B04006', [49], 'Irish ancestry'),
  sikh: sameAs('punjabi', {
    note: 'The Census does not ask religion, so this uses Punjabi speakers, who also include Hindu and Muslim Punjabis.',
  }),
  croatian: table('B04006', [29], 'Croatian ancestry'),
  pakistani: table('B02018', [25], 'Pakistani, alone or in any combination'),
  australian: table('B04006', [18], 'Australian ancestry'),
  spanish: table('B03001', [28], 'Spaniard (Hispanic origin)'),
  lebanese: table('B04006', [10], 'Lebanese ancestry'),
  thai: table('B02018', [18], 'Thai, alone or in any combination'),
  bengali: lang([1380], 'Speak Bengali at home (age 5+)'),
  tamil: lang([1765], 'Speak Tamil at home (age 5+)'),
  marathi: lang([1440], 'Speak Marathi at home (age 5+)'),
  malayali: lang([1750], 'Speak Malayalam at home (age 5+)'),
  slavic: anc([148, 178], 'Russian or Slavic ancestry'),
  caribbean: table('B04006', [94], 'West Indian ancestry (except Hispanic groups)'),
  french: table('B04006', [40], 'French ancestry (except Basque)'),
  indonesian: table('B02018', [13], 'Indonesian, alone or in any combination'),
  ethiopian: table('B04006', [75], 'Ethiopian ancestry'),
  sudanese: table('B04006', [84], 'Sudanese ancestry'),
  mongolian: table('B02018', [6], 'Mongolian, alone or in any combination'),
  persian: table('B04006', [48], 'Iranian ancestry'),
  cambodian: table('B02018', [11], 'Cambodian, alone or in any combination'),
  afghan: table('B02018', [29], 'Afghan, alone or in any combination'),
  nicaraguan: table('B03001', [12], 'Nicaraguan (Hispanic origin)'),
  moldovan: anc([146], 'Moldovan ancestry'),
  bosnian: anc([177], 'Bosnian and Herzegovinian ancestry'),
  chaldean: table('B04006', [17], 'Assyrian, Chaldean, or Syriac ancestry'),
  lao: table('B02018', [14], 'Laotian, alone or in any combination'),
  turkish: table('B04006', [91], 'Turkish ancestry'),
  swedish: table('B04006', [89], 'Swedish ancestry'),
  basque: table('B04006', [20], 'Basque ancestry'),
  czech: table('B04006', [31, 32], 'Czech or Czechoslovakian ancestry'),
  kurdish: anc([442], 'Kurdish ancestry'),
  nepali: table('B02018', [24], 'Nepalese, alone or in any combination'),
  taiwanese: table('B02018', [8], 'Taiwanese, alone or in any combination'),
  burmese: table('B02018', [10], 'Burmese, alone or in any combination'),
  belarusian: anc([102], 'Belarusian ancestry'),
  tibetan: anc([714], 'Tibetan ancestry'),
  finnish: table('B04006', [39], 'Finnish ancestry'),
  chilean: table('B03001', [19], 'Chilean (Hispanic origin)'),
  maya: none('The Census has no usable count of Maya people for the area.'),
  moroccan: table('B04006', [11], 'Moroccan ancestry'),
  'chinese-american': sameAs('chinese'),
  'black-american': table('B02009', [1], 'Black or African American, alone or in any combination', {
    note: 'Includes African and Caribbean immigrants, who also have their own cards.',
  }),
  'cajun-creole': anc([937, 907], 'Cajun or Creole ancestry'),
  vietnamese: table('B02018', [19], 'Vietnamese, alone or in any combination'),
};

async function download(url, file) {
  const target = path.join(cacheDir, file);
  if (fs.existsSync(target)) return target;
  fs.mkdirSync(cacheDir, { recursive: true });
  console.error(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const partial = `${target}.part`;
  await fs.promises.writeFile(partial, res.body);
  fs.renameSync(partial, target);
  return target;
}

/** The metro row of one summary-file table, as { line: [estimate, moe] }. */
async function metroRow(tableId) {
  const file = await download(`${SUMMARY_BASE}/acsdt5y${ACS_YEAR}-${tableId.toLowerCase()}.dat`, `${tableId}.dat`);
  const rl = readline.createInterface({ input: fs.createReadStream(file) });
  let header = null;
  for await (const line of rl) {
    if (!header) {
      header = line.split('|');
      continue;
    }
    if (!line.startsWith(`${METRO_GEO_ID}|`)) continue;
    rl.close();
    const values = line.split('|');
    const row = {};
    header.forEach((col, i) => {
      const match = col.match(/_E(\d+)$/);
      if (match) row[Number(match[1])] = [Number(values[i]), Number(values[i + 1])];
    });
    return row;
  }
  throw new Error(`${tableId}: no row for ${METRO_GEO_ID}`);
}

async function metroPumas() {
  const file = await download(PUMA_CROSSWALK_URL, 'tract-to-puma.txt');
  const pumas = new Set();
  const others = new Set();
  for (const line of fs.readFileSync(file, 'utf8').split('\n').slice(1)) {
    const [state, county, , puma] = line.trim().split(',');
    if (state !== '06' || !puma) continue;
    (METRO_COUNTIES.has(county) ? pumas : others).add(puma);
  }
  const straddling = [...pumas].filter((puma) => others.has(puma));
  if (straddling.length) throw new Error(`PUMAs cross the metro line: ${straddling.join(', ')}`);
  return pumas;
}

/**
 * Weighted PUMS counts for every pums source, with a 90% margin of error from the
 * 80 replicate weights (successive difference replication, as the Census documents).
 */
async function pumsCounts(sources) {
  const pumas = await metroPumas();
  const zip = await download(PUMS_URL, 'csv_pca.zip');
  const totals = new Map(sources.map(([id]) => [id, new Float64Array(81)]));
  const unzip = spawn('unzip', ['-p', zip, 'psam_p06.csv']);
  const rl = readline.createInterface({ input: unzip.stdout });
  let col = null;
  for await (const line of rl) {
    const fields = line.split(',');
    if (!col) {
      col = Object.fromEntries(fields.map((name, i) => [name, i]));
      continue;
    }
    if (!pumas.has(fields[col.PUMA])) continue;
    const ancestries = [Number(fields[col.ANC1P]), Number(fields[col.ANC2P])];
    const language = Number(fields[col.LANP]);
    for (const [id, source] of sources) {
      const hit =
        source.field === 'anc'
          ? source.codes.some((code) => ancestries.includes(code))
          : source.codes.includes(language);
      if (!hit) continue;
      const sums = totals.get(id);
      sums[0] += Number(fields[col.PWGTP]);
      for (let r = 1; r <= 80; r += 1) sums[r] += Number(fields[col[`PWGTP${r}`]]);
    }
  }
  const out = new Map();
  for (const [id, sums] of totals) {
    let variance = 0;
    for (let r = 1; r <= 80; r += 1) variance += (sums[r] - sums[0]) ** 2;
    out.set(id, { count: sums[0], moe: Math.round(1.645 * Math.sqrt((4 / 80) * variance)) });
  }
  return out;
}

function tableUrl(id) {
  return `https://data.census.gov/table/ACSDT5Y${ACS_YEAR}.${id}?g=310XX00US${CBSA}`;
}

const cultures = JSON.parse(fs.readFileSync(culturesPath, 'utf8'));
const unmapped = cultures.filter((c) => !SOURCES[c.id]).map((c) => c.id);
if (unmapped.length) {
  console.error(`No population source for: ${unmapped.join(', ')}. Add them to SOURCES (use none() if there is no count).`);
  process.exit(1);
}
const unknown = Object.keys(SOURCES).filter((id) => !cultures.some((c) => c.id === id));
if (unknown.length) console.error(`Warning: SOURCES has ids not in cultures.json: ${unknown.join(', ')}`);

const rows = new Map();
for (const { id } of Object.values(SOURCES).filter((s) => s.kind === 'table')) {
  if (!rows.has(id)) rows.set(id, await metroRow(id));
}
const pumsSources = Object.entries(SOURCES).filter(([, s]) => s.kind === 'pums');
const pums = pumsSources.length ? await pumsCounts(pumsSources) : new Map();

const result = {};
for (const { id } of cultures) {
  const source = SOURCES[id];
  if (source.kind === 'sameAs') {
    result[id] = { sameAs: source.id, ...(source.note ? { note: source.note } : {}) };
  } else if (source.kind === 'none') {
    result[id] = { count: null, note: source.note };
  } else if (source.kind === 'estimate') {
    const { kind, ...fields } = source;
    result[id] = { ...fields, estimate: true };
  } else if (source.kind === 'table') {
    const row = rows.get(source.id);
    let count = 0;
    let moeSquared = 0;
    for (const line of source.lines) {
      const [estimateValue, moe] = row[Math.abs(line)];
      count += Math.sign(line) * estimateValue;
      moeSquared += moe ** 2;
    }
    result[id] = {
      count,
      moe: Math.round(Math.sqrt(moeSquared)),
      measure: source.measure,
      source: `${VINTAGE}, table ${source.id}`,
      url: tableUrl(source.id),
      ...(source.note ? { note: source.note } : {}),
    };
  } else {
    const { count, moe } = pums.get(id);
    result[id] = {
      count,
      moe,
      measure: source.measure,
      source: `${VINTAGE} microdata (PUMS)`,
      url: PUMS_INFO_URL,
      ...(source.note ? { note: source.note } : {}),
    };
  }
}

const sorted = Object.entries(result)
  .map(([id, entry]) => [id, entry?.sameAs ? result[entry.sameAs] : entry])
  .sort((a, b) => (b[1]?.count ?? -1) - (a[1]?.count ?? -1));
for (const [id, entry] of sorted) {
  const count = entry?.count == null ? '—' : entry.count.toLocaleString('en-US');
  const moe = entry?.moe ? ` ±${entry.moe.toLocaleString('en-US')}` : '';
  console.log(`${id.padEnd(18)} ${count.padStart(9)}${moe.padEnd(9)} ${entry?.measure || entry?.note || 'not mapped'}`);
}

if (write) {
  const out = {
    year: ACS_YEAR,
    vintage: VINTAGE,
    geography: 'Sacramento-Roseville-Folsom metro (Sacramento, Placer, El Dorado, Yolo counties)',
    cultures: result,
  };
  fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
  console.error(`Wrote ${path.relative(root, outPath)}`);
}
