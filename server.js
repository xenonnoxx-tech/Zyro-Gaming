require("dotenv").config();
const express = require("express");
const axios = require("axios");
const path = require("path");

const app = express();

// ─── CONFIG ───────────────────────────────────────────────
const API_KEY = process.env.COC_API_KEY || "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiIsImtpZCI6IjI4YTMxOGY3LTAwMDAtYTFlYi03ZmExLTJjNzQzM2M2Y2NhNSJ9.eyJpc3MiOiJzdXBlcmNlbGwiLCJhdWQiOiJzdXBlcmNlbGw6Z2FtZWFwaSIsImp0aSI6ImNiZDhhZThiLWM4NTYtNGQyYy05NDg4LTE5YWViOTVjODUxZiIsImlhdCI6MTc3NDMwMjU2MSwic3ViIjoiZGV2ZWxvcGVyLzVkYTk0MTAzLTM5ZGEtZWJiZS03NjI2LTAxZmE0ZDBiZGQ0YSIsInNjb3BlcyI6WyJjbGFzaCJdLCJsaW1pdHMiOlt7InRpZXIiOiJkZXZlbG9wZXIvc2lsdmVyIiwidHlwZSI6InRocm90dGxpbmcifSx7ImNpZHJzIjpbIjc0LjIyMC40OC4yNDYiXSwidHlwZSI6ImNsaWVudCJ9XX0.0S0QenNZEefQEJuRO_FMlF3bet8OeOR9G0njMoEEDqpuK3Zo3p5xqWAJvtvP4OcPFDjTYLWmQBDeCYeM-e9nsQ";
// Note: set COC_API_KEY env var in Render dashboard to override
const CLAN_TAG = "C92R9JCJ";
const REFRESH_INTERVAL = 60000;
// ──────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

const headers = { Authorization: `Bearer ${API_KEY}` };

// ── API endpoints ──

