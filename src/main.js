import Globe from 'globe.gl';
import * as THREE from 'three';
import { feature } from 'topojson-client';
import land from 'world-atlas/countries-110m.json';
import rawCultures from '../data/cultures.json';
import { registerSW } from 'virtual:pwa-register';

// autoUpdate reloads the page once a new service worker takes control, so a
// deploy shows up on the next check instead of waiting for a second visit.
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    const check = () => {
      if (navigator.onLine) registration.update().catch(() => {});
    };
    setInterval(check, 30 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
  },
});

const SAC = { lat: 38.5816, lng: -121.4944 };
const INK = 'rgba(18, 72, 110, 0.72)';
const OCEAN = '#1578b0';
const OCEAN_DEEP = '#0c5584';
const SPHERE = '#c5e4f6';

const globeEl = document.querySelector('#globe');
const fallbackEl = document.querySelector('#globe-fallback');
const cardsEl = document.querySelector('#cards');
const sortsEl = document.querySelector('.sorts');
const sortButtons = [...document.querySelectorAll('.sorts button[data-sort]')];
const culturesMenuBtn = document.querySelector('.cultures-menu-btn');

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let sortMode = 'upcoming';
let currentId = null;
let currentCardId = null;
let moreCultureId = null;
let world = null;

const countries = feature(land, land.objects.countries).features;

function byUpcoming(a, b) {
  const monthA = (a.sortDate || '9999').slice(0, 7);
  const monthB = (b.sortDate || '9999').slice(0, 7);
  const byMonth = monthA.localeCompare(monthB);
  if (byMonth !== 0) return byMonth;
  if (a.sortRank !== b.sortRank) return a.sortRank - b.sortRank;
  return (a.sortDate || '9999').localeCompare(b.sortDate || '9999');
}

function ordered() {
  if (moreCultureId) {
    const primary = cultures.find((item) => item.id === moreCultureId);
    return [primary, ...(alternatesById.get(moreCultureId) || [])].filter(Boolean).sort(byUpcoming);
  }
  const list = [...cultures, ...soonAlternates()];
  if (sortMode === 'name') {
    list.sort((a, b) => a.culture.localeCompare(b.culture));
    return list;
  }
  return list.sort(byUpcoming);
}

function arcs() {
  return cultures
    .filter((item) => item.origin)
    .map((item) => ({
      id: item.id,
      startLat: item.origin.lat,
      startLng: item.origin.lng,
      endLat: SAC.lat,
      endLng: SAC.lng,
    }));
}

function points() {
  const pins = cultures
    .filter((item) => item.origin)
    .map((item) => ({
      id: item.id,
      lat: item.origin.lat,
      lng: item.origin.lng,
      culture: item.culture,
    }));
  pins.push({ id: 'sacramento', lat: SAC.lat, lng: SAC.lng, culture: 'Sacramento' });
  return pins;
}

const GLOBE_R = 100;
const ARC_PEAK = 0.18;
const arcDash = { value: 0 };

function latLngUnit(lat, lng) {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((90 - lng) * Math.PI) / 180;
  const phiSin = Math.sin(phi);
  return new THREE.Vector3(phiSin * Math.cos(theta), Math.cos(phi), phiSin * Math.sin(theta));
}

// Great-circle direction, lifted by sin(πt). Radius is the globe only at t = 0 and t = 1.
function surfaceArcCurve(startLat, startLng, endLat, endLng) {
  const start = latLngUnit(startLat, startLng);
  const end = latLngUnit(endLat, endLng);
  const omega = Math.acos(THREE.MathUtils.clamp(start.dot(end), -1, 1));
  const curve = new THREE.Curve();
  curve.getPoint = (t, target = new THREE.Vector3()) => {
    let dir;
    if (omega < 1e-4) {
      dir = start.clone();
    } else {
      const sinO = Math.sin(omega);
      dir = new THREE.Vector3()
        .addScaledVector(start, Math.sin((1 - t) * omega) / sinO)
        .addScaledVector(end, Math.sin(t * omega) / sinO);
    }
    const alt = ARC_PEAK * Math.sin(Math.PI * t);
    return target.copy(dir).multiplyScalar(GLOBE_R * (1 + alt));
  };
  return curve;
}

function arcMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uColor: { value: new THREE.Color(OCEAN) },
      uOpacity: { value: 0.55 },
      uDash: arcDash,
      uDashSize: { value: 0.45 },
      uGapSize: { value: 0.18 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uDash;
      uniform float uDashSize;
      uniform float uGapSize;
      varying vec2 vUv;
      void main() {
        float span = uDashSize + uGapSize;
        float d = mod(vUv.x - uDash, span);
        if (d < 0.0) d += span;
        if (d > uDashSize) discard;
        gl_FragColor = vec4(uColor, uOpacity);
      }
    `,
  });
}

function paintArcs() {
  const group = new THREE.Group();
  for (const arc of arcs()) {
    const curve = surfaceArcCurve(arc.startLat, arc.startLng, arc.endLat, arc.endLng);
    const geometry = new THREE.TubeGeometry(curve, 64, 0.45 / 2, 6, false);
    const mesh = new THREE.Mesh(geometry, arcMaterial());
    mesh.renderOrder = 2;
    group.add(mesh);
  }
  // customLayer lives on the globe object that scales and spins during intro.
  world
    .customThreeObject(() => group)
    .customThreeObjectUpdate(() => {})
    .customLayerData([group]);
}

function paintGlobe() {
  if (!world) return;
  world
    .pointsData(points())
    .pointColor((pin) => {
      if (pin.id === 'sacramento') return OCEAN_DEEP;
      return pin.id === currentId ? OCEAN : INK;
    })
    .pointRadius((pin) => (pin.id === currentId || pin.id === 'sacramento' ? 0.55 : 0.28));
}

const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const MONTH_SHORT = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

function monthYearFromIso(iso) {
  if (!iso || !/^\d{4}-\d{2}/.test(iso)) return null;
  const [year, month] = iso.split('-');
  const monthIndex = Number(month) - 1;
  if (monthIndex < 0 || monthIndex > 11) return null;
  return `${MONTH_ABBR[monthIndex]} ${year}`;
}

function monthYearFromLooseDate(text) {
  if (!text) return null;
  const match = String(text).match(
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b\.?\s*(?:\d{1,2}(?:\s*[–-]\s*\d{1,2})?)?,?\s*(\d{4})/i,
  );
  if (!match) return null;
  const monthIndex = MONTH_SHORT[match[1].toLowerCase()];
  if (monthIndex == null) return null;
  return `${MONTH_ABBR[monthIndex]} ${match[2]}`;
}

/** Month index emphasized by a season label ("Usually late May", "Labor Day weekend"). */
function monthIndexFromSeasonWhen(text) {
  if (!text) return null;
  const lower = String(text).toLowerCase();
  if (/\blabor day\b/.test(lower)) return 8; // September
  const match = lower.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/,
  );
  if (!match) return null;
  return MONTH_SHORT[match[1]];
}

/** Next Month Year after `after` for a 0-based month (that month this year if still ahead). */
function nextMonthYear(monthIndex, after = new Date()) {
  if (monthIndex == null || monthIndex < 0 || monthIndex > 11) return null;
  const year = monthIndex > after.getMonth() ? after.getFullYear() : after.getFullYear() + 1;
  return `${MONTH_ABBR[monthIndex]} ${year}`;
}

function isoDate(year, monthIndex, day) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function localTodayIso(now = new Date()) {
  return isoDate(now.getFullYear(), now.getMonth(), now.getDate());
}

/** "Sep 26, 2026" · "Oct 2–4, 2026" · "Oct 30–Nov 1, 2026" → first and last day as ISO. */
function dateSpanFromLabel(text) {
  const match = String(text || '').match(
    /^([A-Za-z]+)\.?\s+(\d{1,2})(?:\s*[–-]\s*(?:([A-Za-z]+)\.?\s+)?(\d{1,2}))?,\s*(\d{4})$/,
  );
  if (!match) return null;
  const startMonth = MONTH_SHORT[match[1].toLowerCase()];
  const endMonth = match[3] ? MONTH_SHORT[match[3].toLowerCase()] : startMonth;
  if (startMonth == null || endMonth == null) return null;
  const year = Number(match[5]);
  const startDay = Number(match[2]);
  const endDay = match[4] ? Number(match[4]) : startDay;
  return { start: isoDate(year, startMonth, startDay), end: isoDate(year, endMonth, endDay) };
}

/** Same month and day, one year at a time, until it is today or later. */
function rollIsoForward(iso, todayIso) {
  const [year, month, day] = iso.split('-').map(Number);
  let nextYear = year;
  let next = iso;
  while (next < todayIso) {
    nextYear += 1;
    const lastDay = new Date(nextYear, month, 0).getDate();
    next = isoDate(nextYear, month - 1, Math.min(day, lastDay));
  }
  return next;
}

/**
 * The JSON keeps the last dates we typed in. After a confirmed date ends, show that
 * event as next year's estimate until a new flyer lands. Past estimates roll a year.
 */
function rollPastDates(item, todayIso = localTodayIso()) {
  if (item.whenKind === 'confirmed') {
    if (Array.isArray(item.dates) && item.dates.length) {
      const spans = item.dates.map((label) => ({ label, span: dateSpanFromLabel(label) }));
      const upcoming = spans.filter(({ span }) => span && span.end >= todayIso);
      if (upcoming.length) {
        return {
          ...item,
          when: upcoming[0].label,
          sortDate: upcoming[0].span.start,
          dates: upcoming.map(({ label }) => label),
        };
      }
      const last = spans.filter(({ span }) => span).pop();
      if (!last) return item;
      return rollConfirmedToEstimate({ ...item, when: last.label, dates: undefined }, last.span, todayIso);
    }
    const span = dateSpanFromLabel(item.when) ||
      (item.sortDate ? { start: item.sortDate, end: item.sortDate } : null);
    if (!span || span.end >= todayIso) return item;
    return rollConfirmedToEstimate(item, span, todayIso);
  }

  if ((item.whenKind === 'estimate' || item.whenKind === 'season') && item.sortDate) {
    if (item.sortDate >= todayIso) return item;
    const sortDate = rollIsoForward(item.sortDate, todayIso);
    const rolled = { ...item, sortDate };
    if (item.whenKind === 'estimate') rolled.when = monthYearFromIso(sortDate);
    return rolled;
  }

  return item;
}

function rollConfirmedToEstimate(item, span, todayIso) {
  const sortDate = rollIsoForward(span.start, todayIso);
  return {
    ...item,
    when: monthYearFromIso(sortDate),
    whenKind: 'estimate',
    lastHeld: item.when,
    sortRank: 1,
    sortDate,
  };
}

const cultures = rawCultures.map((item) => rollPastDates(item));

/** Alternates inherit culture + origin from the primary card; they are shown only in that culture's view. */
const alternatesById = new Map(
  rawCultures
    .filter((item) => Array.isArray(item.alternates) && item.alternates.length > 0)
    .map((item) => [
      item.id,
      item.alternates.map((alt) =>
        rollPastDates({ ...alt, culture: item.culture, origin: item.origin, parentId: item.id }),
      ),
    ]),
);

/** Confirmed alternates starting this calendar month or next also get a card on the main list. */
function soonAlternates(now = new Date()) {
  const cutoff = new Date(now.getFullYear(), now.getMonth() + 2, 0);
  const cutoffIso = isoDate(cutoff.getFullYear(), cutoff.getMonth(), cutoff.getDate());
  return [...alternatesById.values()]
    .flat()
    .filter((alt) => alt.whenKind === 'confirmed' && alt.sortDate && alt.sortDate <= cutoffIso);
}

/** Display date for cards / plates, keyed off whenKind. */
function formatDateLabel(item) {
  switch (item.whenKind) {
    case 'confirmed':
      return item.when || 'Date TBA';
    case 'season': {
      const monthYear =
        monthYearFromIso(item.sortDate) ||
        nextMonthYear(monthIndexFromSeasonWhen(item.when)) ||
        nextMonthYear(
          (() => {
            const held = monthYearFromLooseDate(item.lastHeld);
            if (!held) return null;
            const name = held.split(' ')[0].toLowerCase();
            return MONTH_SHORT[name];
          })(),
        );
      return monthYear ? `${monthYear} (est.)` : 'Date TBA';
    }
    case 'estimate': {
      const monthYear =
        monthYearFromLooseDate(item.when) ||
        monthYearFromIso(item.sortDate) ||
        monthYearFromLooseDate(item.lastHeld);
      return monthYear ? `${monthYear} (est.)` : 'Date TBA';
    }
    case 'unknown':
    default:
      return 'Date TBA';
  }
}

/**
 * With a placeId Google opens that exact place; the query is only its fallback.
 * mapPoint drops a pin for venues Google has no listing for, like a closed-off city block.
 */
function googleMapsUrl({ place, city, placeId, mapPoint }) {
  const base = 'https://www.google.com/maps/search/?api=1&query=';
  if (mapPoint) return `${base}${mapPoint.lat},${mapPoint.lng}`;
  const url = `${base}${encodeURIComponent([place, city].filter(Boolean).join(', '))}`;
  return placeId ? `${url}&query_place_id=${encodeURIComponent(placeId)}` : url;
}

/** Apple Maps has no use for Google place IDs, so it searches the venue name and city. */
function appleMapsUrl({ place, city, mapPoint }) {
  if (mapPoint) {
    return `https://maps.apple.com/?ll=${mapPoint.lat},${mapPoint.lng}&q=${encodeURIComponent(place || 'Event')}`;
  }
  const query = [place, city, 'CA'].filter(Boolean).join(', ');
  return `https://maps.apple.com/?q=${encodeURIComponent(query)}`;
}

