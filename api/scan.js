const { initializeApp, getApps, cert } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n")
    })
  });
}

const db = getFirestore();

const GOV_BR_HOST = /(^|\.)gov\.br$/i;

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
  if (!GOV_BR_HOST.test(host)) {
    return { ok: false, reason: "URL não possui domínio .gov.br" };
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
      status: "pendente",
      registradoEm: FieldValue.serverTimestamp()
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
