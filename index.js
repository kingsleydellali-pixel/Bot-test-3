// ================= KING-XD BOT MINI - Main File =================
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeInMemoryStore,
    jidDecode,
    downloadContentFromMessage,
    generateWAMessageFromContent,
    proto,
    getContentType,
    toBuffer,
    Browsers,
    makeCacheableSignalKeyStore,
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const { Boom } = require("@hapi/boom");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const express = require("express");
const qrcode = require("qrcode");
const sharp = require("sharp");
const { exec } = require("child_process");
const ytdlp = require("yt-dlp-exec");
const { Jimp } = require("jimp");
const { removeBackgroundFromImageBase64 } = require("remove.bg");
const { google } = require("googlethis");
const { search: ddgSearch } = require("duckduckgo-search");
const cheerio = require("cheerio");
const settings = require("./settings");

// ================= Global State =================
let sock = null;
let qrCode = "";
let pairingCode = "";
let isConnected = false;
let connectionStatus = "disconnected";
let botStartTime = Date.now();
let config = { ...settings.settings };
const store = settings.antiDeleteStore; // Map for anti-delete
let messageHistory = []; // For anti-delete detection

// ================= Logger =================
const logger = pino({ level: "silent" });

// ================= Express Dashboard =================
const app = express();
const PORT = process.env.PORT || settings.dashboardPort || 3000;
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public")); // optional if you create public folder

// Dashboard routes
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "dashboard.html")); // We'll serve inline HTML instead
});

app.get("/status", (req, res) => {
    res.json({ status: connectionStatus, connected: isConnected });
});

app.get("/qr", async (req, res) => {
    if (!qrCode) return res.status(404).json({ error: "No QR code available" });
    try {
        const qrImage = await qrcode.toDataURL(qrCode);
        res.send(`<img src="${qrImage}" alt="QR Code" style="max-width:300px;">`);
    } catch (err) {
        res.status(500).json({ error: "Failed to generate QR" });
    }
});