const MAPS_APPS = {
  apple: { label: 'Apple Maps', url: appleMapsUrl },
  google: { label: 'Google Maps', url: googleMapsUrl },
};
const MAPS_APP_KEY = 'sacpassport.mapsApp';
const LONG_PRESS_MS = 550;
const mapLinkItems = new WeakMap();
let sessionMapsApp = null;

function getMapsApp() {
  try {
    const value = localStorage.getItem(MAPS_APP_KEY);
    return value in MAPS_APPS ? value : null;
  } catch {
    return null;
  }
}

function setMapsApp(app) {
  try {
    localStorage.setItem(MAPS_APP_KEY, app);
  } catch {
    // Storage can be off (private mode); the choice then lasts for this page only.
  }
  sessionMapsApp = app;
  for (const link of cardsEl.querySelectorAll('.venue-map')) syncMapLink(link);
}

function preferredMapsApp() {
  return getMapsApp() || sessionMapsApp;
}

function syncMapLink(link) {
  const item = mapLinkItems.get(link);
  if (!item) return;
  const app = preferredMapsApp();
  link.href = MAPS_APPS[app || 'google'].url(item);
  const venue = item.city ? `${item.place}, ${item.city}` : item.place;
  const appLabel = app ? MAPS_APPS[app].label : 'maps';
  link.setAttribute('aria-label', `${venue}, open in ${appLabel}`);
  link.title = app ? `Open in ${appLabel} · hold to change` : 'Open in maps';
}

