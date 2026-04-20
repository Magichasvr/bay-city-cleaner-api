const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Helper to wait between "clicks" so the theater doesn't block us
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 15000
        });

        const $ = cheerio.load(response.data);
        const ticketTasks = [];

        $('div, section, article, .movie-container').each((_, block) => {
            const $block = $(block);
            let title = $block.find('h1, h2, h3, .movie-title, .title').first().text().trim();
            
            // Hard block for the banner
            if (!title || title.length < 5) return;
            const lowTitle = title.toLowerCase();
            if (lowTitle.includes("bay city cinemas") || lowTitle === "movies") return;

            // Find ticket links within this specific movie block
            $block.find('a[href*="/tickets/"]').each((__, link) => {
                const $link = $(link);
                const timeText = $link.text().trim();
                const timeMatch = timeText.match(/\b(\d{1,2}:\d{2}\s*[ap]m?)\b/i);

                if (timeMatch) {
                    const t = timeMatch[1].replace(/\s/g, '').toLowerCase();
                    let ticketUrl = $link.attr('href');
                    if (ticketUrl.startsWith('/')) ticketUrl = 'https://www.baycitycinemas.com' + ticketUrl;
                    
                    ticketTasks.push({ title, t, ticketUrl, lowTitle });
                }
            });
        });

        // Visit each ticket page one-by-one with a tiny delay
        for (const task of ticketTasks) {
            try {
                // Wait 300ms between requests to avoid being blocked
                await sleep(300); 
                
                const tixRes = await axios.get(task.ticketUrl, { 
                    headers: { 'User-Agent': 'Mozilla/5.0' },
                    timeout: 6000 
                });
                const $tix = cheerio.load(tixRes.data);
                const pageText = $tix('body').text();
                
                // Hunt for "Auditorium X"
                const audMatch = pageText.match(/Auditorium\s*(\d+)/i) || pageText.match(/Theater\s*(\d+)/i);
                let aud = audMatch ? `Aud ${audMatch[1]}` : "Std";
                
                if (task.lowTitle.includes('gdx')) aud = "GDX";

                const cleanTitle = task.title.replace(/gdx/gi, '').trim();
                const fingerprint = `${cleanTitle.toLowerCase()}|${task.t}`;

                if (!seen.has(fingerprint)) {
                    seen.add(fingerprint);
                    const start = timeMins(task.t);
                    showtimes.push({
                        movieId: cleanTitle.toLowerCase().replace(/[^a-z]/g,'') + '-' + start,
                        movie: cleanTitle,
                        theater: task.lowTitle.includes('gdx') ? 'GDX' : 'General',
                        auditorium: aud, 
                        startTime: task.t,
                        endTime: minsToTime(start + 135),
                        endMins: start + 135
                    });
                }
            } catch (e) { continue; }
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
app.get('/', (req, res) => res.send(`Online: ${cache.showtimes.length} movies with Auditorium numbers.`));
app.listen(PORT);
