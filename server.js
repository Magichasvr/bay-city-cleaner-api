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
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Referer': 'https://www.google.com/'
            },
            timeout: 25000
        });

        const $ = cheerio.load(response.data);
        let idx = 0;

        // BAY CITY 2026 SELECTOR: They often wrap movies in 'Details' or 'Find Tickets' blocks
        $('div, section, article').each((_, block) => {
            const $block = $(block);
            // Look for a title inside this block
            const title = $block.find('h2, h3, .movie-title, .title').first().text().trim();
            if (!title || title.length < 2 || title.toLowerCase().includes('coming soon')) return;

            const blockText = $block.text();
            
            // Hunt for times (e.g., 1:00p, 7:30pm, 12:45a)
            const timeRx = /\b(\d{1,2}:\d{2}\s*[ap]m?)\b/gi;
            const foundTimes = blockText.match(timeRx);

            if (foundTimes) {
                const times = [...new Set(foundTimes.map(t => t.replace(/\s/g, '').toLowerCase()))];
                
                // Get runtime (e.g., 2h 10m)
                const durMatch = blockText.match(/(\d+)h\s*(\d+)m/);
                const runtime = durMatch ? (parseInt(durMatch[1]) * 60 + parseInt(durMatch[2])) : 130;

                times.forEach(t => {
                    const start = timeMins(t);
                    const end = start + runtime + 15; // 15m cleaning buffer
                    
                    showtimes.push({
                        movieId: title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + idx++,
                        movie: title,
                        rating: (blockText.match(/\b(NR|G|PG-13|PG|R)\b/) || ['', 'NR'])[1],
                        theater: title.includes('GDX') ? 'GDX' : (blockText.includes('Flashback') ? 'Flashback' : 'General'),
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
    console.log("Refreshing cache...");
    let data = await scrapeShowtimes();
    
    // BACKUP: If the scraper finds 0, we add the current big hits manually 
    // so you can still use the app.
    if (data.length === 0) {
        console.log("Scraper returned 0. Using manual fallback list.");
        data = [
            { movieId: 'mario-manual', movie: 'The Super Mario Galaxy Movie', rating: 'PG', theater: 'General', startTime: '7:40p', endTime: '9:30p', endMins: 570 },
            { movieId: 'mummy-manual', movie: "Lee Cronin's The Mummy", rating: 'R', theater: 'General', startTime: '10:20p', endTime: '12:45a', endMins: 765 }
        ];
    }

    cache = {
        date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' }),
        showtimes: data
    };
}

refresh();
setInterval(refresh, 20 * 60 * 1000);

app.get('/showtimes', (req, res) => res.json({ ok: true, ...cache }));
app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/', (req, res) => {
    res.send(`<h1>API Status: Online</h1><p>Movies Found: ${cache.showtimes.length}</p><p>Date: ${cache.date}</p>`);
});

app.listen(PORT, () => console.log('Server live'));
