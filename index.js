const { makeWASocket, useSingleFileAuthState } = require("@whiskeysockets/baileys");
const { writeFileSync } = require("fs");
const mongoose = require("mongoose");
require("dotenv").config();

// Conectar ao MongoDB
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ Conectado ao MongoDB"))
  .catch(err => console.error("❌ Erro ao conectar ao MongoDB:", err));

// Definir modelo para despesas
const DespesaSchema = new mongoose.Schema({
  valor: Number,
  categoria: String,
  data: { type: Date, default: Date.now }
});
const Despesa = mongoose.model("Despesa", DespesaSchema);

// Configurar autenticação do WhatsApp
const { state, saveState } = useSingleFileAuthState("./auth_info.json");
const sock = makeWASocket({ auth: state });

sock.ev.on("creds.update", saveState);
sock.ev.on("messages.upsert", async (msg) => {
  const message = msg.messages[0];
  if (!message.message || message.key.fromMe) return;

  const text = message.message.conversation || message.message.extendedTextMessage?.text;
  const sender = message.key.remoteJid;

  if (text) {
    if (text.match(/^\d+ \w+$/)) {
      // Exemplo: "110 ifood"
      const [valor, categoria] = text.split(" ");
      const novaDespesa = new Despesa({ valor: parseFloat(valor), categoria });
      await novaDespesa.save();
      
      sock.sendMessage(sender, { text: `✅ Despesa registrada: R$${valor} em ${categoria}` });
    } else if (text === "saldo") {
      // Buscar gastos no MongoDB
      const despesas = await Despesa.aggregate([
        { $group: { _id: null, total: { $sum: "$valor" } } }
      ]);
      const total = despesas.length > 0 ? despesas[0].total : 0;
      
      sock.sendMessage(sender, { text: `📊 Seu saldo do mês: R$${total.toFixed(2)}` });
    }
  }
});
