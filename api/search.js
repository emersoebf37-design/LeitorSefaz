const { initializeApp, getApps, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

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

// Cache em memória (Serverless instance memory)
let cachedDocs = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 60 * 1000; // 60 segundos

function normalizeStr(str) {
  return (str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

async function getCachedLeituras() {
  const now = Date.now();
  if (cachedDocs && now - lastCacheTime < CACHE_TTL_MS) {
    return cachedDocs;
  }

  const snapshot = await db.collection("leituras")
    .where("status", "==", "concluido")
    .get();

  cachedDocs = snapshot.docs.map((doc) => doc.data() || {});
  lastCacheTime = now;
  return cachedDocs;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Método não permitido" });
  }

  const query = req.query.q || "";
  const termo = normalizeStr(query);

  if (!termo || termo.length < 2) {
    return res.status(400).json({ ok: false, error: "Termo de busca deve ter pelo menos 2 caracteres" });
  }

  // Headers de cache HTTP (30s no CDN da Vercel / Browser)
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");

  try {
    const docs = await getCachedLeituras();
    const resultados = [];
    const tokens = termo.split(/\s+/).filter(Boolean);

    for (const data of docs) {
      const nota = data.dados || {};
      const estab = nota.estabelecimento || {};
      const razaoSocial = estab.razaoSocial || "Não informada";
      const endereco = estab.endereco || "Não informado";
      const dataEmissao = nota.dataEmissao || "Não informada";
      const produtos = Array.isArray(nota.produtos) ? nota.produtos : [];

      for (const prod of produtos) {
        const nomeProd = prod.nome || "";
        const nomeNorm = normalizeStr(nomeProd);

        const match = tokens.every((t) => nomeNorm.includes(t));
        if (match) {
          resultados.push({
            nomeProduto: nomeProd,
            razaoSocial: razaoSocial,
            endereco: endereco,
            valorUnitario: prod.valorUnitario !== null && prod.valorUnitario !== undefined ? prod.valorUnitario : null,
            valorTotal: prod.valorTotal !== null && prod.valorTotal !== undefined ? prod.valorTotal : null,
            unidade: prod.unidade || "",
            quantidade: prod.quantidade || null,
            dataEmissao: dataEmissao
          });
        }
      }
    }

    return res.status(200).json({ ok: true, resultados: resultados });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Erro ao realizar busca: " + err.message });
  }
};
