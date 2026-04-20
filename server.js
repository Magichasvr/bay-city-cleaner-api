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
    const seen = new Set(); // This is the duplicate killer
    const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });

    try {
        const response = await axios.get('https://www.baycitycinemas.com/', {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 10000
        });

        const $ = cheerio.load(response.data);
        const blocks = $('div, section, article, .movie-container').toArray();

        for (const block of blocks) {
            const $block = $(block);
            let title = $block.find('h1, h2, h3, .movie-title, .title').first().text().trim();
            
            if (!title || title.length < 5) continue;
            const lowTitle = title.toLowerCase();
            
            // Filter Junk & Banners
            if (lowTitle.includes("bay city cinemas") || lowTitle.includes("mystery") || lowTitle === "movies") continue;

            const timeRx = /\b(\d{1,2}:\d{2}\s*[ap]m?)\b/gi;
            const foundTimes = $block.text().match(timeRx);

            if (foundTimes) {
                const times = [...new Set(foundTimes.map(t => t.replace(/\s/g, '').toLowerCase()))];
                
                for (const t of times) {
                    const cleanTitle = title.replace(/gdx/gi, '').trim();
                    const start = timeMins(t);
                    
                    // Create a unique fingerprint for this specific showtime
                    // Format: "Movie Name | 7:00pm"
                    const fingerprint = `${cleanTitle.toLowerCase()}|${t}`;

                    // --- THE DUPLICATE CHECK ---
                    if (seen.has(fingerprint)) continue; 
                    seen.add(fingerprint);

                    const ticketLink = $block.find(`a:contains("${t}"), a:contains("${t.toUpperCase()}")`).attr('href');
                    let aud = lowTitle.includes('gdx') ? "GDX" : "Scanning...";

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

        const sorted = showtimes.sort((a, b) => a.endMins - b.endMins);
        
        // Scan Auditoriums for the next few movies
        for (let i = 0; i < Math.min(sorted.length, 15); i++) {
            if (sorted[i].ticketUrl && sorted[i].auditorium === "Scanning...") {
                try {
                    const tixRes = await axios.get(sorted[i].ticketUrl, { timeout: 3000 });
                    const $tix = cheerio.load(tixRes.data);
                    const audMatch = $tix('body').text().match(/(?:Auditorium|Theater)\s*(\d+)/i);
                    if (audMatch) sorted[i].auditorium = "Aud " + audMatch[1];
                    else sorted[i].auditorium = "Std";
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
app.get('/', (req, res) => res.send(`Live: ${cache.showtimes.length} unique movies loaded.`));
app.listen(PORT);
