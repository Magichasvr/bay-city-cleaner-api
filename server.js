const express = require('express');
const cors    = require('cors');
const app     = express();
const PORT    = process.env.PORT || 3000;

// Force a security bypass so your browser never blocks the connection
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(cors());

// ── Time Helpers ─────────────────────────────────────────────────────────────
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

// ── Enhanced Scraper ─────────────────────────────────────────────────────────
async function scrapeShowtimes() {
  const { default: fetch } = await import('node-fetch');
  const { load } = await import('cheerio');

  try {
    console.log("Fetching: https://www.baycitycinemas.com/");
    const res = await fetch('https://www.baycitycinemas.com/', {
      headers: { 
        // These headers make the server look like a real Chrome browser
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Cache-Control': 'no-cache'
      },
      timeout: 30000 
    });

    if (!res.ok) throw new Error('Site returned ' + res.status);
    
    const html = await res.text();
    const $    = load(html);
    const showtimes = [];
    let idx = 0;

    // We search for titles in h3, h2, or movie-title classes
    $('h3, h2, .movie-title, .title').each((_, el) => {
      const title = $(el).text().trim();
      // Ignore titles that are too short or just "Coming Soon"
      if (!title || title.length < 2 || title.toLowerCase().includes('coming soon')) return;

      const block = $(el).closest('div, section, article, li').first();
      const text  = block.text();

      // Find all times like 1:00pm, 4:20p, etc.
      const timeRx = /\b(\d{1,2}:\d{2}\s*[ap]m?)\b/gi;
      const times  = [...new Set((text.match(timeRx) || []).map(t => t.replace(/\s/g,'').toLowerCase()))];

      if (times.length === 0) return;

      const durM  = text.match(/(\d+)h\s*(\d+)m/);
      const runtime = durMins(durM ? durM[0] : '2h 00m');

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
    console.error('Scraper error:', err.message);
    return [];
  }
}

// ── Cache & Deployment ───────────────────────────────────────────────────────
let cache = { date: '', showtimes: [] };

async function refreshCache() {
  const data = await scrapeShowtimes();
  if (data.length > 0) {
    cache = { 
      date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' }), 
      showtimes: data 
    };
    console.log(`Updated cache with ${data.length} movies.`);
  }
}

refreshCache();
setInterval(refreshCache, 20 * 60 * 1000); // Refresh every 20 mins

app.get('/showtimes', (req, res) => {
  res.json({ ok: true, date: cache.date, showtimes: cache.showtimes });
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/', (req, res) => {
  res.send(`<h1>API Status: Online</h1><p>Movies in cache: ${cache.showtimes.length}</p>`);
});

app.listen(PORT, () => console.log('Server live on port ' + PORT));