app.get("/api/myip", async (req, res) => {
  try {
    const r = await axios.get("https://api.ipify.org?format=json");
    res.json({ outboundIP: r.data.ip });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/test", async (req, res) => {
  try {
    await axios.get("https://api.clashofclans.com/v1/clans?name=test&limit=1", { headers });
    res.json({ ok: true, message: "API key is working" });
  } catch (err) {
    res.status(err.response?.status || 500).json({ ok: false, error: err.response?.data?.message || err.message });
  }
});

app.get("/api/data", (req, res) => {
  if (cachedData) return res.json(cachedData);
  res.json({ loading: true });
});

app.get("/api/search-clan", async (req, res) => {
  let query = (req.query.name || "").trim();
  if (!query) return res.status(400).json({ error: "query is required" });
  const looksLikeTag = /^#?[A-Z0-9]{4,12}$/i.test(query);
  try {
    if (looksLikeTag) {
      const tag = query.startsWith("#") ? query : `#${query}`;
      const result = await axios.get(`https://api.clashofclans.com/v1/clans/${encodeURIComponent(tag)}`, { headers });
      const c = result.data;
      return res.json([{ tag: c.tag, name: c.name, level: c.clanLevel, members: c.members, badgeUrl: c.badgeUrls?.small }]);
    }
    const result = await axios.get(`https://api.clashofclans.com/v1/clans?name=${encodeURIComponent(query)}&limit=10`, { headers });
    res.json(result.data.items.map(c => ({ tag: c.tag, name: c.name, level: c.clanLevel, members: c.members, badgeUrl: c.badgeUrls?.small })));
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

app.get("/api/search-player", async (req, res) => {
  let tag = (req.query.tag || "").trim();
  if (!tag) return res.status(400).json({ error: "tag is required" });
  if (!tag.startsWith("#")) tag = `#${tag}`;
  try {
    const result = await axios.get(`https://api.clashofclans.com/v1/players/${encodeURIComponent(tag)}`, { headers });
    res.json(result.data);
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({ error: err.response?.data?.message || err.message, status });
  }
});

// Clan tag is fixed — always use the configured clan
app.post("/api/set-clan", (req, res) => {
  res.json({ ok: true });
});

// Image proxy — fetches icon from Fandom and serves it through our server
const imageCache = {};
app.get("/api/icon-proxy", async (req, res) => {
  const name = (req.query.name || "").trim();
  if (!name) return res.status(400).end();
  const cacheKey = name;
  if (imageCache[cacheKey]) {
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=86400");
    return res.send(imageCache[cacheKey]);
  }
  try {
    const formattedName = name.replace(/\s+/g, '_');
    const file1 = `File:${formattedName}_info.png`;
    const file2 = `File:${formattedName}.png`;
    const infoRes = await axios.get("https://clashofclans.fandom.com/api.php", {
      params: { action: "query", titles: `${file1}|${file2}`, prop: "imageinfo", iiprop: "url", format: "json" },
      timeout: 5000
    });
    const pages = infoRes.data?.query?.pages || {};
    let url = null;
    for (const pageId in pages) {
      if (pages[pageId].imageinfo && pages[pageId].imageinfo[0].url) {
        url = pages[pageId].imageinfo[0].url;
        break;
      }
    }
    if (!url) return res.status(404).end();
    const imgRes = await axios.get(url, {
      responseType: "arraybuffer",
      headers: { Referer: "https://clashofclans.fandom.com/" },
      timeout: 8000
    });
    const buf = Buffer.from(imgRes.data);
    imageCache[cacheKey] = buf;
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=86400");
    res.send(buf);
  } catch { res.status(404).end(); }
});

// Icon fetcher — uses Fandom wiki API with in-memory cache
const iconCache = {};
app.get("/api/icons", async (req, res) => {
  const names = (req.query.names || "").split(",").map(n => n.trim()).filter(Boolean);
  if (!names.length) return res.json({});
  const result = {};
  await Promise.all(names.map(async name => {
    if (iconCache[name]) { result[name] = iconCache[name]; return; }
    try {
      // Fetch the file directly from the wiki, testing both conventions
      const formattedName = name.replace(/\s+/g, '_');
      const file1 = `File:${formattedName}_info.png`;
      const file2 = `File:${formattedName}.png`;
      const r = await axios.get("https://clashofclans.fandom.com/api.php", {
        params: { action: "query", titles: `${file1}|${file2}`, prop: "imageinfo", iiprop: "url", format: "json" },
        timeout: 5000
      });
      const pages = r.data?.query?.pages || {};
      let url = null;
      for (const pageId in pages) {
        if (pages[pageId].imageinfo && pages[pageId].imageinfo[0].url) {
          url = pages[pageId].imageinfo[0].url;
          break;
        }
      }
      if (url) iconCache[name] = url;
      result[name] = url;
    } catch { result[name] = null; }
  }));
  res.json(result);
});

// Fetch any clan on demand (client-side temporary view)
app.get("/api/clan-data", async (req, res) => {
  let tag = (req.query.tag || "").trim();
  if (!tag) return res.status(400).json({ error: "tag is required" });
  if (!tag.startsWith("#")) tag = `#${tag}`;
  try {
    const clanRes = await axios.get(`https://api.clashofclans.com/v1/clans/${encodeURIComponent(tag)}`, { headers });
    const clan = clanRes.data;
    const memberTags = clan.memberList.map(m => m.tag);
    const batchSize = 10;
    const players = [];
    for (let i = 0; i < memberTags.length; i += batchSize) {
      const batch = memberTags.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(t =>
        axios.get(`https://api.clashofclans.com/v1/players/${encodeURIComponent(t)}`, { headers })
          .then(r => r.data).catch(() => null)
      ));
      players.push(...results.filter(Boolean));
      if (i + batchSize < memberTags.length) await new Promise(r => setTimeout(r, 300));
    }
    players.sort((a, b) => b.trophies - a.trophies);
    res.json({
      clan: { name: clan.name, tag: clan.tag, level: clan.clanLevel, members: clan.members, warWins: clan.warWins, badgeUrl: clan.badgeUrls?.medium },
      players,
      updatedAt: new Date().toISOString()
    });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.message || err.message });
  }
});

// Current war attacks — returns map of playerTag -> last attack info
app.get("/api/war-attacks", async (req, res) => {
  let tag = (req.query.tag || `#${CLAN_TAG}`).trim();
  if (!tag.startsWith("#")) tag = `#${tag}`;
  try {
    const warRes = await axios.get(`https://api.clashofclans.com/v1/clans/${encodeURIComponent(tag)}/currentwar`, { headers });
    const war = warRes.data;
    if (!war || war.state === "notInWar") return res.json({ state: "notInWar", attacks: {} });

    const attacks = {};
    (war.clan?.members || []).forEach(member => {
      if (member.attacks && member.attacks.length > 0) {
        // Sort by order desc to get latest attack
        const sorted = [...member.attacks].sort((a, b) => b.order - a.order);
        const latest = sorted[0];
        // Find defender's map position
        const defender = (war.opponent?.members || []).find(m => m.tag === latest.defenderTag);
        attacks[member.tag] = {
          stars: latest.stars,
          destruction: latest.destructionPercentage,
          defenderMapPos: defender?.mapPosition ?? null,
          totalAttacks: member.attacks.length
        };
      } else {
        attacks[member.tag] = null; // member hasn't attacked
      }
    });
    res.json({ state: war.state, teamSize: war.teamSize, attacks });
  } catch (err) {
    const status = err.response?.status || 500;
    // 403 = war log private, 404 = not in war
    if (status === 403) return res.json({ state: "private", attacks: {} });
    if (status === 404) return res.json({ state: "notInWar", attacks: {} });
    res.status(status).json({ error: err.response?.data?.message || err.message });
  }
});

// ── Data fetching ──

async function fetchClan() {
  try {
    const res = await axios.get(`https://api.clashofclans.com/v1/clans/%23${CLAN_TAG}`, { headers });
    return res.data;
  } catch (err) {
    console.error("Clan fetch error:", err.response?.data?.message || err.message);
    return null;
  }
}

async function fetchPlayer(tag) {
  try {
    const res = await axios.get(`https://api.clashofclans.com/v1/players/${encodeURIComponent(tag)}`, { headers });
    return res.data;
  } catch (err) {
    console.error(`Player fetch error (${tag}):`, err.response?.data?.message || err.message);
    return null;
  }
}

async function fetchAllMembers() {
  const clan = await fetchClan();
  if (!clan) return null;

  const memberTags = clan.memberList.map((m) => m.tag);
  const batchSize = 10;
  const players = [];
  for (let i = 0; i < memberTags.length; i += batchSize) {
    const batch = memberTags.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(fetchPlayer));
    players.push(...results.filter(Boolean));
    if (i + batchSize < memberTags.length) await new Promise((r) => setTimeout(r, 500));
  }

  players.sort((a, b) => b.trophies - a.trophies);

  return {
    clan: { name: clan.name, tag: clan.tag, level: clan.clanLevel, members: clan.members, warWins: clan.warWins, badgeUrl: clan.badgeUrls?.medium },
    players,
    updatedAt: new Date().toISOString(),
  };
}

let cachedData = null;

async function refreshData() {
  console.log(`[${new Date().toLocaleTimeString()}] Fetching data...`);
  const data = await fetchAllMembers();
  if (data) {
    cachedData = data;
    console.log(`[${new Date().toLocaleTimeString()}] Data cached (${data.players.length} players)`);
  }
}

setInterval(refreshData, REFRESH_INTERVAL);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n CoC Tracker running → http://localhost:${PORT}\n`);
  refreshData();
});
