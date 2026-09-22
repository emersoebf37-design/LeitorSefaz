require("dotenv").config();
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

async function resetErros() {
  const snapshot = await db.collection("leituras").where("status", "==", "erro").get();
  if (snapshot.empty) {
    console.log("Nenhuma entrada com erro encontrada.");
    return;
  }

  const batch = db.batch();
  snapshot.docs.forEach((doc) => {
    batch.update(doc.ref, { status: "pendente", erro: null });
  });

  await batch.commit();
  console.log(`${snapshot.size} entrada(s) redefinida(s) para 'pendente'.`);
}

resetErros()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Erro ao redefinir:", err);
    process.exit(1);
  });