function bindLongPress(el, onLongPress) {
  let timer = 0;
  let startX = 0;
  let startY = 0;
  let fired = false;
  const cancel = () => {
    window.clearTimeout(timer);
    timer = 0;
  };
  el.addEventListener('pointerdown', (event) => {
    fired = false;
    if (event.button !== 0) return;
    startX = event.clientX;
    startY = event.clientY;
    cancel();
    timer = window.setTimeout(() => {
      timer = 0;
      fired = true;
      onLongPress();
    }, LONG_PRESS_MS);
  });
  el.addEventListener('pointermove', (event) => {
    if (timer && Math.hypot(event.clientX - startX, event.clientY - startY) > 10) cancel();
  });
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointerleave', cancel);
  // Android long-press and desktop right-click both land here.
  el.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    cancel();
    if (!fired) onLongPress();
  });
  el.addEventListener(
    'click',
    (event) => {
      if (!fired) return;
      fired = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );
}

function trackCard(name, item, extra = {}) {
  window.gtag?.('event', name, {
    culture: item.culture,
    culture_id: item.parentId || item.id,
    card_id: item.id,
    ...extra,
  });
}

function urlHostnameLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Event site';
  }
}

function selectCulture(id, scroll, cardId = id) {
  if (scroll && moreCultureId && moreCultureId !== id) showAllCultures();
  currentId = id;
  currentCardId = cardId;
  paintGlobe();
  for (const card of cardsEl.querySelectorAll('.card')) {
    card.classList.toggle('is-current', card.dataset.id === cardId);
  }
  if (scroll) {
    document.getElementById(`card-${cardId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

const moreHashPrefix = '#more-';

function moreHash(id) {
  return `${moreHashPrefix}${id}`;
}

function cultureIdFromHash() {
  if (!location.hash.startsWith(moreHashPrefix)) return null;
  const id = decodeURIComponent(location.hash.slice(moreHashPrefix.length));
  return alternatesById.has(id) ? id : null;
}

let cardsBack = null;

function mountCardsBack() {
  cardsBack = document.createElement('a');
  cardsBack.className = 'cards-back';
  cardsBack.href = './';
  cardsBack.textContent = '← Back';
  cardsBack.hidden = true;
  cardsBack.addEventListener('click', (event) => {
    event.preventDefault();
    const id = moreCultureId;
    if (history.state?.sacpassportMore) {
      history.back();
      return;
    }
    showAllCultures();
    if (id) document.getElementById(`card-${id}`)?.scrollIntoView({ block: 'start' });
  });
  sortsEl.prepend(cardsBack);
}

function showCultureEvents(id) {
  moreCultureId = id;
  currentId = id;
  currentCardId = null;
  paintGlobe();
  render();
  (document.querySelector('.sorts-slot') || sortsEl).scrollIntoView({ block: 'start' });
}

function openCultureEvents(id) {
  if (moreCultureId !== id) {
    history.pushState({ sacpassportMore: id }, '', moreHash(id));
  }
  showCultureEvents(id);
}

function showAllCultures() {
  moreCultureId = null;
  if (location.hash.startsWith(moreHashPrefix)) {
    history.replaceState(null, '', location.pathname + location.search);
  }
  render();
}

window.addEventListener('popstate', () => {
  const id = cultureIdFromHash();
  if (id === moreCultureId) return;
  const leaving = moreCultureId;
  if (id) {
    showCultureEvents(id);
  } else {
    showAllCultures();
    if (leaving) {
      currentCardId = leaving;
      selectCulture(leaving, false);
      document.getElementById(`card-${leaving}`)?.scrollIntoView({ block: 'start' });
    }
  }
});

function render() {
  const list = ordered();
  cardsEl.replaceChildren();
  cardsEl.classList.toggle('is-culture-view', Boolean(moreCultureId));
  if (cardsBack) cardsBack.hidden = !moreCultureId;

  for (const item of list) {
    const card = document.createElement('article');
    card.className = 'card';
    card.id = `card-${item.id}`;
    card.dataset.id = item.id;
    if (item.id === currentCardId) card.classList.add('is-current');

    const dateLabel = formatDateLabel(item);

    const plate = document.createElement('div');
    plate.className = 'plate';
    if (item.flyer) {
      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'plate-open';
      openBtn.setAttribute(
        'aria-label',
        item.video ? `Play video: ${item.event}` : `View flyer: ${item.event}`,
      );
      const img = document.createElement('img');
      img.src = item.flyer;
      img.alt = `${item.event}, ${dateLabel}`;
      openBtn.append(img);
      openBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        trackCard('flyer_open', item, { media: item.video ? 'video' : 'image' });
        openFlyerLightbox(img.src, img.alt, openBtn, item.video);
      });
      plate.append(openBtn);
    } else {
      plate.classList.add('plate-empty');
      plate.setAttribute('aria-hidden', 'true');
    }

    const body = document.createElement('div');
    body.className = 'card-body';

    const title = document.createElement('h2');
    title.textContent = item.culture;

    const event = document.createElement('p');
    event.className = 'event';
    event.textContent = item.event;

    const date = document.createElement('p');
    date.className = 'date';
    const moreDates = Array.isArray(item.dates) ? item.dates.filter((value) => value && value !== dateLabel) : [];
    if (moreDates.length === 0) {
      date.textContent = dateLabel;
    } else {
      date.append(document.createTextNode(`${dateLabel} + `));
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'dates-more';
      toggle.textContent = 'multiple dates';
      const list = document.createElement('span');
      list.className = 'dates-all';
      list.textContent = moreDates.join(', ');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-controls', `dates-${item.id}`);
      list.id = `dates-${item.id}`;
      toggle.addEventListener('click', (event) => {
        event.stopPropagation();
        const open = !date.classList.contains('is-open');
        date.classList.toggle('is-open', open);
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      date.append(toggle, list);
    }

    const venue = document.createElement('p');
    venue.className = 'venue';
    const venueLabel = item.city ? `${item.place}, ${item.city}` : item.place;

    const mapLink = document.createElement('a');
    mapLink.className = 'venue-map';
    mapLink.target = '_blank';
    mapLink.rel = 'noopener noreferrer';
    mapLink.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>';
    const venueText = document.createElement('span');
    venueText.className = 'venue-name';
    venueText.textContent = venueLabel;
    mapLink.append(venueText);
    mapLinkItems.set(mapLink, item);
    syncMapLink(mapLink);
    mapLink.addEventListener('click', (event) => {
      const app = preferredMapsApp();
      if (!app) {
        event.preventDefault();
        openMapsChooser(item, mapLink, true);
        return;
      }
      mapLink.href = MAPS_APPS[app].url(item);
      trackCard('map_click', item, { maps_app: app });
    });
    bindLongPress(mapLink, () => openMapsChooser(item, mapLink, false));
    venue.append(mapLink);

    body.append(title, event, date, venue);

    if (item.url) {
      const link = document.createElement('a');
      link.className = 'card-url';
      link.href = item.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = item.urlLabel || urlHostnameLabel(item.url);
      link.addEventListener('click', () => trackCard('event_link_click', item, { link_url: item.url }));
      body.append(link);
    }

    const cultureId = item.parentId || item.id;
    if (!moreCultureId && alternatesById.has(cultureId)) {
      const more = document.createElement('a');
      more.className = 'card-more';
      more.href = moreHash(cultureId);
      more.textContent = `More ${item.culture} events`;
      more.addEventListener('click', (event) => {
        event.preventDefault();
        trackCard('culture_more', item);
        openCultureEvents(cultureId);
      });
      body.append(more);
    }

    card.append(plate, body);
    card.addEventListener('click', (eventTarget) => {
      if (eventTarget.target.closest('a, .plate-open, .dates-more')) return;
      selectCulture(item.parentId || item.id, false, item.id);
    });
    cardsEl.append(card);
  }
}

let flyerLightbox = null;
let flyerLightboxImg = null;
let flyerLightboxVideo = null;
let flyerLightboxClose = null;
let flyerLightboxReturnFocus = null;
let bodyOverflowBefore = '';
let flyerLightboxScrollLocked = false;

function unlockFlyerLightboxScroll() {
  if (!flyerLightboxScrollLocked) return;
  if (bodyOverflowBefore) document.body.style.overflow = bodyOverflowBefore;
  else document.body.style.removeProperty('overflow');
  bodyOverflowBefore = '';
  flyerLightboxScrollLocked = false;
}

function teardownFlyerLightbox() {
  unlockFlyerLightboxScroll();
  if (flyerLightboxImg) {
    flyerLightboxImg.removeAttribute('src');
    flyerLightboxImg.alt = '';
    flyerLightboxImg.hidden = false;
  }
  if (flyerLightboxVideo) {
    flyerLightboxVideo.pause();
    flyerLightboxVideo.removeAttribute('src');
    flyerLightboxVideo.load();
    flyerLightboxVideo.hidden = true;
  }
  const restore = flyerLightboxReturnFocus;
  flyerLightboxReturnFocus = null;
  queueMicrotask(() => restore?.focus?.());
}

function openFlyerLightbox(src, alt, trigger, videoSrc) {
  if (!flyerLightbox) return;
  flyerLightboxReturnFocus = trigger;
  if (videoSrc) {
    flyerLightboxImg.hidden = true;
    flyerLightboxImg.removeAttribute('src');
    flyerLightboxVideo.hidden = false;
    flyerLightboxVideo.src = videoSrc;
    flyerLightboxVideo.play().catch(() => {});
  } else {
    flyerLightboxVideo.hidden = true;
    flyerLightboxVideo.pause();
    flyerLightboxVideo.removeAttribute('src');
    flyerLightboxImg.hidden = false;
    flyerLightboxImg.src = src;
    flyerLightboxImg.alt = alt || 'Flyer';
  }
  if (!flyerLightbox.open) {
    const prior = document.body.style.overflow;
    bodyOverflowBefore = prior === 'hidden' ? '' : prior;
    document.body.style.overflow = 'hidden';
    flyerLightboxScrollLocked = true;
  }
  flyerLightbox.showModal();
  flyerLightboxClose.focus();
}

function mountFlyerLightbox() {
  document.querySelector('.flyer-lightbox')?.remove();

  const dialog = document.createElement('dialog');
  dialog.className = 'flyer-lightbox';
  dialog.setAttribute('aria-label', 'Flyer');

  const frame = document.createElement('div');
  frame.className = 'flyer-lightbox-frame';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'flyer-lightbox-close';
  closeBtn.setAttribute('aria-label', 'Close');
  const closeMark = document.createElement('span');
  closeMark.className = 'flyer-lightbox-close-mark';
  closeMark.setAttribute('aria-hidden', 'true');
  closeMark.textContent = '×';
  closeBtn.append(closeMark);

  const img = document.createElement('img');
  img.alt = '';

  const video = document.createElement('video');
  video.controls = true;
  video.playsInline = true;
  video.hidden = true;

  frame.append(closeBtn, img, video);
  dialog.append(frame);
  document.body.append(dialog);

  const close = () => {
    if (!dialog.open) return;
    teardownFlyerLightbox();
    dialog.close();
  };

  closeBtn.addEventListener('click', close);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });
  // Escape: native dialog fires cancel then closes. Some hosts skip the close event.
  dialog.addEventListener('cancel', () => {
    teardownFlyerLightbox();
  });
  dialog.addEventListener('close', () => {
    teardownFlyerLightbox();
  });

  flyerLightbox = dialog;
  flyerLightboxImg = img;
  flyerLightboxVideo = video;
  flyerLightboxClose = closeBtn;
}

function mountGlobe() {
  try {
    world = Globe({ rendererConfig: { alpha: true } })(globeEl);
    paintArcs();
    world
      .width(globeEl.clientWidth)
      .height(globeEl.clientHeight)
      .backgroundColor('rgba(0,0,0,0)')
      .atmosphereColor('#8ec8ea')
      .atmosphereAltitude(0.12)
      .showGraticules(false)
      .globeMaterial(
        new THREE.MeshPhongMaterial({
          color: SPHERE,
          emissive: '#d7eefb',
          emissiveIntensity: 0.28,
          shininess: 2,
        }),
      )
      .polygonsData(countries)
      .polygonCapColor(() => 'rgba(245, 251, 255, 0.04)')
      .polygonSideColor(() => 'rgba(0,0,0,0)')
      .polygonStrokeColor(() => INK)
      .polygonAltitude(0.004)
      .polygonLabel(() => '')
      .pointAltitude(0.01)
      .pointsTransitionDuration(0);

    const controls = world.controls();
    controls.autoRotate = !reduceMotion;
    controls.autoRotateSpeed = 0.22;
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.zoomSpeed = 0;
    // OrbitControls still preventDefault on wheel when zoom is off — let the page scroll.
    const canvas = world.renderer()?.domElement ?? globeEl.querySelector('canvas');
    if (canvas) {
      canvas.addEventListener(
        'wheel',
        (event) => {
          event.stopImmediatePropagation();
        },
        { capture: true, passive: true },
      );
    }
    const narrow = window.matchMedia('(width < 720px)');
    const placeGlobe = () => {
      const phone = narrow.matches;
      // Positive globeOffset Y shifts the sphere down (API negates into viewOffset).
      // Keep the sphere near the center of the view so front-facing arc peaks stay in frame.
      const desktopY = 24;
      // Phone: 10% of hero height down from SAC-centered box (CSS still centers the box).
      const phoneY = globeEl.clientHeight * 0.10;
      world.globeOffset(phone ? [0, phoneY] : [0, desktopY]);
      world.pointOfView({ lat: 38.6, lng: -121.5, altitude: phone ? 2.05 : 2.7 });
    };
    placeGlobe();
    narrow.addEventListener('change', placeGlobe);
    paintGlobe();

    let globePlaying = true;
    let dashFrame = 0;
    let lastDash = performance.now();
    const tickDash = (now) => {
      dashFrame = 0;
      if (!globePlaying) return;
      arcDash.value += ((now - lastDash) / 1000) * (1000 / 4800);
      lastDash = now;
      dashFrame = requestAnimationFrame(tickDash);
    };
    const startDash = () => {
      if (reduceMotion || dashFrame) return;
      lastDash = performance.now();
      dashFrame = requestAnimationFrame(tickDash);
    };
    const stopDash = () => {
      if (!dashFrame) return;
      cancelAnimationFrame(dashFrame);
      dashFrame = 0;
    };
    const syncGlobePlay = (onScreen) => {
      if (onScreen === globePlaying) return;
      globePlaying = onScreen;
      if (onScreen) {
        world.resumeAnimation();
        startDash();
      } else {
        stopDash();
        world.pauseAnimation();
      }
    };
    startDash();
    const globeVisibility = new IntersectionObserver((entries) => {
      syncGlobePlay(entries.some((entry) => entry.isIntersecting));
    });
    globeVisibility.observe(globeEl);

    // iOS home-screen launch can report a wide vw for the first frames without a
    // window resize afterward, so follow the box itself rather than the window.
    let globeW = globeEl.clientWidth;
    let globeH = globeEl.clientHeight;
    let resizeFrame = 0;
    const resize = () => {
      if (resizeFrame) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        const nextW = globeEl.clientWidth;
        const nextH = globeEl.clientHeight;
        if (!nextW || !nextH || (nextW === globeW && nextH === globeH)) return;
        globeW = nextW;
        globeH = nextH;
        world.width(nextW).height(nextH);
        placeGlobe();
      });
    };
    if ('ResizeObserver' in window) {
      new ResizeObserver(resize).observe(globeEl);
    }
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
    window.addEventListener('pageshow', resize);
    window.visualViewport?.addEventListener('resize', resize);
  } catch (error) {
    console.error(error);
    fallbackEl.hidden = false;
  }
}

for (const button of sortButtons) {
  button.addEventListener('click', () => {
    sortMode = button.dataset.sort;
    for (const peer of sortButtons) {
      peer.setAttribute('aria-pressed', peer === button ? 'true' : 'false');
    }
    if (moreCultureId) {
      showAllCultures();
      return;
    }
    render();
  });
}

function mountSortsPin() {
  if (!sortsEl) return;

  const slot = document.createElement('div');
  slot.className = 'sorts-slot';
  sortsEl.parentNode.insertBefore(slot, sortsEl);

  const sentinel = document.createElement('div');
  sentinel.className = 'sorts-sentinel';
  sentinel.setAttribute('aria-hidden', 'true');
  slot.append(sentinel, sortsEl);

  let pinned = false;

  const setPinned = (on) => {
    if (on === pinned) return;
    if (on) {
      slot.style.height = `${sortsEl.offsetHeight}px`;
      sortsEl.classList.add('is-pinned');
    } else {
      sortsEl.classList.remove('is-pinned');
      slot.style.height = '';
    }
    pinned = on;
  };

  const observer = new IntersectionObserver(
    ([entry]) => {
      // Only pin after the original row has scrolled above the viewport.
      const above = !entry.isIntersecting && entry.boundingClientRect.top < 0;
      setPinned(above);
    },
    { threshold: 0 },
  );
  observer.observe(sentinel);

  let pinResizeTimer = 0;
  window.addEventListener('resize', () => {
    if (!pinned) return;
    window.clearTimeout(pinResizeTimer);
    pinResizeTimer = window.setTimeout(() => {
      if (!pinned) return;
      sortsEl.classList.remove('is-pinned');
      const height = sortsEl.offsetHeight;
      slot.style.height = `${height}px`;
      sortsEl.classList.add('is-pinned');
    }, 150);
  });
}

let culturesModal = null;
let culturesModalClose = null;
let culturesModalReturnFocus = null;
let culturesModalBodyOverflowBefore = '';
let culturesModalScrollLocked = false;

function unlockCulturesModalScroll() {
  if (!culturesModalScrollLocked) return;
  if (culturesModalBodyOverflowBefore) {
    document.body.style.overflow = culturesModalBodyOverflowBefore;
  } else {
    document.body.style.removeProperty('overflow');
  }
  culturesModalBodyOverflowBefore = '';
  culturesModalScrollLocked = false;
}

function teardownCulturesModal() {
  unlockCulturesModalScroll();
  const restore = culturesModalReturnFocus;
  culturesModalReturnFocus = null;
  queueMicrotask(() => restore?.focus?.());
}

function closeCulturesModal() {
  if (!culturesModal?.open) return;
  teardownCulturesModal();
  culturesModal.close();
}

function openCulturesModal() {
  if (!culturesModal) return;
  culturesModalReturnFocus = culturesMenuBtn;
  if (!culturesModal.open) {
    const prior = document.body.style.overflow;
    culturesModalBodyOverflowBefore = prior === 'hidden' ? '' : prior;
    document.body.style.overflow = 'hidden';
    culturesModalScrollLocked = true;
  }
  culturesModal.showModal();
  culturesModalClose?.focus();
}

function mountCulturesModal() {
  document.querySelector('.cultures-modal')?.remove();

  const dialog = document.createElement('dialog');
  dialog.className = 'cultures-modal';
  dialog.setAttribute('aria-labelledby', 'cultures-modal-title');

  const panel = document.createElement('div');
  panel.className = 'cultures-modal-panel';

  const header = document.createElement('div');
  header.className = 'cultures-modal-header';

  const title = document.createElement('h2');
  title.id = 'cultures-modal-title';
  title.className = 'cultures-modal-title';
  title.textContent = 'Cultures';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'cultures-modal-close';
  closeBtn.setAttribute('aria-label', 'Close');
  const closeMark = document.createElement('span');
  closeMark.className = 'cultures-modal-close-mark';
  closeMark.setAttribute('aria-hidden', 'true');
  closeMark.textContent = '×';
  closeBtn.append(closeMark);

  header.append(title, closeBtn);

  const list = document.createElement('div');
  list.className = 'cultures-modal-list';
  list.setAttribute('role', 'list');

  const byName = [...cultures].sort((a, b) => a.culture.localeCompare(b.culture));
  for (const item of byName) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cultures-modal-item';
    btn.setAttribute('role', 'listitem');
    btn.textContent = item.culture;
    btn.addEventListener('click', () => {
      closeCulturesModal();
      if (alternatesById.has(item.id)) {
        openCultureEvents(item.id);
      } else {
        selectCulture(item.id, true);
      }
    });
    list.append(btn);
  }

  panel.append(header, list);
  dialog.append(panel);
  document.body.append(dialog);

  closeBtn.addEventListener('click', closeCulturesModal);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeCulturesModal();
  });
  dialog.addEventListener('cancel', () => {
    teardownCulturesModal();
  });
  dialog.addEventListener('close', () => {
    teardownCulturesModal();
  });

  culturesModal = dialog;
  culturesModalClose = closeBtn;
}

culturesMenuBtn?.addEventListener('click', openCulturesModal);

const MAPS_ICONS = {
  apple:
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M15 4.5 9 2.4 3.6 4.3a1 1 0 0 0-.6.9v15.1a.6.6 0 0 0 .8.6L9 19l6 2.1 5.4-1.9a1 1 0 0 0 .6-.9V3.2a.6.6 0 0 0-.8-.6L15 4.5zM10 4.8l4 1.4v13l-4-1.4v-13z"/></svg>',
  google:
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>',
};

let mapsChooser = null;
let mapsChooserVenue = null;
let mapsChooserHint = null;
let mapsChooserOptions = [];
let mapsChooserItem = null;
let mapsChooserNavigate = false;
let mapsChooserReturnFocus = null;
let mapsChooserBodyOverflowBefore = '';
let mapsChooserScrollLocked = false;

function teardownMapsChooser() {
  if (mapsChooserScrollLocked) {
    if (mapsChooserBodyOverflowBefore) document.body.style.overflow = mapsChooserBodyOverflowBefore;
    else document.body.style.removeProperty('overflow');
    mapsChooserBodyOverflowBefore = '';
    mapsChooserScrollLocked = false;
  }
  mapsChooserItem = null;
  const restore = mapsChooserReturnFocus;
  mapsChooserReturnFocus = null;
  queueMicrotask(() => restore?.focus?.({ preventScroll: true }));
}

function closeMapsChooser() {
  if (!mapsChooser?.open) return;
  mapsChooser.close();
}

function openMapsChooser(item, trigger, navigate) {
  if (!mapsChooser || mapsChooser.open) return;
  mapsChooserItem = item;
  mapsChooserNavigate = navigate;
  mapsChooserReturnFocus = trigger;
  mapsChooserVenue.textContent = item.city ? `${item.place}, ${item.city}` : item.place;
  mapsChooserHint.textContent = navigate
    ? 'We’ll remember this. Hold the map pin anytime to change it.'
    : 'Hold the map pin anytime to change this.';
  const current = preferredMapsApp();
  for (const option of mapsChooserOptions) {
    option.setAttribute('aria-pressed', option.dataset.app === current ? 'true' : 'false');
  }
  const prior = document.body.style.overflow;
  mapsChooserBodyOverflowBefore = prior === 'hidden' ? '' : prior;
  document.body.style.overflow = 'hidden';
  mapsChooserScrollLocked = true;
  mapsChooser.showModal();
  const focusTarget = mapsChooserOptions.find((option) => option.dataset.app === current)
    || mapsChooser.querySelector('.cultures-modal-close');
  focusTarget?.focus();
}

function chooseMapsApp(app) {
  const item = mapsChooserItem;
  const navigate = mapsChooserNavigate;
  setMapsApp(app);
  window.gtag?.('event', 'maps_app_choose', { maps_app: app, from: navigate ? 'first_tap' : 'hold' });
  closeMapsChooser();
  if (navigate && item) {
    trackCard('map_click', item, { maps_app: app });
    window.open(MAPS_APPS[app].url(item), '_blank', 'noopener,noreferrer');
  }
}

function mountMapsChooser() {
  const dialog = document.createElement('dialog');
  dialog.className = 'maps-chooser';
  dialog.setAttribute('aria-labelledby', 'maps-chooser-title');
  dialog.setAttribute('aria-describedby', 'maps-chooser-venue');

  const handle = document.createElement('div');
  handle.className = 'maps-chooser-handle';
  handle.setAttribute('aria-hidden', 'true');

  const header = document.createElement('div');
  header.className = 'maps-chooser-header';
  const title = document.createElement('h2');
  title.id = 'maps-chooser-title';
  title.className = 'maps-chooser-title';
  title.textContent = 'Open directions in';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'cultures-modal-close';
  closeBtn.setAttribute('aria-label', 'Close');
  const closeMark = document.createElement('span');
  closeMark.className = 'cultures-modal-close-mark';
  closeMark.setAttribute('aria-hidden', 'true');
  closeMark.textContent = '×';
  closeBtn.append(closeMark);
  header.append(title, closeBtn);

  const venue = document.createElement('p');
  venue.id = 'maps-chooser-venue';
  venue.className = 'maps-chooser-venue';

  const options = document.createElement('div');
  options.className = 'maps-chooser-options';
  const appleFirst = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
  const order = appleFirst ? ['apple', 'google'] : ['google', 'apple'];
  mapsChooserOptions = order.map((app) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `maps-chooser-option maps-chooser-option--${app}`;
    btn.dataset.app = app;
    btn.innerHTML = `<span class="maps-chooser-icon">${MAPS_ICONS[app]}</span><span class="maps-chooser-label"></span><span class="maps-chooser-check" aria-hidden="true">✓</span>`;
    btn.querySelector('.maps-chooser-label').textContent = MAPS_APPS[app].label;
    btn.addEventListener('click', () => chooseMapsApp(app));
    options.append(btn);
    return btn;
  });

  const hint = document.createElement('p');
  hint.className = 'maps-chooser-hint';

  dialog.append(handle, header, venue, options, hint);
  document.body.append(dialog);

  closeBtn.addEventListener('click', closeMapsChooser);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeMapsChooser();
  });
  dialog.addEventListener('close', teardownMapsChooser);

  mapsChooser = dialog;
  mapsChooserVenue = venue;
  mapsChooserHint = hint;
}

mountFlyerLightbox();
mountCulturesModal();
mountMapsChooser();
mountCardsBack();
moreCultureId = cultureIdFromHash();
if (moreCultureId) currentId = moreCultureId;
render();
mountGlobe();
mountSortsPin();
