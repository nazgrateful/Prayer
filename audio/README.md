# Built-in adhan recordings (muezzin menu)

Recordings listed in `catalog.json` appear in **Settings → Adhan → Muezzin**. Users can preview each one, pick one, and keep a copy for offline use. To add a recording, put the audio file in this folder and add an entry to the list:

```json
{
  "voices": [
    {
      "id": "makkah-1",
      "name": "Muezzin's name",
      "origin": "Masjid al-Ḥarām, Makkah",
      "file": "makkah-1.mp3",
      "fajrFile": "makkah-1-fajr.mp3",
      "credit": "Recorded by …",
      "license": "CC BY-SA 4.0"
    }
  ]
}
```

- `id`, `name` and `file` are required. `fajrFile` is optional: it's the Fajr version with "aṣ-ṣalātu khayrun min an-nawm", and without it Fajr uses `file`.
- The first entry is the default for users who haven't chosen a muezzin.
- Users can always choose **My own recording** and pick an audio file from their phone instead.
- Included now: **Adhan — Makkah** and **Adhan — Madinah** (`adhan-makkah.mp3`, `adhan-madinah.mp3`), added by the app owner. Their file tags credit www.PrayTimes.org.
- An older setup is also still supported: plain `adhan.mp3` / `adhan-fajr.mp3` files here, used when the catalog is empty.

**Only add recordings you have the right to share**, such as public-domain or Creative Commons recordings (for example, from [Wikimedia Commons](https://commons.wikimedia.org/w/index.php?search=adhan+audio)) or recordings a mosque has given permission for. Fill in `credit` and `license` so they appear in the app.