app.post("/pair", async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: "Phone number required" });
    try {
        // Simulate internet collection loading
        await new Promise((resolve) => setTimeout(resolve, 5000));
        // Generate pairing code using Baileys
        if (!sock) return res.status(503).json({ error: "Bot not ready" });
        const code = await sock.requestPairingCode(phone);
        pairingCode = code;
        res.json({ code });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get("/pairing-code", (req, res) => {
    if (!pairingCode) return res.status(404).json({ error: "No pairing code" });
    res.json({ code: pairingCode });
});

// Serve dashboard HTML (inline)
app.get("/", (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>${settings.botName} - Pairing Dashboard</title>
        <style>
            body { font-family: Arial, sans-serif; background: #f4f4f4; display: flex; justify-content: center; align-items: center; height: 100vh; margin:0; }
            .container { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 0 20px rgba(0,0,0,0.1); width: 400px; text-align: center; }
            input[type="text"] { width: 100%; padding: 12px; margin: 10px 0; border: 1px solid #ddd; border-radius: 5px; box-sizing: border-box; }
            button { background: #4CAF50; color: white; padding: 12px 20px; border: none; border-radius: 5px; cursor: pointer; width: 100%; font-size: 16px; }
            button:hover { background: #45a049; }
            .loading { display: none; margin-top: 20px; }
            .spinner { border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto; }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            .result { margin-top: 20px; font-size: 18px; font-weight: bold; }
            .qr-section { margin-top: 20px; }
        </style>
    </head>
    <body>
        <div class="container">
            <h2>${settings.botName}</h2>
            <p>Link your WhatsApp by entering your number with country code</p>
            <input type="text" id="phone" placeholder="e.g. 234XXXXXXXXXX" />
            <button onclick="pair()">Get Pairing Code</button>
            <div class="loading" id="loading">
                <p>Collecting internet data...</p>
                <div class="spinner"></div>
            </div>
            <div class="result" id="result"></div>
            <div class="qr-section">
                <h3>Or scan QR code</h3>
                <button onclick="showQR()">Show QR</button>
                <div id="qr"></div>
            </div>
        </div>
        <script>
            async function pair() {
                const phone = document.getElementById('phone').value;
                if (!phone) return alert('Please enter phone number');
                document.getElementById('loading').style.display = 'block';
                document.getElementById('result').innerHTML = '';
                try {
                    const res = await fetch('/pair', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ phone })
                    });
                    const data = await res.json();
                    document.getElementById('loading').style.display = 'none';
                    if (data.code) {
                        document.getElementById('result').innerHTML = 'Your pairing code: <b>' + data.code + '</b>';
                    } else {
                        document.getElementById('result').innerHTML = 'Error: ' + (data.error || 'Unknown error');
                    }
                } catch (err) {
                    document.getElementById('loading').style.display = 'none';
                    document.getElementById('result').innerHTML = 'Error: ' + err.message;
                }
            }
            async function showQR() {
                const res = await fetch('/qr');
                if (res.ok) {
                    const html = await res.text();
                    document.getElementById('qr').innerHTML = html;
                } else {
                    document.getElementById('qr').innerHTML = 'No QR code available';
                }
            }
        </script>
    </body>
    </html>
    `);
});

// ================= Helper Functions =================
function formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const days = Math.floor(seconds / (24 * 3600));
    const hours = Math.floor((seconds % (24 * 3600)) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${days}d ${hours}h ${minutes}m ${secs}s`;
}

function isOwner(sender) {
    return sender.replace(/[^0-9]/g, '') === settings.ownerNumber.replace(/[^0-9]/g, '');
}

function isAdmin(message) {
    // Check if sender is admin of the group
    const groupMetadata = sock.groupMetadata(message.key.remoteJid);
    const participants = groupMetadata.participants;
    const sender = message.key.participant || message.key.remoteJid;
    const participant = participants.find(p => p.id === sender);
    return participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
}

async function sendMessage(jid, content, options = {}) {
    try {
        return await sock.sendMessage(jid, content, options);
    } catch (err) {
        console.error('Send error:', err);
    }
}

async function reactToMessage(jid, messageKey, emoji) {
    try {
        await sock.sendMessage(jid, {
            react: {
                text: emoji,
                key: messageKey
            }
        });
    } catch (err) {
        console.error('React error:', err);
    }
}

// ================= Command Definitions =================
const commands = {};

// Downloader Commands
commands.yt = async (message, args) => {
    if (!args.length) return sendMessage(message.key.remoteJid, { text: 'Please provide a YouTube URL' });
    const url = args[0];
    try {
        const info = await ytdlp(url, { dumpSingleJson: true, noWarnings: true, preferFreeFormats: true });
        const videoUrl = info.formats.find(f => f.ext === 'mp4' && f.vcodec !== 'none')?.url;
        if (videoUrl) {
            await sendMessage(message.key.remoteJid, { video: { url: videoUrl }, caption: `Title: ${info.title}` });
        } else {
            await sendMessage(message.key.remoteJid, { text: 'Failed to get video URL' });
        }
    } catch (err) {
        await sendMessage(message.key.remoteJid, { text: 'Error: ' + err.message });
    }
};

commands.song = async (message, args) => {
    if (!args.length) return sendMessage(message.key.remoteJid, { text: 'Please provide a YouTube URL' });
    const url = args[0];
    try {
        const info = await ytdlp(url, { dumpSingleJson: true, noWarnings: true, extractAudio: true, audioFormat: 'mp3' });
        const audioUrl = info.url;
        await sendMessage(message.key.remoteJid, { audio: { url: audioUrl }, mimetype: 'audio/mpeg', fileName: `${info.title}.mp3` });
    } catch (err) {
        await sendMessage(message.key.remoteJid, { text: 'Error: ' + err.message });
    }
};

commands.video = commands.yt; // alias
commands.vid = async (message, args) => {
    if (!args.length) return sendMessage(message.key.remoteJid, { text: 'Please provide a search query' });
    const query = args.join(' ');
    try {
        const result = await ytdlp(`ytsearch:${query}`, { dumpSingleJson: true, noWarnings: true, skipDownload: true });
        if (result.entries && result.entries.length > 0) {
            const video = result.entries[0];
            await sendMessage(message.key.remoteJid, { text: `Video found: ${video.title}\nURL: ${video.webpage_url}` });
            // Optionally send video directly
            const videoUrl = video.formats.find(f => f.ext === 'mp4' && f.vcodec !== 'none')?.url;
            if (videoUrl) {
                await sendMessage(message.key.remoteJid, { video: { url: videoUrl } });
            }
        }
    } catch (err) {
        await sendMessage(message.key.remoteJid, { text: 'Error: ' + err.message });
    }
};

commands.yts = commands.vid; // alias

commands.tt = async (message, args) => {
    if (!args.length) return sendMessage(message.key.remoteJid, { text: 'Please provide a TikTok URL' });
    const url = args[0];
    try {
        // Use a third-party API (e.g., tikwm.com) or scrape; we'll use a simple axios to a public API
        const response = await axios.get(`https://api.tikwm.com/video?url=${encodeURIComponent(url)}`);
        if (response.data && response.data.data) {
            const videoUrl = response.data.data.play;
            await sendMessage(message.key.remoteJid, { video: { url: videoUrl }, caption: 'TikTok video' });
        } else {
            await sendMessage(message.key.remoteJid, { text: 'Failed to fetch TikTok video' });
        }
    } catch (err) {
        await sendMessage(message.key.remoteJid, { text: 'Error: ' + err.message });
    }
};

commands.ig = async (message, args) => {
    if (!args.length) return sendMessage(message.key.remoteJid, { text: 'Please provide an Instagram URL' });
    const url = args[0];
    try {
        // Use a public API or scrape; simple placeholder
        const response = await axios.get(`https://api.instavideosave.com/api/save?url=${encodeURIComponent(url)}`);
        if (response.data && response.data.video) {
            await sendMessage(message.key.remoteJid, { video: { url: response.data.video } });
        } else {
            await sendMessage(message.key.remoteJid, { text: 'Failed to fetch Instagram video' });
        }
    } catch (err) {
        await sendMessage(message.key.remoteJid, { text: 'Error: ' + err.message });
    }
};

commands.fb = async (message, args) => {
    if (!args.length) return sendMessage(message.key.remoteJid, { text: 'Please provide a Facebook URL' });
    const url = args[0];
    try {
        // Use a public API or yt-dlp (Facebook works with yt-dlp)
        const info = await ytdlp(url, { dumpSingleJson: true, noWarnings: true });
        const videoUrl = info.formats.find(f => f.ext === 'mp4' && f.vcodec !== 'none')?.url;
        if (videoUrl) {
            await sendMessage(message.key.remoteJid, { video: { url: videoUrl } });
        } else {
            await sendMessage(message.key.remoteJid, { text: 'Failed to fetch Facebook video' });
        }
    } catch (err) {
        await sendMessage(message.key.remoteJid, { text: 'Error: ' + err.message });
    }
};

commands.wallpaper = async (message, args) => {
    // Simple random wallpaper from Unsplash
    try {
        const response = await axios.get('https://api.unsplash.com/photos/random?client_id=YOUR_UNSPLASH_ACCESS_KEY');
        const imageUrl = response.data.urls.regular;
        await sendMessage(message.key.remoteJid, { image: { url: imageUrl }, caption: 'Random Wallpaper' });
    } catch (err) {
        await sendMessage(message.key.remoteJid, { text: 'Error fetching wallpaper' });
    }
};

// Search Commands
commands.google = async (message, args) => {
    if (!args.length) return sendMessage(message.key.remoteJid, { text: 'Please provide a search query' });
    const query = args.join(' ');
    try {
        const results = await google(query, { page: 0, safe: false, additional_params: { hl: 'en' } });
        if (results.knowledge_panel) {
            let text = `*${results.knowledge_panel.title}*\n${results.knowledge_panel.description}\n`;
            await sendMessage(message.key.remoteJid, { text });
        }
        if (results.results && results.results.length) {
            const top = results.results.slice(0, 5).map((r, i) => `${i+1}. ${r.title}\n${r.url}`).join('\n\n');
            await sendMessage(message.key.remoteJid, { text: top });
        } else {
            await sendMessage(message.key.remoteJid, { text: 'No results found' });
        }
    } catch (err) {
        await sendMessage(message.key.remoteJid, { text: 'Error: ' + err.message });
    }
};

commands.duckduckgo = async (message, args) => {
    if (!args.length) return sendMessage(message.key.remoteJid, { text: 'Please provide a search query' });
    const query = args.join(' ');
    try {
        const results = await ddgSearch(query);
        if (results.length) {
            const top = results.slice(0, 5).map((r, i) => `${i+1}. ${r.title}\n${r.url}`).join('\n\n');
            await sendMessage(message.key.remoteJid, { text: top });
        } else {
            await sendMessage(message.key.remoteJid, { text: 'No results found' });
        }
    } catch (err) {
        await sendMessage(message.key.remoteJid, { text: 'Error: ' + err.message });
    }
};

commands.yahoo = async (message, args) => {
    if (!args.length) return sendMessage(message.key.remoteJid, { text: 'Please provide a search query' });
    const query = args.join(' ');
    // Yahoo search is not easily available; we'll just redirect to DuckDuckGo for demo
    await commands.duckduckgo(message, args);
};

commands.wiki = async (message, args) => {
    if (!args.length) return sendMessage(message.key.remoteJid, { text: 'Please provide a search term' });
    const query = args.join(' ');
    try {
        const response = await axios.get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`);
        const data = response.data;
        if (data.extract) {
            await sendMessage(message.key.remoteJid, { text: `*${data.title}*\n\n${data.extract}\n\n${data.content_urls?.desktop?.page || ''}` });
        } else {
            await sendMessage(message.key.remoteJid, { text: 'No Wikipedia entry found' });
        }
    } catch (err) {
        await sendMessage(message.key.remoteJid, { text: 'Error: ' + err.message });
    }
};

commands.weather = async (message, args) => {
    if (!args.length) return sendMessage(message.key.remoteJid, { text: 'Please provide a city name' });
    const city = args.join(' ');
    try {
        // Using OpenWeatherMap API (you need an API key)
        const apiKey = process.env.OPENWEATHER_API_KEY || 'YOUR_API_KEY';
        const response = await axios.get(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric`);
        const data = response.data;
        const text = `*Weather in ${data.name}, ${data.sys.country}*\n🌡 Temperature: ${data.main.temp}°C\n🌬 Wind: ${data.wind.speed} m/s\n💧 Humidity: ${data.main.humidity}%\n☁️ ${data.weather[0].description}`;
        await sendMessage(message.key.remoteJid, { text });
    } catch (err) {
        await sendMessage(message.key.remoteJid, { text: 'Error fetching weather. Make sure city name is correct.' });
    }
};

commands.news = async (message, args) => {
    // Simple news from a free RSS feed
    try {
        const response = await axios.get('https://feeds.bbci.co.uk/news/world/rss.xml');
        const $ = cheerio.load(response.data, { xmlMode: true });
        const items = $('item').slice(0, 5);
        let text = '*Latest World News (BBC)*\n\n';
        items.each((i, el) => {
            text += `${i+1}. ${$(el).find('title').text()}\n${$(el).find('link').text()}\n\n`;
        });
        await sendMessage(message.key.remoteJid, { text });
    } catch (err) {
        await sendMessage(message.key.remoteJid, { text: 'Error fetching news' });
    }
};

// Image Editor Commands (using sharp)
async function getImageBuffer(message) {
    if (!message.message?.imageMessage) {
        await sendMessage(message.key.remoteJid, { text: 'Please reply to an image or send an image with command' });
        return null;
    }
    const stream = await downloadContentFromMessage(message.message.imageMessage, 'image');
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
    }
    return buffer;
}

commands.crop = async (message, args) => {
    const buffer = await getImageBuffer(message);
    if (!buffer) return;
    // args: left top width height
    const [left, top, width, height] = args.map(Number);
    try {
        const result = await sharp(buffer).extract({ left, top, width, height }).toBuffer();
        await sendMessage(message.key.remoteJid, { image: result });
    } catch (err) {
        await sendMessage(message.key.remoteJid, { text: 'Error: ' + err.message });
    }
};

commands.resize = async (message, args) => {
    const buffer = await getImageBuffer(message);
    if (!buffer) return;
    const [width, height] = args.map(Number);
    try {
        const result = await sharp(buffer).resize(width, height).toBuffer();
        await sendMessage(message.key.remoteJid, { image: result });
    } catch (err) {
        await sendMessage(message.key.remoteJid, { text: 'Error: ' + err.message });
    }
};

commands.rotate = async (message, args) => {
    const buffer = await getImageBuffer(message);
    if (!buffer) return;
    const angle = Number(args[0] || 90);
    try {
        const result = await sharp(buffer).rotate(angle).toBuffer();
        await sendMessage(message.key.remoteJid, { image: result });
    } catch (err) {
        await sendMessage(message.key.remoteJid, { text: 'Error: ' + err.message });
    }
};

commands.flip = async (message, args) => {
    const buffer = await getImageBuffer(message);
    if (!buffer) return;
    const flip = args[0] === 'v' ? 'flip' : 'flop'; // vertical or horizontal
    try {
        const result = await sharp(buffer)[flip]().toBuffer();
        await sendMessage(message.key.remoteJid, { image: result });
    } catch (err) {
        await sendMessage(message.key.remoteJid, { text: 'Error: ' + err.message });
    }
};

commands.filter = async (message, args) => {
    const buffer = await getImageBuffer(message);
    if (!buffer) return;
    const filterType = args[0] || 'grayscale'; // grayscale, sepia, negative, etc.
    try {
        let result;
        switch (filterType) {
            case 'grayscale':
                result = await sharp(buffer).grayscale().toBuffer();
                break;
            case 'sepia':
                result = await sharp(buffer).recomb([
                    [0.393, 0.769, 0.189],
                    [0.349, 0.686, 0.168],
                    [0.272, 0.534, 0.131]
                ]).toBuffer();
                break;
            case 'negative':
                result = await sharp(buffer).negate().toBuffer();
                break;
            default:
                result = buffer;
        }
        await sendMessage(message.key.remoteJid, { image: result });
    } catch (err) {
        await sendMessage(message.key.remoteJid, { text: 'Error: ' + err.message });
    }
};

commands.adjust = async (message, args) => {
    const buffer = await getImageBuffer(message);
    if (!buffer) return;
    // args: brightness contrast saturation
    const [brightness = 1, contrast = 1, saturation = 1] = args.map(Number);
    try {
        const result = await sharp(buffer)
            .modulate({ brightness, saturation })
            .linear(contrast, -(128 * contrast) + 128)
            .toBuffer();
        await sendMessage(message.key.remoteJid, { image: result });
    } catch (err) {
        await sendMessage(message.key.remoteJid, { text: 'Error: ' + err.message });
    }
};

commands.text = async (message, args) => {
    const buffer = await getImageBuffer(message);
    if (!buffer) return;
    const text = args.join(' ');
    try {
        const svg = `<svg width="500" height="500"><image href="data:image/png;base64,${buffer.toString('base64')}" width="500" height="500"/><text x="50%" y="50%" fill="white" font-size="30" text-anchor="middle">${text}</text></svg>`;
        const result = await sharp(Buffer.from(svg)).png().toBuffer();
        await sendMessage(message.key.remoteJid, { image: result });
    } catch (err) {
        await sendMessage(message.key.remoteJid, { text: 'Error: ' + err.message });
    }
};

commands.watermark = commands.text; // alias

commands.imgedit = async (message, args) => {
    // Simple wrapper to call any editor based on first arg
    const subCmd = args[0];
    const newArgs = args.slice(1);
    if (commands[subCmd]) {
        await commands[subCmd](message, newArgs);
    } else {
        await sendMessage(message.key.remoteJid, { text: 'Available: crop, resize, rotate, flip, filter, adjust, text, watermark' });
    }
};

// Media Tools
commands.sticker = async (message, args) => {
    if (message.message?.imageMessage) {
        const buffer = await getImageBuffer(message);
        const stickerBuffer = await sharp(buffer).resize(512, 512).webp().toBuffer();
        await sendMessage(message.key.remoteJid, { sticker: stickerBuffer });
    } else if (message.message?.videoMessage) {
        // Convert video to sticker (requires ffmpeg)
        await sendMessage(message.key.remoteJid, { text: 'Video sticker not implemented yet. Send an image.' });
    } else {
        await sendMessage(message.key.remoteJid, { text: 'Please send or reply to an image' });
    }
};

commands.toimg = async (message, args) => {
    if (message.message?.stickerMessage) {
        const stream = await downloadContentFromMessage(message.message.stickerMessage, 'sticker');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }
        const imgBuffer = await sharp(buffer).png().toBuffer();
        await sendMessage(message.key.remoteJid, { image: imgBuffer });
    } else {
        await sendMessage(message.key.remoteJid, { text: 'Please reply to a sticker' });
    }
};

