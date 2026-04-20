const express = require('express');
const cors    = require('cors');
const app     = express();
const PORT    = process.env.PORT || 3000;

// FORCED SECURITY BYPASS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(cors());

// ── TIME HELPERS ─────────────────────────────────────────────────────────────
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
  const h = str.match(/(\d+)h/); if (h) return parseInt(h[1]) * 60;
  const m = str.match(/(\d+)m/); if (m) return parseInt(m[1]);
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

// ── SCRAPER ───────────────────────────────────────────────────────────────────
async function scrapeShowtimes() {
  const { default: fetch } = await import('node-fetch');
  const { load } = await import('cheerio');

  try {
    const res = await fetch('https://www.baycitycinemas.com/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 30000 
    });
    const html = await res.text();
    const $    = load(html);
    const showtimes = [];
    let idx = 0;

    $('h3, .movie-title, h2').each((_, el) => {
      const title = $(el).text().trim();
      if (!title || title.length < 2) return;
      const block = $(el).closest('div, section, article, li').first();
      const text  = block.text();
      const durM  = text.match(/(\d+)h\s*(\d+)m/);
      const runtime = durMins(durM ? durM[0] : '2h 00m');
      const timeRx = /\b(\d{1,2}:\d{2}\s*[ap]m?)\b/gi;
      const times  = [...new Set((text.match(timeRx) || []).map(t => t.replace(/\s/g,'').toLowerCase()))];

      times.forEach(t => {
        const exitMins = timeMins(t) + runtime + 15;
        showtimes.push({
          movieId: slugify(title, idx++),
          movie: title,
          rating: (text.match(/\b(NR|G|PG-13|PG|R)\b/) || ['','NR'])[1],
          theater: title.includes('GDX') ? 'GDX' : 'General',
          startTime: t,
          endTime: minsToTime(exitMins),
          endMins: exitMins
        });
      });
    });
    return showtimes.sort((a, b) => a.endMins - b.endMins);
  } catch (err) {
    return [];
  }
}

// ── CACHE & ROUTES ────────────────────────────────────────────────────────────
let cache = { date: '', showtimes: [] };

async function refreshCache() {
  const data = await scrapeShowtimes();
  if (data.length > 0) {
    cache = { date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' }), showtimes: data };
  }
}

refreshCache();
setInterval(refreshCache, 15 * 60 * 1000); 

app.get('/showtimes', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json({ ok: true, date: cache.date, showtimes: cache.showtimes });
});

app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/', (req, res) => res.send('API Active'));

app.listen(PORT, () => console.log('Server live'));
