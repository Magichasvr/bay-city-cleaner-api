const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

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

async function scrapeShowtimes() {
    const showtimes = [];
    const seen = new Set();
    
    // Get current time in minutes to hide old movies
    const now = new Date();
    const currentMins = (now.getHours() * 60) + now.getMinutes();

    try {
        const response = await axios.get('https://www.baycitycinemas.com/', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 20000
        });

        const $ = cheerio.load(response.data);
        let idx = 0;

        $('div, section, article').each((_, block) => {
            const $block = $(block);
            const title = $block.find('h2, h3, .movie-title').first().text().trim();
            if (!title || title.length < 2) return;

            const blockText = $block.text();
            // Only look at blocks that don't say they are for a future day
            if (blockText.match(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)/i) && !blockText.includes('Today')) return;

            const timeRx = /\b(\d{1,2}:\d{2}\s*[ap]m?)\b/gi;
            const foundTimes = blockText.match(timeRx);

            if (foundTimes) {
                const times = [...new Set(foundTimes.map(t => t.replace(/\s/g, '').toLowerCase()))];
                const durMatch = blockText.match(/(\d+)h\s*(\d+)m/);
                const runtime = durMatch ? (parseInt(durMatch[1]) * 60 + parseInt(durMatch[2])) : 120;

                times.forEach(t => {
                    const start = timeMins(t);
                    const end = start + runtime + 15;
                    
                    // --- THE FIX: TIME FILTER ---
                    // Skip movies that ended more than 30 minutes ago
                    if (end < (currentMins - 30)) return;

                    const fingerprint = `${title.toLowerCase()}|${t}`;
                    if (!seen.has(fingerprint)) {
                        seen.add(fingerprint);
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
        return [];
    }
}

let cache = { date: '', showtimes: [] };

async function refresh() {
    let data = await scrapeShowtimes();
    cache = {
        date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' }),
        showtimes: data
    };
}

refresh();
setInterval(refresh, 15 * 60 * 1000);

app.get('/showtimes', (req, res) => res.json({ ok: true, ...cache }));
app.get('/', (req, res) => res.send(`Active: ${cache.showtimes.length} movies remaining.`));
app.listen(PORT);
