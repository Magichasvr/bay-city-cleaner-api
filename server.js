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
    const seen = new Set(); // This tracks duplicates

    try {
        const response = await axios.get('https://www.baycitycinemas.com/', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
                'Referer': 'https://www.google.com/'
            },
            timeout: 25000
        });

        const $ = cheerio.load(response.data);
        let idx = 0;

        $('div, section, article').each((_, block) => {
            const $block = $(block);
            const title = $block.find('h2, h3, .movie-title, .title').first().text().trim();
            if (!title || title.length < 2 || title.toLowerCase().includes('coming soon')) return;

            const blockText = $block.text();
            const timeRx = /\b(\d{1,2}:\d{2}\s*[ap]m?)\b/gi;
            const foundTimes = blockText.match(timeRx);

            if (foundTimes) {
                const times = [...new Set(foundTimes.map(t => t.replace(/\s/g, '').toLowerCase()))];
                const durMatch = blockText.match(/(\d+)h\s*(\d+)m/);
                const runtime = durMatch ? (parseInt(durMatch[1]) * 60 + parseInt(durMatch[2])) : 130;

                times.forEach(t => {
                    // CREATE A UNIQUE ID for this specific showtime
                    // Format: "Movie Name | 7:30pm"
                    const fingerprint = `${title.toLowerCase()}|${t}`;
                    
                    // If we haven't seen this movie at this time yet, add it
                    if (!seen.has(fingerprint)) {
                        seen.add(fingerprint);
                        
                        const start = timeMins(t);
                        const end = start + runtime + 15;
                        
                        showtimes.push({
                            movieId: title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + idx++,
                            movie: title,
                            rating: (blockText.match(/\b(NR|G|PG-13|PG|R)\b/) || ['', 'NR'])[1],
                            theater: title.includes('GDX') ? 'GDX' : 'General',
                            startTime: t,
                            endTime: minsToTime(end),
                            endMins: end
                        });
                    }
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
    let data = await scrapeShowtimes();
    
    if (data.length === 0) {
        data = [
            { movieId: 'mario-manual', movie: 'Manual Entry: Error Loading', rating: 'PG', theater: 'General', startTime: '7:00p', endTime: '9:00p', endMins: 540 }
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
    res.send(`<h1>API Status: Online</h1><p>Movies Found: ${cache.showtimes.length} (De-duplicated)</p><p>Date: ${cache.date}</p>`);
});

app.listen(PORT, () => console.log('Server live'));
