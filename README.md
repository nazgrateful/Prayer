# Prayer — prayer times for every faith

A **free, private, installable web app** for daily prayer in any tradition. It has no ads, no accounts, and no tracking, and it works offline after the first visit.

## Features

| | |
|---|---|
| 📍 **Location-aware times** | Uses GPS, a city search, or coordinates you enter. Times are calculated **on the device** from the sun's position, so they change with the seasons and with where you are. The calculation method is picked for your region automatically (for example, ISNA in North America, Umm al-Qura in Saudi Arabia, Ḥanafī ʿAsr in South Asia, and 40-minute candle lighting in Jerusalem). |
| 🕊 **9 traditions** | Islam, Christianity, Judaism, Hinduism, Sikhism, Buddhism, Baháʼí Faith, Zoroastrianism, and Spiritual / Interfaith. You can combine several (useful for interfaith households) and add your own **custom prayers**, at a fixed time or relative to sunrise, noon, or sunset. |
| 🔔 **Custom notifications** | Each prayer has its own on/off switch. There's an early reminder (0–60 min before) and an at-time alert, an optional scripture quote and intention in the notification, a daily quote reminder, and a soft bell. **Export to calendar (.ics)** gives you alarms that work even when the app is closed. |
| ⏱ **Prayer timer** | A countdown with presets, interval bells, and a screen-awake lock. You can start it from any prayer, and each prayer can have its own default length. It also has a counter for tasbīḥ, rosary, mala, or japa (33, 99, 108, …). |
| ☑ **Checklists** | Daily, weekly, and monthly lists that reset on their own. They start with suggestions for your traditions, and a history chart shows past completion. You can also tick off each prayer on the Today screen. |
| ✎ **Intentions & scripture** | Suggested intentions for each prayer (or write your own), a quote of the day from your tradition's books (Qurʾān, Bible, Tanakh, Gita, Guru Granth Sahib, Dhammapada, Baháʼí Writings, Avesta…), favourites, and sharing. |
| 🗓 **Calendars** | The Hijri date (Umm al-Qura) and Hebrew date are shown when relevant. Shabbat candle lighting and Havdalah, Jumuʿah, Sunday worship, and approximate Uposatha days are shown on the right days. |
| 💾 **Your data** | Everything stays in the browser (localStorage). You can back up, restore, or reset it. |

### Prayer schedules

- **Islam**: Fajr, Sunrise, Dhuhr / Jumuʿah, ʿAsr, Maghrib, ʿIshaʾ, and Tahajjud (optional). There are 14 calculation methods, the Standard or Ḥanafī ʿAsr rule, and high-latitude rules.
- **Christianity**: Liturgy of the Hours: Lauds, Terce, Sext / Angelus, None (Hour of Mercy), Vespers, Compline, and Sunday worship.
- **Judaism**: Shacharit (to Sof Zman Tefillah), Sof Zman Kriat Shema, Mincha (from Mincha Gedolah), Maariv (at Tzeit 8.5°), candle lighting, and Havdalah.
- **Hinduism**: Brahma Muhurta, and the Prātaḥ, Mādhyāhnika, and Sāyaṁ Sandhyā.
- **Sikhism**: Amrit Vela Nitnem (last quarter of the night), Ardas, Rehras Sahib, and Kirtan Sohila.
- **Buddhism**: Morning chanting, midday mindfulness, evening chanting, dedication of merit, and Uposatha.
- **Baháʼí**: Obligatory prayer windows (sunrise to noon, noon to sunset, and sunset to 2 hours after).
- **Zoroastrianism**: The five Gāhs (Hāvan, Rapithwin, Uzerin, Aiwisruthrem, Ushahin).
- **Spiritual**: Morning intention, midday pause, evening gratitude, and night reflection.

Every time can be shifted by ± minutes to match your local mosque, church, synagogue, or gurdwara, and any prayer can be hidden.

## Run it locally

You don't need to build or install anything. The app is plain HTML, CSS, and JavaScript modules.

```bash
npm start          # or: python3 -m http.server 8080
# open http://localhost:8080
npm test           # calculation tests (Node 18+)
```

## Publish it for free

**GitHub Pages:** go to repo **Settings → Pages → Deploy from a branch**, then choose `main` and `/ (root)`. The app will be live at `https://<user>.github.io/<repo>/`. On a phone, open that link and choose **Add to Home Screen** to install it like an app. Netlify, Cloudflare Pages, and Vercel also work: just upload the folder.

### Note on notifications

Web apps can show notifications only while the app is open or was recently in the background. Browsers don't let a site schedule alarms for later while it's closed. For alarms you can rely on, use **Settings → Notifications → Export 30 days to calendar**. Every prayer is added to your phone's calendar with its own alarm.

To publish in the Play Store or App Store later, wrap this folder with [Capacitor](https://capacitorjs.com/) and use its Local Notifications plugin. The calculation and UI code can be reused unchanged.

## Privacy

- Prayer times are calculated on your device. Your coordinates are not sent anywhere for that.
- City search sends only the text you type to the free [Open-Meteo geocoding API](https://open-meteo.com/).
- After using GPS, the app looks up your town's name at BigDataCloud's free reverse-geocoding service. This is optional: if it fails, the app shows your coordinates instead.

## Project layout

```
index.html, css/styles.css, sw.js, manifest.webmanifest
js/astro.js        sun position math (PrayTimes / NOAA approximations, ~1 min accuracy)
js/traditions.js   schedules for every tradition, Islamic methods, regional defaults
js/content.js      quotes, intention suggestions, starter checklists
js/tz.js           time-zone helpers (Intl only)
js/notify.js       reminder scheduler, notifications, bell sound
js/ics.js          calendar export
js/views/*.js      Today, Timer, Checklist, Reflect, Settings screens
tests/             node:test suite
```

The scripture passages come from public-domain translations (KJV, JPS 1917, Pickthall, Müller) or are plain-English renderings of well-known verses. Calculated times are approximations, so please confirm important times (for example, fasting) with your local religious authority.
