/** Event JSON-LD for the homepage. Confirmed dates use the next occurrence.
 *  Estimates and seasons use lastHeld so we never invent a day.
 */

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

const SITE = 'https://sacpassport.com';

function isoDay(year, month, day) {
  const y = Number(year);
  const m = MONTHS[String(month).toLowerCase()];
  const d = Number(day);
  if (!y || !m || !d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** @returns {{ start: string, end: string | null } | null} */
export function parseEventDate(text) {
  if (!text) return null;
  const range = String(text).match(
    /([A-Za-z]+)\s+(\d{1,2})\s*[–-]\s*(\d{1,2}),?\s*(\d{4})/,
  );
  if (range) {
    const start = isoDay(range[4], range[1], range[2]);
    const end = isoDay(range[4], range[1], range[3]);
    if (start && end) return { start, end };
  }
  const single = String(text).match(/([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})/);
  if (single) {
    const start = isoDay(single[3], single[1], single[2]);
    if (start) return { start, end: null };
  }
  return null;
}

function schemaDates(item) {
  if (item.whenKind === 'confirmed') {
    return parseEventDate(item.when) || (item.sortDate ? { start: item.sortDate, end: null } : null);
  }
  return parseEventDate(item.lastHeld);
}

function location(item) {
  const locality = item.city || item.place;
  const place = {
    '@type': 'Place',
    name: item.place,
    address: {
      '@type': 'PostalAddress',
      addressLocality: locality,
      addressRegion: 'CA',
      addressCountry: 'US',
    },
  };
  return place;
}

export function eventNodes(cultures, today = '2026-09-23') {
  const nodes = [];
  for (const item of cultures) {
    const dates = schemaDates(item);
    if (!dates) continue;
    const upcoming = item.whenKind === 'confirmed' && dates.start >= today;
    const where = item.city ? `${item.place}, ${item.city}` : item.place;
    const node = {
      '@type': 'Event',
      name: item.event,
      startDate: dates.start,
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      location: location(item),
      description: upcoming
        ? `${item.culture} festival in Greater Sacramento: ${item.event} at ${where}.`
        : `${item.culture} festival in Greater Sacramento: ${item.event} at ${where}. Last held ${item.lastHeld}.`,
    };
    if (dates.end) node.endDate = dates.end;
    if (upcoming) node.eventStatus = 'https://schema.org/EventScheduled';
    if (item.url) node.url = item.url;
    if (item.flyer) node.image = `${SITE}${item.flyer}`;
    nodes.push(node);
  }
  return nodes;
}

export function eventJsonLd(cultures, today) {
  return {
    '@context': 'https://schema.org',
    '@graph': eventNodes(cultures, today),
  };
}
