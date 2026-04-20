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
            timeout: 10000
        });

        const $ = cheerio.load(response.data);

        // Map out the movies first so we don't have an empty screen
        const blocks = $('div, section, article, .movie-container').toArray();

        for (const block of blocks) {
            const $block = $(block);
            let title = $block.find('h1, h2, h3, .movie-title, .title').first().text().trim();
            
            // Filter Junk
            if (!title || title.length < 5) continue;
            const lowTitle = title.toLowerCase();
            if (lowTitle.includes("bay city cinemas") || lowTitle.includes("mystery") || lowTitle === "movies") continue;

            const timeRx = /\b(\d{1,2}:\d{2}\s*[ap]m?)\b/gi;
            const foundTimes = $block.text().match(timeRx);

            if (foundTimes) {
                const times = [...new Set(foundTimes.map(t => t.replace(/\s/g, '').toLowerCase()))];
                
                for (const t of times) {
                    const cleanTitle = title.replace(/gdx/gi, '').trim();
                    const start = timeMins(t);
                    
                    // AUDITORIUM LOGIC: Look for a link in this block that matches this time
                    const ticketLink = $block.find(`a:contains("${t}"), a:contains("${t.toUpperCase()}")`).attr('href');
                    let aud = "Scanning..."; // Placeholder while background scan happens

                    if (lowTitle.includes('gdx')) aud = "GDX";

                    showtimes.push({
                        movieId: cleanTitle.toLowerCase().replace(/[^a-z]/g,'') + '-' + start,
                        movie: cleanTitle,
                        theater: lowTitle.includes('gdx') ? 'GDX' : 'General',
                        auditorium: aud,
                        ticketUrl: ticketLink ? (ticketLink.startsWith('http') ? ticketLink : 'https://www.baycitycinemas.com' + ticketLink) : null,
                        startTime: t,
                        endTime: minsToTime(start + 135),
                        endMins: start + 135
                    });
                }
            }
        }

        // BACKGROUND SCAN: Try to grab numbers for the first 10 movies quickly
        // We limit this so the server doesn't crash/timeout
        const sorted = showtimes.sort((a, b) => a.endMins - b.endMins);
        
        for (let i = 0; i < Math.min(sorted.length, 12); i++) {
            if (sorted[i].ticketUrl && sorted[i].auditorium === "Scanning...") {
                try {
                    const tixRes = await axios.get(sorted[i].ticketUrl, { timeout: 3000 });
                    const $tix = cheerio.load(tixRes.data);
                    const audMatch = $tix('body').text().match(/(?:Auditorium|Theater)\s*(\d+)/i);
                    if (audMatch) sorted[i].auditorium = "Aud " + audMatch[1];
                } catch (e) {
                    sorted[i].auditorium = "Std";
                }
            }
        }

        return sorted;
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
setInterval(refresh, 15 * 60 * 1000);

app.get('/showtimes', (req, res) => res.json({ ok: true, ...cache }));
app.get('/', (req, res) => res.send(`Live: ${cache.showtimes.length} movies.`));
app.listen(PORT);