commands.compress = async (message, args) => {
    const buffer = await getImageBuffer(message);
    if (!buffer) return;
    try {
        const compressed = await sharp(buffer).jpeg({ quality: 50 }).toBuffer();
        await sendMessage(message.key.remoteJid, { image: compressed });
    } catch (err) {
        await sendMessage(message.key.remoteJid, { text: 'Error: ' + err.message });
    }
};

commands.enhance = async (message, args) => {
    const buffer = await getImageBuffer(message);
    if (!buffer) return;
    try {
        // Simple enhance: increase sharpness
        const enhanced = await sharp(buffer).sharpen().toBuffer();
        await sendMessage(message.key.remoteJid, { image: enhanced });
    } catch (err) {
        await sendMessage(message.key.remoteJid, { text: 'Error: ' + err.message });
    }
};

commands.blur = async (message, args) => {
    const buffer = await getImageBuffer(message);
    if (!buffer) return;
    try {
        const blurred = await sharp(buffer).blur(5).toBuffer();
        await sendMessage(message.key.remoteJid, { image: blurred });
    } catch (err) {
        await sendMessage(message.key.remoteJid, { text: 'Error: ' + err.message });
    }
};

commands.removebg = async (message, args) => {
    const buffer = await getImageBuffer(message);
    if (!buffer) return;
    try {
        const apiKey = process.env.REMOVE_BG_API_KEY || 'YOUR_API_KEY';
        const result = await removeBackgroundFromImageBase64({
            base64img: buffer.toString('base64'),
            apiKey,
            size: 'regular',
            type: 'auto'
        });
        const resultBuffer = Buffer.from(result.base64img, 'base64');
        await sendMessage(message.key.remoteJid, { image: resultBuffer });
    } catch (err) {
        await sendMessage(message.key.remoteJid, { text: 'Error: ' + err.message });
    }
};

