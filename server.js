const express = require('express');
const cors    = require('cors');
const app     = express();
const PORT    = process.env.PORT || 3000;

app.use(cors());

// ── time helpers ─────────────────────────────────────────────────────────────

function timeMins(str) {
  str = str.trim().toLowerCase().replace('am','a').replace('pm','p');
  const pm = str.endsWith('p');
  const t  = str.replace(/[ap]$/,'');
  let [h, m] = t.split(':').map(Number);
  if (isNaN(m)) m = 0;
  if (pm && h !== 12) h += 12;
  if (!pm && h === 12) h = 0;
  return h * 60 + m;
}

function durMins(str) {
  const hm = str.match(/(\d+)h\s*(\d+)m/);
  if (hm) return parseInt(hm[1]) * 60 + parseInt(hm[2]);
  const h = str.match(/(\d+)h/);  if (h) return parseInt(h[1]) * 60;
  const m = str.match(/(\d+)m/);  if (m) return parseInt(m[1]);
  return 0;
}

function minsToTime(mins) {
  mins = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(mins / 60), m = mins % 60;
  return (h % 12 || 12) + ':' + String(m).padStart(2,'0') + (h >= 12 ? 'pm' : 'am');
}

function slugify(s, i) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g,'-') + '-' + i;
}

// ── scrape ───────────────────────────────────────────────────────────────────

async function scrapeShowtimes() {
  // Dynamic import for node-fetch v3
  const { default: fetch } = await import('node-fetch');
  const { load } = await import('cheerio');

  const res = await fetch('https://www.baycitycinemas.com/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BayCityCleaner/1.0)' },
    timeout: 15000
  });
  if (!res.ok) throw new Error('Site returned ' + res.status);
  const html = await res.text();
  const $    = load(html);

  const showtimes = [];
  let idx = 0;

  $('h3').each((_, el) => {
    const title = $(el).text().trim();
    if (!title || title.length < 2) return;

    // Walk up to find the containing block for this movie
    const block = $(el).closest('div[class], section, article, li').first();
    const text  = block.length ? block.text() : $(el).parent().text();

    const ratingM  = text.match(/\b(NR|G|PG-13|PG|R)\b/);
    const rating   = ratingM ? ratingM[1] : 'NR';

    const durM     = text.match(/(\d+)h\s*(\d+)m/);
    const duration = durM ? durM[0] : '0h 0m';
    const runtime  = durMins(duration);

    let theater = 'General';
    if (title.includes('GDX')) theater = 'GDX';
    else if (text.toLowerCase().includes('flashback')) theater = 'Flashback';

    // Extract all times like "10:20a", "2:45p", "10:20am", "2:45pm"
    const timeRx = /\b(\d{1,2}:\d{2}\s*[ap]m?)\b/gi;
    const times  = [...new Set((text.match(timeRx) || []).map(t => t.replace(/\s/g,'').toLowerCase()))];

    times.forEach(t => {
      const exitMins = timeMins(t) + runtime + 15;
      showtimes.push({
        movieId:  slugify(title, idx++),
        movie:    title,
        rating,
        theater,
        startTime: t,
        duration,
        endTime:  minsToTime(exitMins),
        endMins:  exitMins
      });
    });
  });

  return showtimes.sort((a, b) => a.endMins - b.endMins);
}

// ── cache (refresh every 30 min) ─────────────────────────────────────────────

let cache = { date: '', showtimes: [] };

async function refreshCache() {
  try {
    console.log('Refreshing showtimes…');
    const data = await scrapeShowtimes();
    cache = { date: new Date().toISOString().slice(0,10), showtimes: data };
    console.log('Got ' + data.length + ' showtimes');
  } catch(e) {
    console.error('Scrape error:', e.message);
  }
}

refreshCache();
setInterval(refreshCache, 30 * 60 * 1000); // every 30 minutes

// ── routes ───────────────────────────────────────────────────────────────────

app.get('/showtimes', (req, res) => {
  res.json({ ok: true, date: cache.date, showtimes: cache.showtimes });
});

app.get('/health', (req, res) => {
  res.json({ ok: true, count: cache.showtimes.length, date: cache.date });
});

app.get('/', (req, res) => {
  res.send('Bay City Cleaner API is running. GET /showtimes for data.');
});

app.listen(PORT, () => console.log('Server on port ' + PORT));
