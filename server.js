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

        $('div, section, article, .movie-container').each((_, block) => {
            const $block = $(block);
            let title = $block.find('h1, h2, h3, .movie-title, .title').first().text().trim();
            
            // Nuclear Banner/Junk Block
            if (!title || title.length < 5) return;
            const lowTitle = title.toLowerCase();
            if (lowTitle.includes("bay city cinemas") || 
                lowTitle.includes("mystery movie monday") || 
                lowTitle === "movies") return;

            const blockText = $block.text();
            
            // Date Filter
            const otherDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].filter(d => d !== todayName);
            if (otherDays.some(day => blockText.includes(day)) && !blockText.includes('Today')) return;

            // Find all showtime buttons/links in this block
            $block.find('a, button').each((__, btn) => {
                const $btn = $(btn);
                const btnText = $btn.text().trim();
                const timeMatch = btnText.match(/\b(\d{1,2}:\d{2}\s*[ap]m?)\b/i);

                if (timeMatch) {
                    const t = timeMatch[1].replace(/\s/g, '').toLowerCase();
                    
                    // --- AUDITORIUM DETECTION ---
                    // Scrape the data attributes or the link itself for theatre ID
                    let audNum = $btn.attr('data-theatre') || 
                                 $btn.attr('data-aud') || 
                                 $btn.attr('data-auditorium') ||
                                 "";
                    
                    // Fallback: Check the href link for a theatre code (e.g., ...&theatre=5)
                    const href = $btn.attr('href') || "";
                    const hrefMatch = href.match(/[?&](?:theatre|aud)=(\d+)/i);
                    if (!audNum && hrefMatch) audNum = hrefMatch[1];

                    const isGDX = lowTitle.includes('gdx') || blockText.toLowerCase().includes('gdx');
                    const type = isGDX ? 'GDX' : (lowTitle.includes('mummy') ? 'Flashback' : 'General');
                    
                    // Final formatting
                    let auditorium = isGDX ? "GDX" : (audNum ? `Aud ${audNum}` : "Check Tix");

                    const cleanTitle = title.replace(/gdx/gi, '').trim();
                    const fingerprint = `${cleanTitle.toLowerCase()}|${t}|${type}`;

                    if (!seen.has(fingerprint)) {
                        seen.add(fingerprint);
                        const start = timeMins(t);
                        showtimes.push({
                            movieId: cleanTitle.toLowerCase().replace(/[^a-z]/g,'') + '-' + start,
                            movie: cleanTitle,
                            theater: type,
                            auditorium: auditorium, 
                            startTime: t,
                            endTime: minsToTime(start + 135),
                            endMins: start + 135
                        });
                    }
                }
            });
        });

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
app.get('/', (req, res) => res.send(`Online: ${cache.showtimes.length} movies loaded.`));
app.listen(PORT);