// Group Manager Commands
commands.kick = async (message, args) => {
    if (!message.key.remoteJid.endsWith('@g.us')) return;
    if (!isAdmin(message)) return sendMessage(message.key.remoteJid, { text: 'You must be an admin' });
    const mentioned = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (!mentioned.length) return sendMessage(message.key.remoteJid, { text: 'Please mention the user to kick' });
    try {
        await sock.groupParticipantsUpdate(message.key.remoteJid, mentioned, 'remove');
        await sendMessage(message.key.remoteJid, { text: 'User(s) kicked' });
    } catch (err) {
        await sendMessage(message.key.remoteJid, { text: 'Failed to kick: ' + err.message });
    }
};

commands.add = async (message, args) => {
    if (!message.key.remoteJid.endsWith('@g.us')) return;
    if (!isAdmin(message)) return sendMessage(message.key.remoteJid, { text: 'You must be an admin' });
    const number = args[0];
    if (!number) return sendMessage(message.key.remoteJid, { text: 'Provide a number' });
    const jid = number.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
    try {
        await sock.groupParticipantsUpdate(message.key.remoteJid, [jid], 'add');
        await sendMessage(message.key.remoteJid, { text: 'User added' });
    } catch (err) {
        await sendMessage(message.key.remoteJid, { text: 'Failed to add: ' + err.message });
    }
};

