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

        // 1. Find all movie blocks
        const movieBlocks = $('div, section, article, .movie-container').toArray();

        for (const block of movieBlocks) {
            const $block = $(block);
            let title = $block.find('h1, h2, h3, .movie-title, .title').first().text().trim();
            
            // Filter Junk
            if (!title || title.length < 5) continue;
            const lowTitle = title.toLowerCase();
            if (lowTitle.includes("bay city cinemas") || lowTitle.includes("mystery") || lowTitle === "movies") continue;

            // 2. Find Ticket Links in this block
            const ticketLinks = $block.find('a[href*="/tickets/"]');

            for (let i = 0; i < ticketLinks.length; i++) {
                const linkEl = $(ticketLinks[i]);
                const timeText = linkEl.text().trim();
                const timeMatch = timeText.match(/\b(\d{1,2}:\d{2}\s*[ap]m?)\b/i);

                if (timeMatch) {
                    const t = timeMatch[1].replace(/\s/g, '').toLowerCase();
                    let ticketUrl = linkEl.attr('href');
                    if (ticketUrl.startsWith('/')) ticketUrl = 'https://www.baycitycinemas.com' + ticketUrl;

                    try {
                        // 3. VISIT THE TICKET PAGE FOR THE AUDITORIUM
                        const ticketPage = await axios.get(ticketUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 5000 });
                        const $tix = cheerio.load(ticketPage.data);
                        
                        // Look for "Auditorium X" or "Theater X"
                        let aud = "Standard";
                        const pageText = $tix('body').text();
                        const audMatch = pageText.match(/Auditorium\s*(\d+)/i) || pageText.match(/Theater\s*(\d+)/i);
                        
                        if (audMatch) {
                            aud = `Aud ${audMatch[1]}`;
                        } else if (lowTitle.includes('gdx')) {
                            aud = "GDX";
                        }

                        const cleanTitle = title.replace(/gdx/gi, '').trim();
                        const fingerprint = `${cleanTitle.toLowerCase()}|${t}`;

                        if (!seen.has(fingerprint)) {
                            seen.add(fingerprint);
                            const start = timeMins(t);
                            showtimes.push({
                                movieId: cleanTitle.toLowerCase().replace(/[^a-z]/g,'') + '-' + start,
                                movie: cleanTitle,
                                theater: lowTitle.includes('gdx') ? 'GDX' : 'General',
                                auditorium: aud, 
                                startTime: t,
                                endTime: minsToTime(start + 135),
                                endMins: start + 135
                            });
                        }
                    } catch (err) {
                        // If ticket page fails, just skip auditorium
                        continue;
                    }
                }
            }
        }

        return showtimes.sort((a, b) => a.endMins - b.endMins);
    } catch (err) {
        return [];
    }
}

let cache = { date: 'April 20', showtimes: [] };
async function refresh() {
    const data = await scrapeShowtimes();
    if (data.length > 0) cache.showtimes = data;
}

refresh();
setInterval(refresh, 20 * 60 * 1000);

app.get('/showtimes', (req, res) => res.json({ ok: true, ...cache }));
app.get('/', (req, res) => res.send(`Online: ${cache.showtimes.length} movies with deep-scanned auditoriums.`));
app.listen(PORT);
