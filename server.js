const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// ── Time Helpers ─────────────────────────────────────────────────────────────
function timeMins(str) {
    str = str.trim().toLowerCase().replace('am', 'a').replace('pm', 'p');
    const pm = str.endsWith('p');
    const t = str.replace(/[ap]$/, '');
    let [h, m] = t.split(':').map(Number);
    if (isNaN(m)) m = 0;
    if (pm && h !== 12) h += 12;
    if (!pm && h === 12) h = 0;
    return h * 60 + m;
}

function minsToTime(mins) {
    mins = ((mins % 1440) + 1440) % 1440;
    const h = Math.floor(mins / 60), m = mins % 60;
    return (h % 12 || 12) + ':' + String(m).padStart(2, '0') + (h >= 12 ? 'pm' : 'am');
}

// ── The Scraper ──────────────────────────────────────────────────────────────
async function scrapeShowtimes() {
    const showtimes = [];
    try {
        const response = await axios.get('https://www.baycitycinemas.com/', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://www.google.com/',
                'Cache-Control': 'no-cache'
            },
            timeout: 20000
        });

        const $ = cheerio.load(response.data);
        let idx = 0;

        // Modern theater sites often put titles in <h3> or <a> tags inside movie-container classes
        $('h3, .movie-title, .title, h2').each((_, el) => {
            const title = $(el).text().trim();
            if (!title || title.length < 2 || title.toLowerCase().includes('coming soon')) return;

            // Get the block surrounding this movie title
            const block = $(el).closest('div, section, li, article').first();
            const text = block.text();

            // Match times like 12:30pm, 4:00p, 10:45am
            const timeRx = /\b(\d{1,2}:\d{2}\s*[ap]m?)\b/gi;
            const times = [...new Set((text.match(timeRx) || []).map(t => t.replace(/\s/g, '').toLowerCase()))];

            if (times.length > 0) {
                // Determine runtime (default 2h 15m if not found)
                const durMatch = text.match(/(\d+)h\s*(\d+)m/);
                const runtime = durMatch ? (parseInt(durMatch[1]) * 60 + parseInt(durMatch[2])) : 135;

                times.forEach(t => {
                    const start = timeMins(t);
                    const end = start + runtime + 15; // 15 min buffer for cleaning
                    showtimes.push({
                        movieId: title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + idx++,
                        movie: title,
                        rating: (text.match(/\b(NR|G|PG-13|PG|R)\b/) || ['', 'NR'])[1],
                        theater: title.includes('GDX') ? 'GDX' : 'General',
                        startTime: t,
                        endTime: minsToTime(end),
                        endMins: end
                    });
                });
            }
        });

        return showtimes.sort((a, b) => a.endMins - b.endMins);
    } catch (err) {
        console.error('Fetch Failed:', err.message);
        return [];
    }
}

// ── App Logic ───────────────────────────────────────────────────────────────
let cache = { date: '', showtimes: [] };

async function refresh() {
    console.log("Scraping theater website...");
    const data = await scrapeShowtimes();
    if (data.length > 0) {
        cache = {
            date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' }),
            showtimes: data
        };
        console.log(`Success! Found ${data.length} showtimes.`);
    } else {
        console.log("No showtimes found. Theater site might be blocking us.");
    }
}

refresh();
setInterval(refresh, 20 * 60 * 1000);

app.get('/showtimes', (req, res) => res.json({ ok: true, ...cache }));
app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/', (req, res) => {
    res.send(`<h1>API Status: Online</h1><p>Movies Found: ${cache.showtimes.length}</p>`);
});

app.listen(PORT, () => console.log('Server live'));
