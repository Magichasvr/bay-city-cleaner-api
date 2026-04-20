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

    try {
        const response = await axios.get('https://www.baycitycinemas.com/', {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 15000
        });

        const $ = cheerio.load(response.data);

        // Scan every possible movie container
        $('div, section, article, .movie-container, .film-item').each((_, block) => {
            const $block = $(block);
            const title = $block.find('h1, h2, h3, .movie-title, .title').first().text().trim();
            if (!title || title.length < 3) return;

            const blockText = $block.text();
            
            // Check for times
            const timeRx = /\b(\d{1,2}:\d{2}\s*[ap]m?)\b/gi;
            const foundTimes = blockText.match(timeRx);

            if (foundTimes) {
                const times = [...new Set(foundTimes.map(t => t.replace(/\s/g, '').toLowerCase()))];
                
                times.forEach(t => {
                    // Logic to detect GDX and Mummy/Flashback
                    const isGDX = title.includes('GDX') || blockText.includes('GDX') || blockText.includes('Reserved Seating');
                    const isMummy = title.toLowerCase().includes('mummy');
                    const isFlashback = blockText.includes('Flashback') || isMummy;
                    
                    const theaterType = isGDX ? 'GDX' : (isFlashback ? 'Flashback' : 'General');
                    const cleanTitle = title.replace('GDX', '').trim();

                    const fingerprint = `${cleanTitle}|${t}|${theaterType}`;
                    if (!seen.has(fingerprint)) {
                        seen.add(fingerprint);
                        const start = timeMins(t);
                        showtimes.push({
                            movieId: cleanTitle.toLowerCase().replace(/[^a-z]/g,'') + start,
                            movie: cleanTitle,
                            theater: theaterType,
                            startTime: t,
                            endTime: minsToTime(start + 135), // Assume ~2h 15m runtime
                            endMins: start + 135
                        });
                    }
                });
            }
        });

        return showtimes.sort((a, b) => a.endMins - b.endMins);
    } catch (err) {
        console.error("Scrape Error:", err.message);
        return [];
    }
}

let cache = { date: 'April 19', showtimes: [] };
async function refresh() {
    const data = await scrapeShowtimes();
    if (data.length > 0) cache.showtimes = data;
}

refresh();
setInterval(refresh, 20 * 60 * 1000);

app.get('/showtimes', (req, res) => res.json({ ok: true, ...cache }));
app.get('/', (req, res) => res.send(`Online: ${cache.showtimes.length} movies loaded.`));
app.listen(PORT);
