const express = require('express');
const cors    = require('cors');
const app     = express();
const PORT    = process.env.PORT || 3000;

// 1. FORCED CORS CONFIGURATION
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// 2. PRE-FLIGHT HANDLER (Fixes "Unreachable" issues)
app.options('*', cors());

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

// ── SCRAPER ───────────────────────────────────────────────────────────────────

async function scrapeShowtimes() {
  const { default: fetch } = await import('node-fetch');
  const { load } = await import('cheerio');

  try {
    const res = await fetch('https://www.baycitycinemas.com/', {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      },
      timeout: 30000 
    });
    
    if (!res.ok) throw new Error('Site returned ' + res.status);
    const html = await res.text();
    const $    = load(html);

    const showtimes = [];
    let idx = 0;

    // Check multiple selectors in case the site layout shifts
    const movieElements = $('h3, .movie-title, .title, h2');

    movieElements.each((_, el) => {
      const title = $(el).text().trim();
      if (!title || title.length < 2) return;

      const block = $(el).closest('div, section, article, li').first();
      const text  = block.text();

      const ratingM  = text.match(/\b(NR|G|PG-13|PG|R)\b/);
      const rating   = ratingM ? ratingM[1] : 'NR';

      const durM      = text.match(/(\d+)h\s*(\d+)m/);
      const duration = durM ? durM[0] : '2h 00m';
      const runtime   = durMins(duration);

      let theater = 'General';
      if (title.includes('GDX')) theater = 'GDX';

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
  } catch (err) {
    console.error('Scraper error:', err.message);
    return [];
  }
}

// ── CACHE ─────────────────────────────────────────────────────────────

let cache = { date: '', showtimes: [] };

async function refreshCache() {
  console.log('Refreshing data...');
  const data = await scrapeShowtimes();
  if (data && data.length > 0) {
    cache = { 
        date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' }), 
        showtimes: data 
    };
    console.log(`Cache updated: ${data.length} items found.`);
  }
}

refreshCache();
setInterval(refreshCache, 15 * 60 * 1000); 

// ── ROUTES ───────────────────────────────────────────────────────────────────

app.get('/showtimes', (req, res) => {
  res.json({ ok: true, date: cache.date, showtimes: cache.showtimes });
});

app.get('/health', (req, res) => {
  res.json({ ok: true, status: "active" });
});

app.get('/', (req, res) => {
  res.send('API is running.');
});

app.listen(PORT, () => console.log('Server live on ' + PORT));
