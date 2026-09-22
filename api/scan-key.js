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
const ACCESS_KEY_RE = /^\d{44}$/;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método não permitido" });
  }

  const key = ((req.body && req.body.key) || "").trim();
  if (!ACCESS_KEY_RE.test(key)) {
    return res.status(400).json({
      ok: false,
      error: "Chave de acesso inválida: deve ter exatamente 44 dígitos numéricos"
    });
  }

  try {
    const docRef = await db.collection("leituras").add({
      tipo: "chave_acesso",
      chave: key,
      status: "pendente",
      registradoEm: FieldValue.serverTimestamp()
    });
    return res.status(200).json({
      ok: true,
      id: docRef.id,
      message: "Chave de acesso salva no Firebase com sucesso"
    });
  } catch (err) {
    return res.status(502).json({
      ok: false,
      error: "Falha ao salvar no Firebase: " + err.message
    });
  }
};
