// App version and release notes shown to users after an update.
// When releasing: bump APP_VERSION and add an entry at the top of RELEASES.

export const APP_VERSION = '1.4.0';

export const RELEASES = [
  {
    version: '1.4.0',
    notes: [
      '🕌 Adhan at prayer time — full, first part only, or silent, for each prayer',
      '🎙 Built-in adhans from Makkah and Madinah, or use your own recording',
      '🕋 Qibla direction with a live compass',
      '📿 Remembrance counter with phrases for every tradition',
      '💾 Back up & restore that works on every phone',
      '🙏 New home-screen icon',
    ],
  },
  {
    version: '1.0.0',
    notes: ['First release'],
  },
];

/** Compare dotted versions: -1, 0 or 1. */
export function compareVersions(a = '0', b = '0') {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** Notes for every release newer than `seen` (all releases after 1.0.0 if never seen). */
export function notesSince(seen) {
  return RELEASES.filter((r) => compareVersions(r.version, seen || '1.0.0') > 0);
}
