const express = require('express');
const cors    = require('cors');
const app     = express();
const PORT    = process.env.PORT || 3000;

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
  return 120; // Default 2 hours
}

function minsToTime(mins) {
  mins = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(mins / 60), m = mins % 60;
  return (h % 12 || 12) + ':' + String(m).padStart(2,'0') + (h >= 12 ? 'pm' : 'am');
}

function slugify(s, i) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g,'-') + '-' + i;
}

// ── The Deep Scraper ─────────────────────────────────────────────────────────
async function scrapeShowtimes() {
  const { default: fetch } = await import('node-fetch');
  const { load } = await import('cheerio');

  try {
    const res = await fetch('https://www.baycitycinemas.com/', {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.google.com/',
        'DNT': '1'
      },
      timeout: 30000 
    });

    if (!res.ok) throw new Error('Site Blocked: ' + res.status);
    
    const html = await res.text();
    const $    = load(html);
    const showtimes = [];
    let idx = 0;

    // STRATEGY A: Check for standard movie blocks
    const items = $('.movie-list-item, .movie-container, .film-item, article, .movie-card');
    
    if (items.length > 0) {
        items.each((_, el) => {
            const title = $(el).find('h2, h3, .title, .movie-title').first().text().trim();
            if (!title || title.length < 2) return;

            const text = $(el).text();
            const timeRx = /\b(\d{1,2}:\d{2}\s*[ap]m?)\b/gi;
            const times = [...new Set((text.match(timeRx) || []).map(t => t.replace(/\s/g,'').toLowerCase()))];

            const durMatch = text.match(/(\d+)h\s*(\d+)m/);
            const runtime = durMins(durMatch ? durMatch[0] : '2h 0m');

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
    }

    // STRATEGY B: Fallback - Scan every single text node for times if Strategy A failed
    if (showtimes.length === 0) {
        $('div, p, span, li').each((_, el) => {
            const text = $(el).text();
            if (text.length > 500) return; // Skip massive blocks

            const timeRx = /\b(\d{1,2}:\d{2}\s*[ap]m?)\b/gi;
            const foundTimes = text.match(timeRx);
            
            if (foundTimes) {
                // Look "upwards" for the nearest title
                const title = $(el).prevAll('h1, h2, h3, h4').first().text().trim() || 
                              $(el).closest('div').find('h2, h3, h4').first().text().trim();
                
                if (title && title.length > 2) {
                    foundTimes.forEach(t => {
                        const cleanTime = t.replace(/\s/g,'').toLowerCase();
                        showtimes.push({
                            movieId: slugify(title, idx++),
                            movie: title,
                            rating: 'NR',
                            theater: 'General',
                            startTime: cleanTime,
                            endTime: minsToTime(timeMins(cleanTime) + 135), // Default 2hr 15min
                            endMins: timeMins(cleanTime) + 135
                        });
                    });
                }
            }
        });
    }

    return showtimes.sort((a, b) => a.endMins - b.endMins);
  } catch (err) {
    console.error('Scraper error:', err.message);
    return [];
  }
}

// ── Cache Logic ─────────────────────────────────────────────────────────────
let cache = { date: '', showtimes: [] };

async function refreshCache() {
  const data = await scrapeShowtimes();
  if (data && data.length > 0) {
    cache = { 
      date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' }), 
      showtimes: data 
    };
  }
}

refreshCache();
setInterval(refreshCache, 20 * 60 * 1000); 

app.get('/showtimes', (req, res) => {
  res.json({ ok: true, date: cache.date, showtimes: cache.showtimes });
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/', (req, res) => {
  res.send(`<h1>API Status: Online</h1><p>Movies in cache: ${cache.showtimes.length}</p><p>Latest update: ${cache.date}</p>`);
});

app.listen(PORT, () => console.log('Server live'));