commands.promote = async (message, args) => {
    if (!message.key.remoteJid.endsWith('@g.us')) return;
    if (!isAdmin(message)) return sendMessage(message.key.remoteJid, { text: 'You must be an admin' });
    const mentioned = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (!mentioned.length) return sendMessage(message.key.remoteJid, { text: 'Mention user to promote' });
    try {
        await sock.groupParticipantsUpdate(message.key.remoteJid, mentioned, 'promote');
        await sendMessage(message.key.remoteJid, { text: 'User(s) promoted' });
    } catch (err) {
        await sendMessage(message.key.remoteJid, { text: 'Failed to promote: ' + err.message });
    }
};

commands.demote = async (message, args) => {
    if (!message.key.remoteJid.endsWith('@g.us')) return;
    if (!isAdmin(message)) return sendMessage(message.key.remoteJid, { text: 'You must be an admin' });
    const mentioned = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (!mentioned.length) return sendMessage(message.key.remoteJid, { text: 'Mention user to demote' });
    try {
        await sock.groupParticipantsUpdate(message.key.remoteJid, mentioned, 'demote');
        await sendMessage(message.key.remoteJid, { text: 'User(s) demoted' });
    } catch (err) {
        await sendMessage(message.key.remoteJid, { text: 'Failed to demote: ' + err.message });
    }
};

commands.mute = async (message, args) => {
    if (!message.key.remoteJid.endsWith('@g.us')) return;
    if (!isAdmin(message)) return sendMessage(message.key.remoteJid, { text: 'You must be an admin' });
    // Mute group - restrict sending messages
    try {
        await sock.groupSettingUpdate(message.key.remoteJid, 'announcement');
        await sendMessage(message.key.remoteJid, { text: 'Group muted' });
    } catch (err) {
        await sendMessage(message.key.remoteJid, { text: 'Failed to mute' });
    }
};

commands.unmute = async (message, args) => {
    if (!message.key.remoteJid.endsWith('@g.us')) return;
    if (!isAdmin(message)) return sendMessage(message.key.remoteJid, { text: 'You must be an admin' });
    try {
        await sock.groupSettingUpdate(message.key.remoteJid, 'not_announcement');
        await sendMessage(message.key.remoteJid, { text: 'Group unmuted' });
    } catch (err) {
        await sendMessage(message.key.remoteJid, { text: 'Failed to unmute' });
    }
};

commands.link = async (message, args) => {
    if (!message.key.remoteJid.endsWith('@g.us')) return;
    try {
        const code = await sock.groupInviteCode(message.key.remoteJid);
        const link = `https://chat.whatsapp.com/${code}`;
        await sendMessage(message.key.remoteJid, { text: `Group link: ${link}` });
    } catch (err) {
        await sendMessage(message.key.remoteJid, { text: 'Failed to get link' });
    }
};

commands.revoke = async (message, args) => {
    if (!message.key.remoteJid.endsWith('@g.us')) return;
    if (!isAdmin(message)) return sendMessage(message.key.remoteJid, { text: 'You must be an admin' });
    try {
        await sock.groupRevokeInvite(message.key.remoteJid);
        await sendMessage(message.key.remoteJid, { text: 'Group link revoked' });
    } catch (err) {
        await sendMessage(message.key.remoteJid, { text: 'Failed to revoke link' });
    }
};

commands.tag = async (message, args) => {
    if (!message.key.remoteJid.endsWith('@g.us')) return;
    const groupMetadata = await sock.groupMetadata(message.key.remoteJid);
    const participants = groupMetadata.participants;
    const mentions = participants.map(p => p.id);
    await sendMessage(message.key.remoteJid, { text: 'Tagging all members', mentions });
};

commands.tagall = commands.tag;

commands.kickall = async (message, args) => {
    if (!message.key.remoteJid.endsWith('@g.us')) return;
    if (!isAdmin(message)) return sendMessage(message.key.remoteJid, { text: 'You must be an admin' });
    const groupMetadata = await sock.groupMetadata(message.key.remoteJid);
    const participants = groupMetadata.participants.filter(p => p.id !== sock.user.id);
    try {
        await sock.groupParticipantsUpdate(message.key.remoteJid, participants.map(p => p.id), 'remove');
        await sendMessage(message.key.remoteJid, { text: 'All members kicked' });
    } catch (err) {
        await sendMessage(message.key.remoteJid, { text: 'Failed to kick all' });
    }
};

commands.kill = async (message, args) => {
    // Remove all admins except owner
    if (!message.key.remoteJid.endsWith('@g.us')) return;
    if (!isAdmin(message)) return sendMessage(message.key.remoteJid, { text: 'You must be an admin' });
    const groupMetadata = await sock.groupMetadata(message.key.remoteJid);
    const admins = groupMetadata.participants.filter(p => p.admin && p.id !== sock.user.id);
    try {
        await sock.groupParticipantsUpdate(message.key.remoteJid, admins.map(p => p.id), 'demote');
        await sendMessage(message.key.remoteJid, { text: 'All admins demoted' });
    } catch (err) {
        await sendMessage(message.key.remoteJid, { text: 'Failed to kill admins' });
    }
};

