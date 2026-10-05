// Getting the user's location: GPS, city search (free Open-Meteo geocoder,
// no API key) or manual coordinates.

import { deviceTimeZone, isValidTimeZone } from './tz.js';

export function fromGPS() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location is not available on this device.'));
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: +pos.coords.latitude.toFixed(4),
          lng: +pos.coords.longitude.toFixed(4),
          elevation: Math.max(0, Math.round(pos.coords.altitude || 0)),
          timeZone: deviceTimeZone(),
          name: `${pos.coords.latitude.toFixed(2)}°, ${pos.coords.longitude.toFixed(2)}°`,
          source: 'gps',
        }),
      (err) => reject(new Error(err.code === 1 ? 'Location permission was denied. You can search for your city instead.' : 'Could not get your location. Try searching for your city.')),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 },
    );
  });
}

/** Best-effort place name for GPS coordinates (optional, needs network). */
export async function reverseName(lat, lng) {
  try {
    const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`);
    if (!r.ok) return null;
    const j = await r.json();
    return [j.city || j.locality, j.countryName].filter(Boolean).join(', ') || null;
  } catch {
    return null;
  }
}

export async function searchCity(query) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=8&language=en&format=json`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('City search is unavailable right now.');
  const j = await r.json();
  return (j.results || []).map((c) => ({
    lat: +c.latitude.toFixed(4),
    lng: +c.longitude.toFixed(4),
    elevation: Math.max(0, Math.round(c.elevation || 0)),
    timeZone: isValidTimeZone(c.timezone) ? c.timezone : deviceTimeZone(),
    name: [c.name, c.admin1, c.country].filter(Boolean).join(', '),
    source: 'search',
  }));
}

export function manual({ lat, lng, elevation = 0, timeZone, name }) {
  lat = +lat;
  lng = +lng;
  if (!(lat >= -90 && lat <= 90) || !(lng >= -180 && lng <= 180)) throw new Error('Latitude must be −90…90 and longitude −180…180.');
  const tz = timeZone && isValidTimeZone(timeZone) ? timeZone : deviceTimeZone();
  return { lat, lng, elevation: Math.max(0, +elevation || 0), timeZone: tz, name: name || `${lat.toFixed(2)}°, ${lng.toFixed(2)}°`, source: 'manual' };
}
