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

module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    const id = req.query.id;
    if (!id) return res.status(400).json({ ok: false, error: "ID obrigatório" });
    try {
      const doc = await db.collection("leituras").doc(id).get();
      if (!doc.exists) return res.status(404).json({ ok: false, error: "Não encontrado" });
      return res.status(200).json({ ok: true, data: doc.data() });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  if (req.method === "POST") {
    const { id, resposta } = req.body || {};
    if (!id || !resposta) return res.status(400).json({ ok: false, error: "ID e resposta obrigatórios" });
    try {
      await db.collection("leituras").doc(id).update({
        status: "captcha_resolvido",
        captchaResposta: resposta,
        captchaRespondidoEm: FieldValue.serverTimestamp()
      });
      return res.status(200).json({ ok: true, message: "Resposta enviada" });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  return res.status(405).json({ ok: false, error: "Método não permitido" });
};