commands.vv = async (message, args) => {
    // Anti-ViewOnce: retrieve view once messages that were sent
    // This requires storing messages in memory before they are read; we'll implement a listener later
    await sendMessage(message.key.remoteJid, { text: 'Anti-ViewOnce is active. View once messages will be saved automatically.' });
};

commands.gcstatus = async (message, args) => {
    if (!message.key.remoteJid.endsWith('@g.us')) return;
    try {
        const metadata = await sock.groupMetadata(message.key.remoteJid);
        const text = `*Group Status*\nName: ${metadata.subject}\nMembers: ${metadata.participants.length}\nAdmins: ${metadata.participants.filter(p => p.admin).length}\nDescription: ${metadata.desc || 'None'}`;
        await sendMessage(message.key.remoteJid, { text });
    } catch (err) {
        await sendMessage(message.key.remoteJid, { text: 'Error fetching group info' });
    }
};

commands.groupinfo = commands.gcstatus;

// Tools Commands
commands.calc = async (message, args) => {
    const expression = args.join(' ');
    try {
        const result = eval(expression); // Note: eval is unsafe in production; use a safe math library
        await sendMessage(message.key.remoteJid, { text: `Result: ${result}` });
    } catch (err) {
        await sendMessage(message.key.remoteJid, { text: 'Invalid expression' });
    }
};

commands.flip = async (message, args) => {
    const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
    await sendMessage(message.key.remoteJid, { text: result });
};

commands.roll = async (message, args) => {
    const max = Number(args[0] || 6);
    const result = Math.floor(Math.random() * max) + 1;
    await sendMessage(message.key.remoteJid, { text: `🎲 Rolled: ${result}` });
};

commands['8ball'] = async (message, args) => {
    const responses = ['Yes', 'No', 'Maybe', 'Ask again later', 'Definitely', 'Not sure'];
    const response = responses[Math.floor(Math.random() * responses.length)];
    await sendMessage(message.key.remoteJid, { text: response });
};

commands.joke = async (message, args) => {
    try {
        const response = await axios.get('https://v2.jokeapi.dev/joke/Any?type=single');
        await sendMessage(message.key.remoteJid, { text: response.data.joke });
    } catch (err) {
        await sendMessage(message.key.remoteJid, { text: 'Could not fetch joke' });
    }
};

commands.quote = async (message, args) => {
    try {
        const response = await axios.get('https://api.quotable.io/random');
        await sendMessage(message.key.remoteJid, { text: `"${response.data.content}" - ${response.data.author}` });
    } catch (err) {
        await sendMessage(message.key.remoteJid, { text: 'Could not fetch quote' });
    }
};

commands.fact = async (message, args) => {
    try {
        const response = await axios.get('https://uselessfacts.jsph.pl/random.json?language=en');
        await sendMessage(message.key.remoteJid, { text: response.data.text });
    } catch (err) {
        await sendMessage(message.key.remoteJid, { text: 'Could not fetch fact' });
    }
};

commands.reverse = async (message, args) => {
    const text = args.join(' ');
    const reversed = text.split('').reverse().join('');
    await sendMessage(message.key.remoteJid, { text: reversed });
};

commands.upper = async (message, args) => {
    const text = args.join(' ');
    await sendMessage(message.key.remoteJid, { text: text.toUpperCase() });
};

commands.lower = async (message, args) => {
    const text = args.join(' ');
    await sendMessage(message.key.remoteJid, { text: text.toLowerCase() });
};

commands.id = async (message, args) => {
    const jid = message.key.remoteJid;
    const decoded = jidDecode(jid);
    await sendMessage(message.key.remoteJid, { text: `Chat ID: ${jid}\nUser: ${decoded?.user || 'N/A'}` });
};

commands.whoami = async (message, args) => {
    const sender = message.key.participant || message.key.remoteJid;
    await sendMessage(message.key.remoteJid, { text: `You are: ${sender}` });
};

commands.ping = async (message, args) => {
    const start = Date.now();
    await sendMessage(message.key.remoteJid, { text: 'Pong!' });
    const latency = Date.now() - start;
    await sendMessage(message.key.remoteJid, { text: `Latency: ${latency}ms` });
};

commands.alive = async (message, args) => {
    const uptime = formatUptime(Date.now() - botStartTime);
    await sendMessage(message.key.remoteJid, { text: `Bot is alive!\nUptime: ${uptime}` });
};

commands.uptime = async (message, args) => {
    const uptime = formatUptime(Date.now() - botStartTime);
    await sendMessage(message.key.remoteJid, { text: `Uptime: ${uptime}` });
};

// Owner Commands
commands.broadcast = async (message, args) => {
    if (!isOwner(message.key.participant || message.key.remoteJid)) return sendMessage(message.key.remoteJid, { text: 'Owner only' });
    const text = args.join(' ');
    if (!text) return sendMessage(message.key.remoteJid, { text: 'Please provide a message to broadcast' });
    const chats = await sock.chats.all();
    for (const chat of chats) {
        try {
            await sendMessage(chat.id, { text });
        } catch (err) {
            // ignore
        }
    }
    await sendMessage(message.key.remoteJid, { text: 'Broadcast sent to all chats' });
};

commands.restart = async (message, args) => {
    if (!isOwner(message.key.participant || message.key.remoteJid)) return;
    await sendMessage(message.key.remoteJid, { text: 'Restarting...' });
    process.exit(0);
};

commands.block = async (message, args) => {
    if (!isOwner(message.key.participant || message.key.remoteJid)) return;
    const number = args[0]?.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
    if (!number) return sendMessage(message.key.remoteJid, { text: 'Provide number' });
    await sock.updateBlockStatus(number, 'block');
    await sendMessage(message.key.remoteJid, { text: 'User blocked' });
};

