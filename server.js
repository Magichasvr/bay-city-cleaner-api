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
    const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });

    // Blocklist for specific text you don't want as "movies"
    const junkText = [
        "movies at bay city cinemas", 
        "mystery movie monday", 
        "wrestlemania", 
        "wwe", 
        "theater info", 
        "coming soon", 
        "showtimes", 
        "trailers"
    ];

    try {
        const response = await axios.get('https://www.baycitycinemas.com/', {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 20000
        });

        const $ = cheerio.load(response.data);
        let idx = 0;

        $('div, section, article, .movie-container').each((_, block) => {
            const $block = $(block);
            let title = $block.find('h1, h2, h3, .movie-title').first().text().trim();
            
            if (!title || title.length < 3) return;

            // --- FILTER JUNK ---
            const lowTitle = title.toLowerCase();
            if (junkText.some(junk => lowTitle.includes(junk))) return;

            const blockText = $block.text();
            
            // Only scrape today's showtimes
            const otherDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].filter(d => d !== todayName);
            if (otherDays.some(day => blockText.includes(day)) && !blockText.includes('Today')) return;

            const timeRx = /\b(\d{1,2}:\d{2}\s*[ap]m?)\b/gi;
            const foundTimes = blockText.match(timeRx);

            if (foundTimes) {
                const times = [...new Set(foundTimes.map(t => t.replace(/\s/g, '').toLowerCase()))];
                
                times.forEach(t => {
                    const isGDX = lowTitle.includes('gdx') || blockText.toLowerCase().includes('gdx') || blockText.includes('Reserved');
                    const isMummy = lowTitle.includes('mummy');
                    const theaterName = isGDX ? 'GDX' : (isMummy ? 'Flashback' : 'General');
                    
                    const cleanTitle = title.replace(/gdx/gi, '').trim();
                    const fingerprint = `${cleanTitle.toLowerCase()}|${t}|${theaterName}`;

                    if (!seen.has(fingerprint)) {
                        seen.add(fingerprint);
                        const start = timeMins(t);
                        showtimes.push({
                            movieId: cleanTitle.toLowerCase().replace(/[^a-z]/g,'') + '-' + idx++,
                            movie: cleanTitle,
                            theater: theaterName,
                            startTime: t,
                            endTime: minsToTime(start + 135),
                            endMins: start + 135
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

let cache = { date: 'April 20', showtimes: [] };

async function refresh() {
    const data = await scrapeShowtimes();
    if (data.length > 0) {
        cache.showtimes = data;
    }
}

refresh();
setInterval(refresh, 20 * 60 * 1000);

app.get('/showtimes', (req, res) => res.json({ ok: true, ...cache }));
app.get('/', (req, res) => res.send(`Live: ${cache.showtimes.length} movies. Junk filtered.`));
app.listen(PORT);
