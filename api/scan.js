const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n")
    })
  });
}

const db = admin.firestore();

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

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método não permitido" });
  }

  const { url } = req.body || {};
  const check = isSefazUrl(url || "");
  if (!check.ok) {
    return res.status(400).json({ ok: false, error: check.reason });
  }

  try {
    await db.collection("leituras").add({
      tipo: "qrcode",
      url: check.url.href,
      registradoEm: admin.firestore.FieldValue.serverTimestamp()
    });
    return res.status(200).json({
      ok: true,
      url: check.url.href,
      message: "URL salva no Firebase com sucesso"
    });
  } catch (err) {
    return res.status(502).json({
      ok: false,
      error: "Falha ao salvar no Firebase: " + err.message
    });
  }
};
