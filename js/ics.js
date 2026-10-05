// Export upcoming prayers as an .ics calendar with alarms. Importing it into
// Google / Apple / Outlook calendar gives reliable reminders even when the
// app is closed.

const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

/** events: [{ uid, title, start: Date, minutes, description, remindBefore }] */
export function buildICS(events, calName = 'Prayer Times') {
  const now = stamp(new Date());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Prayer//Prayer Times//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc(calName)}`];
  for (const e of events) {
    const end = new Date(e.start.getTime() + (e.minutes || 10) * 60000);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}@prayer-app`,
      `DTSTAMP:${now}`,
      `DTSTART:${stamp(e.start)}`,
      `DTEND:${stamp(end)}`,
      `SUMMARY:${esc(e.title)}`,
    );
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(e.title)}`, `TRIGGER:-PT${Math.max(0, e.remindBefore | 0)}M`, 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  // RFC 5545 line folding at 75 octets (approximated by characters)
  return lines.map((l) => (l.length <= 75 ? l : l.match(/.{1,74}/g).join('\r\n '))).join('\r\n') + '\r\n';
}
