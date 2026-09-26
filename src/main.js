import Globe from 'globe.gl';
import * as THREE from 'three';
import { feature } from 'topojson-client';
import land from 'world-atlas/countries-110m.json';
import cultures from '../data/cultures.json';

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
let world = null;

const countries = feature(land, land.objects.countries).features.filter(
  (shape) => String(shape.id) !== '010',
);

function ordered() {
  const list = [...cultures];
  if (sortMode === 'name') {
    list.sort((a, b) => a.culture.localeCompare(b.culture));
    return list;
  }
  list.sort((a, b) => {
    const monthA = (a.sortDate || '9999').slice(0, 7);
    const monthB = (b.sortDate || '9999').slice(0, 7);
    const byMonth = monthA.localeCompare(monthB);
    if (byMonth !== 0) return byMonth;
    if (a.sortRank !== b.sortRank) return a.sortRank - b.sortRank;
    return (a.sortDate || '9999').localeCompare(b.sortDate || '9999');
  });
  return list;
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

function mapsSearchUrl(place, city) {
  const query = [place, city].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function urlHostnameLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Event site';
  }
}

function selectCulture(id, scroll) {
  currentId = id;
  paintGlobe();
  for (const card of cardsEl.querySelectorAll('.card')) {
    card.classList.toggle('is-current', card.dataset.id === id);
  }
  if (scroll) {
    document.getElementById(`card-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function render() {
  const list = ordered();
  cardsEl.replaceChildren();

  for (const item of list) {
    const card = document.createElement('article');
    card.className = 'card';
    card.id = `card-${item.id}`;
    card.dataset.id = item.id;
    if (item.id === currentId) card.classList.add('is-current');

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
      const markWidePlate = () => {
        if (img.naturalWidth > img.naturalHeight) plate.classList.add('plate-wide');
      };
      if (img.complete) markWidePlate();
      else img.addEventListener('load', markWidePlate);
      openBtn.append(img);
      openBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        openFlyerLightbox(img.src, img.alt, openBtn, item.video);
      });
      plate.append(openBtn);
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
    venue.append(document.createTextNode(venueLabel));

    const mapLink = document.createElement('a');
    mapLink.className = 'venue-map';
    mapLink.href = mapsSearchUrl(item.place, item.city);
    mapLink.target = '_blank';
    mapLink.rel = 'noopener noreferrer';
    mapLink.setAttribute('aria-label', 'Open in Google Maps');
    mapLink.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>';
    venue.append(mapLink);

    body.append(title, event, date, venue);

    if (item.url) {
      const link = document.createElement('a');
      link.className = 'card-url';
      link.href = item.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = item.urlLabel || urlHostnameLabel(item.url);
      body.append(link);
    }

    if (item.flyer) card.append(plate);
    card.append(body);
    card.addEventListener('click', (eventTarget) => {
      if (eventTarget.target.closest('a, .plate-open, .dates-more')) return;
      selectCulture(item.id, false);
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
  closeBtn.textContent = '×';

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
    const narrow = window.matchMedia('(max-width: 720px)');
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

    let globeW = globeEl.clientWidth;
    let globeH = globeEl.clientHeight;
    let resizeTimer = 0;
    const resize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        const nextW = globeEl.clientWidth;
        const nextH = globeEl.clientHeight;
        if (nextW === globeW && nextH === globeH) return;
        globeW = nextW;
        globeH = nextH;
        world.width(nextW).height(nextH);
        placeGlobe();
      }, 150);
    };
    window.addEventListener('resize', resize);
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
      selectCulture(item.id, true);
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

mountFlyerLightbox();
mountCulturesModal();
render();
mountGlobe();
mountSortsPin();
