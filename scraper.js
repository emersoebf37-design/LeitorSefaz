require("dotenv").config();
const admin = require("firebase-admin");
const puppeteer = require("puppeteer");

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

async function extractNotaData(page) {
  return await page.evaluate(() => {
    function cleanText(txt) {
      return (txt || "").replace(/\s+/g, " ").trim();
    }

    function parseNumber(txt) {
      if (!txt) return null;
      const clean = txt.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
      const n = parseFloat(clean);
      return isNaN(n) ? null : n;
    }

    const topoEl = document.querySelector(".txtCenter .txtTopo, .txtCenter #u20");
    const razaoSocial = topoEl ? cleanText(topoEl.innerText) : "";

    let cnpj = "";
    let endereco = "";
    const textEls = document.querySelectorAll(".txtCenter .text");
    textEls.forEach((el) => {
      const txt = cleanText(el.innerText);
      if (txt.toUpperCase().includes("CNPJ:")) {
        cnpj = txt.replace(/CNPJ:\s*/i, "").trim();
      } else if (!endereco && txt.length > 0) {
        endereco = txt.replace(/\s*,\s*/g, ", ").trim();
      }
    });

    const produtos = [];
    const rows = document.querySelectorAll("#tabResult tbody tr, #tabResult tr");
    rows.forEach((row) => {
      const nomeEl = row.querySelector(".txtTit");
      if (!nomeEl) return;
      const nome = cleanText(nomeEl.innerText);

      const qtdEl = row.querySelector(".Rqtd");
      const qtdText = qtdEl ? cleanText(qtdEl.innerText).replace(/Qtde\.:\s*/i, "") : "";
      const quantidade = parseNumber(qtdText);

      const unEl = row.querySelector(".RUN");
      const unidade = unEl ? cleanText(unEl.innerText).replace(/UN:\s*/i, "") : "";

      const vlUnitEl = row.querySelector(".RvlUnit");
      const vlUnitText = vlUnitEl ? cleanText(vlUnitEl.innerText).replace(/Vl\.\s*Unit\.:\s*/i, "") : "";
      const valorUnitario = parseNumber(vlUnitText);

      const vlTotalEl = row.querySelector(".valor");
      const vlTotalText = vlTotalEl ? cleanText(vlTotalEl.innerText) : "";
      const valorTotal = parseNumber(vlTotalText);

      produtos.push({
        nome,
        quantidade,
        unidade,
        valorUnitario,
        valorTotal
      });
    });

    return {
      estabelecimento: {
        razaoSocial,
        cnpj,
        endereco
      },
      produtos
    };
  });
}

async function startScraper() {
  console.log("Iniciando Puppeteer...");
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ["--start-maximized"]
  });

  const page = await browser.newPage();

  console.log("Ouvindo novas leituras no Firestore (coleção 'leituras')...");

  db.collection("leituras")
    .where("status", "==", "pendente")
    .limit(10)
    .onSnapshot(async (snapshot) => {
      for (const change of snapshot.docChanges()) {
        if (change.type === "added") {
          const doc = change.doc;
          const data = doc.data();

          console.log(`Nova leitura detectada [${doc.id}]:`, data);

          try {
            await doc.ref.update({ status: "processando" });

            if (data.tipo === "qrcode" && data.url) {
              console.log(`Navegando para a URL do QR Code: ${data.url}`);
              await page.goto(data.url, { waitUntil: "networkidle2", timeout: 60000 });
            } else if (data.tipo === "chave_acesso" && data.chave) {
              console.log(`Consultando chave de acesso: ${data.chave}`);
              await page.goto("https://www.fazenda.rj.gov.br/nfce/consulta", {
                waitUntil: "networkidle2",
                timeout: 60000
              });

              const inputSelector = 'input[name="chaveAcesso"], input#chaveAcesso, input[name="chave"], input[type="text"]';
              await page.waitForSelector(inputSelector, { timeout: 15000 });
              await page.type(inputSelector, data.chave);
            }

            await page.waitForSelector(".txtCenter, #tabResult", { timeout: 30000 });
            const extraidos = await extractNotaData(page);

            console.log("Dados extraídos:", JSON.stringify(extraidos, null, 2));

            await doc.ref.update({
              status: "concluido",
              dados: extraidos,
              processadoEm: admin.firestore.FieldValue.serverTimestamp()
            });
          } catch (err) {
            console.error(`Erro ao processar leitura [${doc.id}]:`, err.message);
            await doc.ref.update({ status: "erro", erro: err.message });
          }
        }
      }
    }, (err) => {
      console.error("Erro no listener do Firestore:", err);
    });
}

startScraper().catch((err) => {
  console.error("Falha ao iniciar o scraper:", err);
});
