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
    const junkText = ["showtimes", "trailers", "coming soon", "bay city cinemas", "theater info", "wrestlemania", "wwe"];

    try {
        const response = await axios.get('https://www.baycitycinemas.com/', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 25000
        });

        const $ = cheerio.load(response.data);
        let idx = 0;

        // Force scan EVERY container that looks like a movie card or special event
        $('div, section, article, .movie-list-item, .film-item, .event-item').each((_, block) => {
            const $block = $(block);
            let title = $block.find('h1, h2, h3, h4, .movie-title, .title, .event-title').first().text().trim();
            
            if (!title || title.length < 2) return;
            if (junkText.some(junk => title.toLowerCase().includes(junk))) return;

            const blockText = $block.text();
            
            // Allow "The Mummy" or "Flashback" even if the date filter is being tricky
            const isSpecial = title.toLowerCase().includes('mummy') || blockText.toLowerCase().includes('flashback');

            const otherDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].filter(d => d !== todayName);
            if (!isSpecial && otherDays.some(day => blockText.includes(day)) && !blockText.includes('Today')) return;

            const timeRx = /\b(\d{1,2}:\d{2}\s*[ap]m?)\b/gi;
            const foundTimes = blockText.match(timeRx);

            if (foundTimes) {
                const times = [...new Set(foundTimes.map(t => t.replace(/\s/g, '').toLowerCase()))];
                const durMatch = blockText.match(/(\d+)h\s*(\d+)m/);
                const runtime = durMatch ? (parseInt(durMatch[1]) * 60 + parseInt(durMatch[2])) : 125;

                times.forEach(t => {
                    const isGDX = title.toUpperCase().includes('GDX') || blockText.toUpperCase().includes('GDX');
                    const theaterName = isGDX ? 'GDX' : (blockText.toLowerCase().includes('flashback') ? 'Flashback' : 'General');
                    
                    const cleanTitle = title.replace(/gdx/gi, '').trim();
                    const fingerprint = `${cleanTitle.toLowerCase()}|${t}|${theaterName}`;

                    if (!seen.has(fingerprint)) {
                        seen.add(fingerprint);
                        const start = timeMins(t);
                        const end = start + runtime + 15;
                        
                        showtimes.push({
                            movieId: cleanTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + idx++,
                            movie: cleanTitle,
                            rating: (blockText.match(/\b(NR|G|PG-13|PG|R)\b/) || ['', 'NR'])[1],
                            theater: theaterName,
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
app.get('/', (req, res) => res.send(`Full Day: ${cache.showtimes.length} movies. Mummy search active.`));
app.listen(PORT);
