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
    
    // Block the WrestleMania and site headers
    const junkText = ["showtimes", "trailers", "wrestlemania", "wwe", "theater info", "coming soon"];

    try {
        const response = await axios.get('https://www.baycitycinemas.com/', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 20000
        });

        const $ = cheerio.load(response.data);
        let idx = 0;

        // TARGETING THE MOVIE BLOCKS
        $('div, article, section').each((_, block) => {
            const $block = $(block);
            let title = $block.find('h1, h2, h3, .movie-title, .title').first().text().trim();
            
            if (!title || title.length < 2) return;
            if (junkText.some(junk => title.toLowerCase().includes(junk))) return;

            const blockText = $block.text();

            // DATE FILTER: Ensure we only get Today (Sun 19)
            // We ignore blocks that mention other days unless they also say "Today"
            const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
            const otherDays = days.filter(d => d !== todayName);
            if (otherDays.some(d => blockText.includes(d)) && !blockText.includes('Today')) return;

            // TIME DETECTION
            const timeRx = /\b(\d{1,2}:\d{2}\s*[ap]m?)\b/gi;
            const foundTimes = blockText.match(timeRx);

            if (foundTimes) {
                const times = [...new Set(foundTimes.map(t => t.replace(/\s/g, '').toLowerCase()))];
                
                // RUNTIME DETECTION
                const durMatch = blockText.match(/(\d+)h\s*(\d+)m/);
                const runtime = durMatch ? (parseInt(durMatch[1]) * 60 + parseInt(durMatch[2])) : 130;

                times.forEach(t => {
                    // --- THE FIX: GDX & FLASHBACK DETECTION ---
                    const isGDX = blockText.includes('GDX') || blockText.includes('Reserved Seating');
                    const isFlashback = blockText.includes('Flashback') || title.includes('Anniversary');
                    
                    const theaterName = isGDX ? 'GDX' : (isFlashback ? 'Flashback' : 'General');
                    const cleanTitle = title.replace(/GDX/g, '').trim();

                    // FINGERPRINT ensures "Mario (GDX)" and "Mario (Standard)" both show up
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
    if (data.length > 0) {
        cache = {
            date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' }),
            showtimes: data
        };
    }
}

refresh();
setInterval(refresh, 20 * 60 * 1000);

app.get('/showtimes', (req, res) => res.json({ ok: true, ...cache }));
app.get('/', (req, res) => res.send(`Full Day: ${cache.showtimes.length} movies. Flashback & GDX scan active.`));
app.listen(PORT);
