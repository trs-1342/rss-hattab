// server/server.js
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");

const app = express();

// ---- Config ----
const CFG_PATH = path.join(__dirname, "config.json");
if (!fs.existsSync(CFG_PATH)) {
  console.error("config.json yok. server/config.json oluşturun.");
  process.exit(1);
}
const CFG = JSON.parse(fs.readFileSync(CFG_PATH, "utf8"));

const PORT = Number(CFG.PORT || 3000);
const SITE_URL = String(CFG.SITE_URL || `http://localhost:${PORT}`);
const ADMIN_USER = String(CFG.ADMIN_USER || "halil");
const ADMIN_PASS_HASH = String(CFG.ADMIN_PASS_HASH || "");
const SESSION_SECRET = String(CFG.SESSION_SECRET || "DEGISIN");

// ---- Paths ----
const DATA_PATH = path.join(__dirname, "posts.json");
const PUBLIC_PATH = path.join(__dirname, "..", "public");

// ---- Utils ----
function readJSON(p) {
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return [];
  }
}
function writeJSON(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
}
function slugify(s) {
  return String(s)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ğ/gi, "g")
    .replace(/ü/gi, "u")
    .replace(/ş/gi, "s")
    .replace(/ı/gi, "i")
    .replace(/ö/gi, "o")
    .replace(/ç/gi, "c")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

// ---- Middleware ----
app.use(express.json({ limit: "512kb" }));
app.use(
  session({
    name: "sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax", maxAge: 1000 * 60 * 60 * 8 },
  })
);

// ---- Static ----
app.use(express.static(PUBLIC_PATH));

// ---- Auth ----
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: "Eksik alan" });
  if (username !== ADMIN_USER)
    return res.status(401).json({ error: "Geçersiz kullanıcı" });

  // Kritik: hash ile karşılaştır
  const ok =
    ADMIN_PASS_HASH && (await bcrypt.compare(password, ADMIN_PASS_HASH));
  if (!ok) return res.status(401).json({ error: "Parola hatalı" });

  req.session.user = { username, isAdmin: true };
  res.json({ ok: true, user: req.session.user });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", (req, res) => {
  res.json({ user: req.session.user || null });
});

function requireAdmin(req, res, next) {
  if (!req.session?.user?.isAdmin)
    return res.status(401).json({ error: "Yetkisiz" });
  next();
}

// ---- Posts API ----
app.get("/api/posts", (req, res) => {
  const { q = "", from = "", to = "" } = req.query;
  const posts = readJSON(DATA_PATH).sort(
    (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)
  );
  const ql = String(q).trim().toLowerCase();
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;

  const items = posts.filter((p) => {
    const hay = `${p.title} ${p.description} ${p.body}`.toLowerCase();
    const tm = ql ? hay.includes(ql) : true;
    const d = new Date(p.publishedAt);
    const okF = fromDate ? d >= fromDate : true;
    const okT = toDate ? d <= toDate : true;
    return tm && okF && okT;
  });

  res.json({ items });
});

app.get("/api/posts/:slug", (req, res) => {
  const posts = readJSON(DATA_PATH);
  const post = posts.find((p) => p.slug === req.params.slug);
  if (!post) return res.status(404).json({ error: "Bulunamadı" });
  res.json({ post });
});

app.post("/api/posts", requireAdmin, (req, res) => {
  const { title, description, body, publishedAt } = req.body || {};
  if (!title || !description || !body)
    return res.status(400).json({ error: "Eksik alan" });
  const posts = readJSON(DATA_PATH);
  let slug = slugify(title) || `post-${Date.now()}`;
  const base = slug;
  let i = 2;
  while (posts.some((p) => p.slug === slug)) slug = `${base}-${i++}`;
  const now = new Date().toISOString();

  const doc = {
    id: slug,
    slug,
    title,
    description,
    body,
    author: ADMIN_USER,
    publishedAt: publishedAt || now,
    createdAt: now,
    updatedAt: now,
    readCount: 0,
  };
  posts.push(doc);
  writeJSON(DATA_PATH, posts);
  res.json({ ok: true, post: doc });
});

app.post("/api/posts/:slug/read", (req, res) => {
  const posts = readJSON(DATA_PATH);
  const ix = posts.findIndex((p) => p.slug === req.params.slug);
  if (ix === -1) return res.status(404).json({ error: "Bulunamadı" });
  posts[ix].readCount = (posts[ix].readCount || 0) + 1;
  posts[ix].updatedAt = new Date().toISOString();
  writeJSON(DATA_PATH, posts);
  res.json({ ok: true, readCount: posts[ix].readCount });
});

// ---- RSS ----
app.get("/rss.xml", (req, res) => {
  const posts = readJSON(DATA_PATH).sort(
    (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)
  );
  const items = posts
    .map(
      (p) => `
    <item>
      <title><![CDATA[${p.title}]]></title>
      <link>${SITE_URL}/post.html?id=${encodeURIComponent(p.slug)}</link>
      <guid>${SITE_URL}/post.html?id=${encodeURIComponent(p.slug)}</guid>
      <pubDate>${new Date(p.publishedAt).toUTCString()}</pubDate>
      <description><![CDATA[${p.description}]]></description>
    </item>`
    )
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Blog RSS</title>
    <link>${SITE_URL}</link>
    <description>Basit blog RSS yayını</description>
    <language>tr-TR</language>${items}
  </channel>
</rss>`;
  res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
  res.send(xml);
});

// ---- Geçici DEBUG: hash doğrula (SİLMEYİ UNUTMA) ----
app.post("/api/_debug_check_password", async (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: "Eksik alan" });
  const ok =
    ADMIN_PASS_HASH && (await bcrypt.compare(password, ADMIN_PASS_HASH));
  res.json({ ok, usingHashPrefix: ADMIN_PASS_HASH.slice(0, 7) });
});

app.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