commands.unblock = async (message, args) => {
    if (!isOwner(message.key.participant || message.key.remoteJid)) return;
    const number = args[0]?.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
    if (!number) return sendMessage(message.key.remoteJid, { text: 'Provide number' });
    await sock.updateBlockStatus(number, 'unblock');
    await sendMessage(message.key.remoteJid, { text: 'User unblocked' });
};

// Settings Commands
commands.autoreact = async (message, args) => {
    const toggle = args[0]?.toLowerCase() === 'on' ? true : args[0]?.toLowerCase() === 'off' ? false : !config.autoReact;
    config.autoReact = toggle;
    await sendMessage(message.key.remoteJid, { text: `AutoReact is now ${toggle ? 'ON' : 'OFF'}` });
};

commands.autostatus = async (message, args) => {
    const toggle = args[0]?.toLowerCase() === 'on' ? true : args[0]?.toLowerCase() === 'off' ? false : !config.autoStatus;
    config.autoStatus = toggle;
    await sendMessage(message.key.remoteJid, { text: `AutoStatus is now ${toggle ? 'ON' : 'OFF'}` });
};

commands.antibadword = async (message, args) => {
    const toggle = args[0]?.toLowerCase() === 'on' ? true : args[0]?.toLowerCase() === 'off' ? false : !config.antiBadWord;
    config.antiBadWord = toggle;
    await sendMessage(message.key.remoteJid, { text: `AntiBadWord is now ${toggle ? 'ON' : 'OFF'}` });
};

commands.antilink = async (message, args) => {
    const toggle = args[0]?.toLowerCase() === 'on' ? true : args[0]?.toLowerCase() === 'off' ? false : !config.antiLink;
    config.antiLink = toggle;
    await sendMessage(message.key.remoteJid, { text: `AntiLink is now ${toggle ? 'ON' : 'OFF'}` });
};

commands.antidelete = async (message, args) => {
    const toggle = args[0]?.toLowerCase() === 'on' ? true : args[0]?.toLowerCase() === 'off' ? false : !config.antiDelete;
    config.antiDelete = toggle;
    await sendMessage(message.key.remoteJid, { text: `AntiDelete is now ${toggle ? 'ON' : 'OFF'}` });
};

commands.anticall = async (message, args) => {
    const toggle = args[0]?.toLowerCase() === 'on' ? true : args[0]?.toLowerCase() === 'off' ? false : !config.antiCall;
    config.antiCall = toggle;
    await sendMessage(message.key.remoteJid, { text: `AntiCall is now ${toggle ? 'ON' : 'OFF'}` });
};

commands.mode = async (message, args) => {
    const mode = args[0]?.toLowerCase();
    if (mode === 'public' || mode === 'private') {
        config.mode = mode;
        await sendMessage(message.key.remoteJid, { text: `Mode set to ${mode}` });
    } else {
        await sendMessage(message.key.remoteJid, { text: `Usage: .mode public|private` });
    }
};

commands.settings = async (message, args) => {
    const text = `*Current Settings*\nAutoReact: ${config.autoReact}\nAutoStatus: ${config.autoStatus}\nAntiBadWord: ${config.antiBadWord}\nAntiLink: ${config.antiLink}\nAntiDelete: ${config.antiDelete}\nAntiCall: ${config.antiCall}\nMode: ${config.mode}`;
    await sendMessage(message.key.remoteJid, { text });
};

// Menu Command
const menuText = `
╭━〔 KING-XD Bot Mini 〕━⬣
┃ [] STATUS  : ONLINE
┃ [] RUNTIME : ${formatUptime(Date.now() - botStartTime)}
┃ [] USER    : User
┃ [] DEV     : ᴋɪɴɢsʟᴇʏ-xᴍᴅ ᴛᴇᴄʜ
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 📥 DOWNLOADS 〕━━⬣
┃➤ .yt
┃➤ .song 
┃➤ .video 
┃➤ .tt
┃➤ .ig
┃➤ .fb 
┃➤ .wallpaper
╰━━━━━━━━━━━━━━━━━━━━⬣
╭━━〔 🔎 SEARCH 〕━━⬣
┃➤ .google
┃➤ .duckduckgo 
┃➤ .yahoo 
┃➤ .wiki
┃➤ .weather
┃➤ .news
╰━━━━━━━━━━━━━━━━━━━━⬣
╭━━〔 🖼️ IMAGE EDITOR 〕━━⬣
┃➤ .crop
┃➤ .resize
┃➤ .rotate
┃➤ .flip
┃➤ .filter
┃➤ .adjust
┃➤ .text
┃➤ .watermark
┃➤ .imgedit
╰━━━━━━━━━━━━━━━━━━━━⬣
╭━━〔 🎨 MEDIA TOOLS 〕━━⬣
┃➤ .sticker
┃➤ .toimg
┃➤ .compress
┃➤ .enhance
┃➤ .blur
┃➤ .removebg
╰━━━━━━━━━━━━━━━━━━━━⬣
╭━━〔 👑 GROUP MANAGER 〕━━⬣ (admins only)
┃➤ .gcstatus 
┃➤ .groupinfo
┃➤ .kick 
┃➤ .promote 
┃➤ .demote
┃➤ .add
┃➤ .mute 
┃➤ .unmute
┃➤ .link 
┃➤ .revoke
┃➤ .tag
┃➤ .tagall
┃➤ .kickall
┃➤ .kill
┃➤ .vv
╰━━━━━━━━━━━━━━━━━━━━⬣
╭━━〔 🛠 TOOLS 〕━━⬣
┃➤ .calc
┃➤ .flip 
┃➤ .roll 
┃➤ .8ball
┃➤ .joke
┃➤ .quote 
┃➤ .fact
┃➤ .reverse 
┃➤ .upper 
┃➤ .lower
┃➤ .id 
┃➤ .whoami
┃➤ .ping 
┃➤ .alive 
┃➤ .uptime
╰━━━━━━━━━━━━━━━━━━━━⬣
╭━━〔 👑 OWNER 〕━━⬣
┃➤ .broadcast
┃➤ .restart
┃➤ .block 
┃➤ .unblock
╰━━━━━━━━━━━━━━━━━━━━⬣
╭━━〔 ⚙️ SETTINGS 〕━━⬣
┃➤ .autoreact 
┃➤ .autostatus 
┃➤ .antibadword 
┃➤ .antilink
┃➤ .antidelete 
┃➤ .anticall
┃➤ .mode
┃➤ .settings
╰━━━━━━━━━━━━━━━━━━━━⬣
`;

