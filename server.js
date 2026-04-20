const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// --- HELPERS ---
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

async function fetchPage(url) {
    const { data } = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 10000
    });
    return cheerio.load(data);
}

// --- SCRAPER ---
async function scrapeShowtimes() {
    const showtimes = [];
    const seen = new Set();
    const movieLinks = new Set();
    const todayStr = new Date().toISOString().split('T')[0]; // 2026-04-19

    try {
        // 1. Get all movie links from the homepage
        const $ = await fetchPage('https://www.baycitycinemas.com/');
        $('a[href*="/movie/"]').each((_, el) => {
            let href = $(el).attr('href');
            if (href.startsWith('/')) href = 'https://www.baycitycinemas.com' + href;
            movieLinks.add(href);
        });

        // 2. Visit each movie page to get times
        for (let link of movieLinks) {
            try {
                const $m = await fetchPage(link);
                const title = $m('h1, h2').first().text().trim();
                if (!title || title.toLowerCase().includes('coming soon')) continue;

                // Look specifically at the block for today
                $m('.showtimes, .movie-showtimes, .dates-container').each((_, block) => {
                    const $block = $m(block);
                    const blockText = $block.text();
                    
                    // Only scrape if it's for Today
                    if (!blockText.includes('Today') && !blockText.includes('Sun 19')) return;

                    const times = blockText.match(/\b(\d{1,2}:\d{2}\s*[ap]m?)\b/gi);
                    if (times) {
                        const runtime = parseInt(blockText.match(/(\d+)h/)?.[1] || 2) * 60 + 15;
                        
                        times.forEach(t => {
                            const isGDX = title.includes('GDX') || blockText.includes('GDX');
                            const type = isGDX ? 'GDX' : (blockText.includes('Flashback') ? 'Flashback' : 'General');
                            
                            const fingerprint = `${title}|${t}|${type}`;
                            if (!seen.has(fingerprint)) {
                                seen.add(fingerprint);
                                const start = timeMins(t);
                                showtimes.push({
                                    movieId: title.toLowerCase().replace(/[^a-z]/g,'') + start,
                                    movie: title.replace('GDX', '').trim(),
                                    theater: type,
                                    startTime: t,
                                    endTime: minsToTime(start + runtime + 15),
                                    endMins: start + runtime + 15
                                });
                            }
                        });
                    }
                });
            } catch (e) { continue; }
        }
        return showtimes.sort((a, b) => a.endMins - b.endMins);
    } catch (err) { return []; }
}

let cache = { date: 'April 19', showtimes: [] };
async function refresh() {
    const data = await scrapeShowtimes();
    if (data.length > 0) cache.showtimes = data;
}

refresh();
setInterval(refresh, 30 * 60 * 1000);

app.get('/showtimes', (req, res) => res.json({ ok: true, ...cache }));
app.get('/', (req, res) => res.send(`Loaded ${cache.showtimes.length} movies via Deep Scan.`));
app.listen(PORT);
