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

let cachedAnalytics = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

function normalizeStr(str) {
  return (str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

// Agrupamento de estabelecimentos por tipo
function classifyStore(razaoSocial) {
  const n = normalizeStr(razaoSocial);
  const mercadoKw = ["mercado", "supermercado", "supermer", "mercearia", "hortifruti", "emporio", "fair", "atacado", "atacadao", "distribuidora", "distribuidor", "hipermercado", "extra", "bistek", "enxuto", "guanabara", "carioca", "prezunic", "mundial", "covabra", "formosa", "zona sul", "pao de acucar", "carrefour", "assai", "oba", "hortibox", "natureba", "varejao", "varejista"];
  const utilicasaKw = ["utilicasa", "utili casa", "utilidades", "utensilios", "casa e cozinha", "magazine", "casa", "lar", "moveis", "decoracao", "construcao", "material de construcao", "ferragem", "ferragens", "construmat", "leroy", "tok stok", "americanas", "casas bahia", "ponto frio", "submarino", "shoptime", "fast shop"];
  const lojaKw = ["loja", "lojas", "comercio", "boutique", "moda", "roupa", "vestuario", "calcados", "sapatos", "calçado", "farmacia", "drogaria", "droga", "perfumaria", "cosmeticos", "beleza", "informatica", "eletronico", "celular", "papelaria", "livraria", "pet", "sport", "esporte", "calcado", "sapataria", "optica", "joias", "relojoaria"];

  if (mercadoKw.some((kw) => n.includes(kw))) return "Mercado";
  if (utilicasaKw.some((kw) => n.includes(kw))) return "Utili-casa";
  if (lojaKw.some((kw) => n.includes(kw))) return "Loja";
  return "Outros";
}

// Categorias de produtos para mercado
const PRODUCT_CATEGORIES = [
  { name: "Laticínios", keywords: ["leite", "queijo", "iogurte", "manteiga", "creme de leite", "requeijao", "nata", "coalhada", "lactose", "whey"] },
  { name: "Doces e Chocolates", keywords: ["chocolate", "doce", "bala", "bombom", "chiclete", "pirulito", "caramelo", "geleia", "mel", "achocolatado", "cacau", "nescau", "ovomaltine", "toddy", "wafer", "biscoito recheado", "cookie"] },
  { name: "Bebidas", keywords: ["agua", "suco", "refrigerante", "cerveja", "vinho", "vodka", "whisky", "energetico", "isoton", "cha", "cafe", "cappuccino", "achocolatado", "nescafe", "coca", "pepsi", "guarana", "sprite", "fanta", "skol", "brahma", "antarctica"] },
  { name: "Grãos e Cereais", keywords: ["arroz", "feijao", "lentilha", "ervilha", "grao", "cereal", "aveia", "granola", "quinoa", "milho", "trigo", "farofa", "fuba", "farinha", "cuscuz", "tapioca"] },
  { name: "Massas e Pães", keywords: ["macarrao", "massa", "espaguete", "lasanha", "fusilli", "penne", "talharim", "pao", "bisnaguinha", "brioche", "torrada", "croissant", "wrap", "tapioca", "biscoito", "bolacha", "cracker", "palito"] },
  { name: "Carnes e Aves", keywords: ["carne", "frango", "boi", "suino", "porco", "peixe", "tilapia", "salmao", "atum", "sardinha", "presunto", "salsicha", "linguica", "bacon", "mortadela", "peito", "coxa", "sobrecoxa", "file", "musculo", "costela", "picanha", "alcatra", "maminha", "patinho", "acougue"] },
  { name: "Frios e Embutidos", keywords: ["presunto", "salsicha", "linguica", "bacon", "mortadela", "salame", "peperoni", "copa", "pepperoni", "frios", "embutidos"] },
  { name: "Hortifrúti", keywords: ["tomate", "alface", "cenoura", "batata", "cebola", "alho", "brocolis", "couve", "espinafre", "pepino", "abobrinha", "berinjela", "pimentao", "banana", "maca", "laranja", "limao", "uva", "manga", "melao", "melancia", "abacaxi", "morango", "fruta", "legume", "verdura", "hortalica", "salada"] },
  { name: "Limpeza", keywords: ["sabao", "detergente", "desinfetante", "amaciante", "alvejante", "agua sanitaria", "multiuso", "esponja", "vassoura", "rodo", "pano", "limpador", "flash", "veja", "omo", "ariel", "brilhante", "tix", "surf", "pom pom", "lysol", "mr musculo"] },
  { name: "Higiene Pessoal", keywords: ["sabonete", "shampoo", "condicionador", "creme", "desodorante", "pasta de dente", "escova de dente", "dental", "fio dental", "absorvente", "lenco", "papel higienico", "fralda", "hidratante", "sabão", "loção", "perfume", "maquiagem", "protetor solar"] },
  { name: "Temperos e Condimentos", keywords: ["sal", "acucar", "pimenta", "oregano", "curry", "ketchup", "mostarda", "maionese", "molho", "azeite", "vinagre", "caldo", "tempero", "shoyu", "tahine", "pesto", "extrato de tomate"] },
  { name: "Óleos e Gorduras", keywords: ["oleo", "azeite", "margarina", "gordura", "banha"] },
  { name: "Congelados", keywords: ["congelado", "sorvete", "gelado", "pizza congelada", "lasanha congelada", "nuggets", "hamburguer", "batata congelada", "empanado"] },
  { name: "Enlatados", keywords: ["enlatado", "lata", "conserva", "atum em lata", "sardinha em lata", "milho em lata", "ervilha em lata", "extrato"] },
  { name: "Café e Mercearia", keywords: ["cafe", "cha", "cappuccino", "nescafe", "pilão", "3coracoes", "tres coracoes"] }
];

function classifyProduct(nomeProduto) {
  const n = normalizeStr(nomeProduto);
  for (const cat of PRODUCT_CATEGORIES) {
    if (cat.keywords.some((kw) => n.includes(kw))) return cat.name;
  }
  return "Outros";
}

async function buildAnalytics() {
  const snapshot = await db.collection("leituras")
    .where("status", "==", "concluido")
    .get();

  const storeGroups = {};
  const storeTypeGroups = { "Mercado": { total: 0, count: 0 }, "Utili-casa": { total: 0, count: 0 }, "Loja": { total: 0, count: 0 }, "Outros": { total: 0, count: 0 } };
  const categoryGroups = {};
  const storeDetails = {};

  for (const doc of snapshot.docs) {
    const data = doc.data() || {};
    const nota = data.dados || {};
    const estab = nota.estabelecimento || {};
    const razaoSocial = estab.razaoSocial || "Não informada";
    const cnpj = (estab.cnpj || "").replace(/\D/g, "") || razaoSocial;
    const endereco = estab.endereco || "";
    const tipo = classifyStore(razaoSocial);
    const produtos = Array.isArray(nota.produtos) ? nota.produtos : [];

    if (!storeGroups[cnpj]) {
      storeGroups[cnpj] = { razaoSocial, cnpj: estab.cnpj || "", endereco, tipo, total: 0, count: 0, produtos: [] };
    } else {
      if (endereco.length > storeGroups[cnpj].endereco.length) {
        storeGroups[cnpj].endereco = endereco;
      }
    }

    if (!storeDetails[cnpj]) {
      storeDetails[cnpj] = { razaoSocial, cnpj: estab.cnpj || "", endereco, tipo, produtos: [] };
    } else {
      if (endereco.length > storeDetails[cnpj].endereco.length) {
        storeDetails[cnpj].endereco = endereco;
      }
    }

    for (const prod of produtos) {
      const valor = prod.valorTotal || prod.valorUnitario || 0;
      storeGroups[cnpj].total += valor;
      storeGroups[cnpj].count += 1;
      storeDetails[cnpj].produtos.push({
        nome: prod.nome || "",
        valorUnitario: prod.valorUnitario || 0,
        valorTotal: prod.valorTotal || 0,
        quantidade: prod.quantidade || 1,
        unidade: prod.unidade || "UN"
      });

      if (storeTypeGroups[tipo] !== undefined) {
        storeTypeGroups[tipo].total += valor;
        storeTypeGroups[tipo].count += 1;
      }

      const categoria = tipo === "Mercado" ? classifyProduct(prod.nome || "") : tipo;
      if (!categoryGroups[categoria]) categoryGroups[categoria] = { total: 0, count: 0 };
      categoryGroups[categoria].total += valor;
      categoryGroups[categoria].count += 1;
    }
  }

  const storeList = Object.values(storeGroups).sort((a, b) => b.total - a.total);
  const storeDetailsList = Object.values(storeDetails);

  const categoryList = Object.entries(categoryGroups)
    .map(([name, v]) => ({ name, total: v.total, count: v.count }))
    .sort((a, b) => b.total - a.total);

  const storeTypeList = Object.entries(storeTypeGroups)
    .map(([name, v]) => ({ name, total: v.total, count: v.count }));

  return { storeList, storeTypeList, categoryList, storeDetails: storeDetailsList };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Método não permitido" });
  }

  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");

  const now = Date.now();
  if (cachedAnalytics && now - lastCacheTime < CACHE_TTL_MS) {
    return res.status(200).json({ ok: true, ...cachedAnalytics });
  }

  try {
    const analytics = await buildAnalytics();
    cachedAnalytics = analytics;
    lastCacheTime = now;
    return res.status(200).json({ ok: true, ...analytics });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Erro ao calcular analytics: " + err.message });
  }
};