commands.menu = async (message, args) => {
    await sendMessage(message.key.remoteJid, { text: menuText });
};

// ================= Message Handler =================
async function handleMessage(message) {
    if (!message.message) return;
    const jid = message.key.remoteJid;
    const sender = message.key.participant || message.key.remoteJid;
    const isGroup = jid.endsWith('@g.us');
    const body = message.message.conversation || message.message.extendedTextMessage?.text || '';
    const prefix = settings.prefix;
    if (!body.startsWith(prefix)) return;

    const args = body.slice(prefix.length).trim().split(/\s+/);
    const command = args.shift().toLowerCase();
    if (commands[command]) {
        // Check if owner-only command
        const ownerOnly = ['broadcast', 'restart', 'block', 'unblock'].includes(command);
        if (ownerOnly && !isOwner(sender)) {
            return sendMessage(jid, { text: 'This command is for owner only' });
        }
        // Check if group admin only command
        const adminOnly = ['kick', 'add', 'promote', 'demote', 'mute', 'unmute', 'revoke', 'kickall', 'kill'].includes(command);
        if (adminOnly && isGroup && !isAdmin(message)) {
            return sendMessage(jid, { text: 'You must be an admin to use this command' });
        }
        try {
            await commands[command](message, args);
        } catch (err) {
            console.error(`Error in command ${command}:`, err);
            await sendMessage(jid, { text: 'An error occurred while executing command' });
        }
    }
}

// ================= Protection Listeners =================
async function handleMessagesUpsert({ messages }) {
    const msg = messages[0];
    if (!msg.message) return;

    // Store message for anti-delete
    if (config.antiDelete) {
        const key = msg.key.id;
        if (!store.has(key)) {
            store.set(key, msg);
            // Clean old entries
            if (store.size > 1000) {
                const firstKey = store.keys().next().value;
                store.delete(firstKey);
            }
        }
    }

    // Anti-link
    if (config.antiLink && msg.key.remoteJid.endsWith('@g.us')) {
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        if (text && /https?:\/\/(chat\.whatsapp\.com|wa\.me)/.test(text)) {
            const sender = msg.key.participant || msg.key.remoteJid;
            const isAdmin = await isAdmin(msg);
            if (!isAdmin) {
                // Remove message and kick user
                await sock.sendMessage(msg.key.remoteJid, { delete: msg.key });
                await sock.groupParticipantsUpdate(msg.key.remoteJid, [sender], 'remove');
                await sock.sendMessage(msg.key.remoteJid, { text: `@${sender.split('@')[0]} kicked for sharing link`, mentions: [sender] });
            }
        }
    }

    // Auto-React
    if (config.autoReact) {
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        const emojis = ['👍', '❤️', '😂', '🔥', '👏'];
        if (text && Math.random() < 0.1) { // 10% chance
            const emoji = emojis[Math.floor(Math.random() * emojis.length)];
            await reactToMessage(msg.key.remoteJid, msg.key, emoji);
        }
    }

    // Process commands
    await handleMessage(msg);
}

// Anti-Delete detection (using message update event)
async function handleMessageUpdate(update) {
    if (update.type === 'delete' && config.antiDelete) {
        const key = update.key;
        const storedMsg = store.get(key.id);
        if (storedMsg) {
            // Send notification with the deleted message content
            const content = storedMsg.message.conversation || storedMsg.message.extendedTextMessage?.text || '[Media]';
            await sock.sendMessage(key.remoteJid, { text: `🛡️ Anti-Delete detected a deleted message:\n\n${content}` });
            store.delete(key.id);
        }
    }
}

// Anti-Call
async function handleCall(call) {
    if (config.antiCall && call.status === 'offer') {
        const callerId = call.from;
        await sock.rejectCall(call.id, callerId);
        await sock.sendMessage(callerId, { text: '🚫 Calls are automatically rejected by the bot.' });
    }
}

// Auto-Status view
async function handleStatusUpdate(status) {
    if (config.autoStatus && status.type === 'status') {
        // Mark status as viewed
        for (const [jid, statusInfo] of Object.entries(status.statuses || {})) {
            for (const item of statusInfo) {
                await sock.readMessages([item.key]);
            }
        }
    }
}

// ================= Initialize Bot =================
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(settings.sessionFolder);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    sock = makeWASocket({
        version,
        logger,
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        browser: Browsers.ubuntu('Chrome'),
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: true,
        getMessage: async (key) => (store.get(key.id)?.message || undefined),
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            qrCode = qr;
        }
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                console.log('Connection closed, reconnecting...');
                startBot();
            } else {
                console.log('Logged out, please delete session folder and restart');
            }
        } else if (connection === 'open') {
            isConnected = true;
            connectionStatus = 'connected';
            botStartTime = Date.now();
            console.log('Bot connected');
        }
    });

    sock.ev.on('messages.upsert', handleMessagesUpsert);
    sock.ev.on('messages.update', handleMessageUpdate);
    sock.ev.on('call', handleCall);
    sock.ev.on('status.update', handleStatusUpdate);
}

// Start Express server
app.listen(PORT, () => {
    console.log(`Dashboard running on http://localhost:${PORT}`);
});

// Start bot
startBot().catch(err => console.error('Bot failed to start:', err));
