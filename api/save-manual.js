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
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método não permitido" });
  }

  const { dados } = req.body || {};
  if (!dados || !dados.produtos || !dados.produtos.length) {
    return res.status(400).json({ ok: false, error: "Nenhum produto fornecido." });
  }

  try {
    const docRef = await db.collection("leituras").add({
      tipo: "manual",
      status: "concluido",
      dados: dados,
      registradoEm: FieldValue.serverTimestamp()
    });
    return res.status(200).json({
      ok: true,
      id: docRef.id,
      message: "Nota manual salva no Firebase com sucesso"
    });
  } catch (err) {
    return res.status(502).json({
      ok: false,
      error: "Falha ao salvar no Firebase: " + err.message
    });
  }
};
