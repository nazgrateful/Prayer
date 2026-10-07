// Qibla: direction (great-circle bearing) and distance to the Kaʿbah.

export const KAABA = { lat: 21.422487, lng: 39.826206 };
const R = 6371.0088; // mean Earth radius, km
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** Bearing in degrees clockwise from true north (0–360). */
export function qiblaBearing(lat, lng) {
  const φ1 = rad(lat);
  const φ2 = rad(KAABA.lat);
  const Δλ = rad(KAABA.lng - lng);
  const y = Math.sin(Δλ);
  const x = Math.cos(φ1) * Math.tan(φ2) - Math.sin(φ1) * Math.cos(Δλ);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Great-circle distance to the Kaʿbah in km. */
export function qiblaDistance(lat, lng) {
  const dφ = rad(KAABA.lat - lat);
  const dλ = rad(KAABA.lng - lng);
  const a = Math.sin(dφ / 2) ** 2 + Math.cos(rad(lat)) * Math.cos(rad(KAABA.lat)) * Math.sin(dλ / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function compassPoint(bearing) {
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return points[Math.round(bearing / 22.5) % 16];
}

/**
 * Live compass heading (degrees from north) from the device sensors.
 * Calls onHeading(heading) repeatedly; returns a stop function.
 * Must be started from a tap on iOS (permission prompt).
 */
export async function watchHeading(onHeading) {
  const DOE = typeof DeviceOrientationEvent !== 'undefined' ? DeviceOrientationEvent : null;
  if (!DOE) throw new Error('This device has no compass sensor.');
  if (typeof DOE.requestPermission === 'function') {
    const res = await DOE.requestPermission();
    if (res !== 'granted') throw new Error('Compass permission was not granted.');
  }
  const handler = (e) => {
    let heading = null;
    if (typeof e.webkitCompassHeading === 'number') heading = e.webkitCompassHeading; // iOS
    else if (e.absolute && typeof e.alpha === 'number') heading = 360 - e.alpha; // Android
    if (heading != null) onHeading((heading + (screen.orientation?.angle || 0) + 360) % 360);
  };
  const evt = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
  window.addEventListener(evt, handler, true);
  return () => window.removeEventListener(evt, handler, true);
}
