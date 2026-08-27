module.exports = {
    botName: "KING-XD BOT MINI",
    ownerNumber: process.env.OWNER_NUMBER || "234XXXXXXXXXX", // Your WhatsApp number with country code
    prefix: ".",
    sessionFolder: "auth_info_baileys",
    downloaderApi: "http://localhost:5000/download", // Self-hosted yt-dlp API endpoint (if used)
    // Dashboard settings
    dashboardPort: process.env.PORT || 3000,
    // Internet collection simulation (replace with real API if desired)
    internetCollectionAPI: "https://example.com/collect", // This is a placeholder
    // Anti-Delete storage (in-memory, resets on restart)
    antiDeleteStore: new Map(),
    // Default settings
    settings: {
        autoReact: false,
        autoStatus: false,
        antiBadWord: false,
        antiLink: false,
        antiDelete: false,
        antiCall: false,
        mode: "public", // or "private"
    },
};
