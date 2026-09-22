require("dotenv").config();
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n")
  })
});

const db = admin.firestore();

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const SEFAZ_HOST = /(^|\.)sefaz\.[a-z]{2}\.gov\.br$/i;
const SEFAZ_HOST_ALT = /(^|\.)sefaz\.gov\.br$/i;

function isSefazUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (e) {
    return { ok: false, reason: "URL inválida" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "Protocolo não permitido" };
  }
  const host = parsed.hostname.toLowerCase();
  if (!SEFAZ_HOST.test(host) && !SEFAZ_HOST_ALT.test(host)) {
    return { ok: false, reason: "URL não é um domínio SEFAZ permitido" };
  }
  return { ok: true, url: parsed };
}

function fetchHtml(url, redirects) {
  redirects = redirects || 0;
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      return reject(new Error("Muitos redirecionamentos"));
    }
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.get(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; LeitorSefaz/1.0)",
          Accept: "text/html,application/xhtml+xml"
        },
        timeout: 20000
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, url);
          if (next.protocol !== "https:" && next.protocol !== "http:") {
            return reject(new Error("Redirecionamento inválido"));
          }
          return resolve(fetchHtml(next, redirects + 1));
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          return reject(new Error("HTTP " + res.statusCode));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      }
    );
    req.on("timeout", () => {
      req.destroy(new Error("Tempo de conexão esgotado"));
    });
    req.on("error", reject);
  });
}

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (m, code) => String.fromCharCode(parseInt(code, 10)));
}

function stripTags(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function toNumber(value) {
  const cleaned = String(value).replace(/[^\d,.\-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function parseProducts(html) {
  const products = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const cells = [];
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      cells.push(stripTags(cellMatch[1]));
    }
    if (cells.length < 2) continue;
    const priceCell = cells.find((c) => /R\$\s*\d/i.test(c));
    if (!priceCell) continue;
    const price = toNumber(priceCell.replace(/R\$/i, ""));
    if (price === null) continue;
    const name = cells.find((c) => c && c !== priceCell && !/R\$/.test(c));
    if (!name || name.length < 2) continue;
    products.push({ name: name, price: price });
  }
  if (products.length === 0) {
    const re = /([A-Za-zÀ-ÿ0-9][^<]{2,80}?)\s*R\$\s*([\d.,]+)/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const name = stripTags(m[1]).replace(/[\s:;-]+$/, "").trim();
      const price = toNumber(m[2]);
      if (name.length >= 2 && price !== null) products.push({ name: name, price: price });
    }
  }
  return products;
}

const ACCESS_KEY_RE = /^\d{44}$/;

function buildSefazUrlFromKey(key) {
  return new URL(
    "https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx?tipoConsulta=completa&tipoConteudo=XbSeqxE8pl8=&nrChave=" + key
  );
}

function handleScanKey(req, res) {
  let body = "";
  req.on("data", (c) => {
    body += c;
    if (body.length > 1000) req.destroy();
  });
  req.on("end", () => {
    let payload;
    try {
      payload = JSON.parse(body || "{}");
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: "JSON inválido" });
    }
    const key = (payload.key || "").trim();
    if (!ACCESS_KEY_RE.test(key)) {
      return sendJson(res, 400, { ok: false, error: "Chave de acesso inválida: deve ter exatamente 44 dígitos numéricos" });
    }
    db.collection("leituras").add({
      tipo: "chave_acesso",
      chave: key,
      status: "pendente",
      registradoEm: admin.firestore.FieldValue.serverTimestamp()
    })
      .then(() => {
        sendJson(res, 200, { ok: true, message: "Chave de acesso salva no Firebase com sucesso" });
      })
      .catch((err) => {
        sendJson(res, 502, { ok: false, error: "Falha ao salvar no Firebase: " + err.message });
      });
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function serveStatic(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

function handleScan(req, res) {
  let body = "";
  req.on("data", (c) => {
    body += c;
    if (body.length > 100000) req.destroy();
  });
  req.on("end", () => {
    let payload;
    try {
      payload = JSON.parse(body || "{}");
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: "JSON inválido" });
    }
    const check = isSefazUrl(payload.url || "");
    if (!check.ok) {
      return sendJson(res, 400, { ok: false, error: check.reason });
    }
    db.collection("leituras").add({
      tipo: "qrcode",
      url: check.url.href,
      status: "pendente",
      registradoEm: admin.firestore.FieldValue.serverTimestamp()
    })
      .then(() => {
        sendJson(res, 200, {
          ok: true,
          url: check.url.href,
          message: "URL salva no Firebase com sucesso"
        });
      })
      .catch((err) => {
        sendJson(res, 502, { ok: false, error: "Falha ao salvar no Firebase: " + err.message });
      });
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  if (req.method === "POST" && url.pathname === "/api/scan") {
    return handleScan(req, res);
  }
  if (req.method === "POST" && url.pathname === "/api/scan-key") {
    return handleScanKey(req, res);
  }
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    return serveStatic(res, path.join(ROOT, "index.html"), "text/html; charset=utf-8");
  }
  if (req.method === "GET" && url.pathname === "/leitorqr.js") {
    return serveStatic(res, path.join(ROOT, "leitorqr.js"), "application/javascript; charset=utf-8");
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log("Leitor SEFAZ rodando em http://localhost:" + PORT);
});

module.exports = { isSefazUrl, parseProducts };
