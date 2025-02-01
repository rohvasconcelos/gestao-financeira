import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

// Configurações iniciais
dotenv.config();

// Conectar ao MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Conectado ao MongoDB"))
  .catch(err => console.error("❌ Erro ao conectar ao MongoDB:", err));

// Definir modelo para despesas
const DespesaSchema = new mongoose.Schema({
  valor: Number,
  categoria: String,
  data: { type: Date, default: Date.now },
  parcelas: { type: Number, default: 1 },
  usuario: String
});
const Despesa = mongoose.model("Despesa", DespesaSchema);

// Função para interpretar mensagens com regex
function interpretarMensagem(texto) {
  const padraoSimples = /^(\w+)\s+(\d+)$/;
  const padraoParcela = /^parcela\s+(\d+)x\s+(\d+)$/i;

  const matchSimples = texto.match(padraoSimples);
  const matchParcela = texto.match(padraoParcela);

  if (matchSimples) {
    const [, categoria, valor] = matchSimples;
    return { valor: parseFloat(valor), categoria, parcelas: 1 };
  } else if (matchParcela) {
    const [, parcelas, valor] = matchParcela;
    return { valor: parseFloat(valor), categoria: "Parcela", parcelas: parseInt(parcelas) };
  }

  return null;
}

// Função para registrar despesa
async function registrarDespesa(usuario, valor, categoria, parcelas = 1) {
  const despesa = new Despesa({ valor, categoria, parcelas, usuario });
  await despesa.save();
  return despesa;
}

// Função para calcular saldo
async function calcularSaldo(usuario) {
  const despesas = await Despesa.aggregate([
    { $match: { usuario } },
    { $group: { _id: null, total: { $sum: "$valor" } } }
  ]);
  return despesas.length > 0 ? despesas[0].total : 0;
}

// Função para gerar relatório de gastos por categoria
async function gerarRelatorio(usuario) {
  const relatorio = await Despesa.aggregate([
    { $match: { usuario } },
    { $group: { _id: "$categoria", total: { $sum: "$valor" } } }
  ]);
  return relatorio.map(item => `${item._id}: R$${item.total.toFixed(2)}`).join('\n');
}

// Função principal para conectar ao WhatsApp
async function connectToWhatsApp() {
  console.log("🔄 Inicializando autenticação...");

  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  console.log("✅ Autenticação carregada com sucesso!");

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true
  });

  sock.ev.on('connection.update', async (update) => {  // Alterado para função assíncrona
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("📸 Escaneie o QR Code abaixo:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error instanceof Boom)
        ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut
        : true;

      console.log('🔌 Conexão fechada:', lastDisconnect?.error, '🔄 Reconectando:', shouldReconnect);

      if (shouldReconnect) {
        setTimeout(connectToWhatsApp, 5000); // Reconectar após 5 segundos
      }
    } else if (connection === 'open') {
      console.log('✅ Conectado ao WhatsApp com sucesso!');

      // Enviar uma mensagem automática para um número específico assim que a conexão for aberta
      const numeroDestino = '5592981731071@c.us'; // Substitua pelo número para o qual você deseja enviar a mensagem
      await sock.sendMessage(numeroDestino, { text: '✅ O bot foi iniciado com sucesso! Como posso te ajudar?' });
    }
  });

  sock.ev.on('messages.upsert', async (event) => {
    try {
      for (const m of event.messages) {
        if (!m.key.fromMe) {
          const remoteJid = m.key.remoteJid;
          const texto = m.message.conversation || m.message.extendedTextMessage?.text;

          if (remoteJid && texto) {
            const usuario = remoteJid.split('@')[0];

            const despesa = interpretarMensagem(texto);

            if (despesa) {
              // Registrar despesa
              await registrarDespesa(usuario, despesa.valor, despesa.categoria, despesa.parcelas);
              await sock.sendMessage(remoteJid, { text: `✅ Despesa registrada: R$${despesa.valor} em ${despesa.categoria} (${despesa.parcelas}x)` });
            } else if (texto.toLowerCase() === 'saldo') {
              // Consultar saldo
              const saldo = await calcularSaldo(usuario);
              await sock.sendMessage(remoteJid, { text: `📊 Seu saldo atual: R$${saldo.toFixed(2)}` });
            } else if (texto.toLowerCase() === 'relatorio') {
              // Gerar relatório
              const relatorio = await gerarRelatorio(usuario);
              await sock.sendMessage(remoteJid, { text: `📝 Relatório de gastos:\n${relatorio}` });
            } else {
              await sock.sendMessage(remoteJid, { text: '❌ Não entendi. Use formatos como "ifood 144" ou "parcela 3x 150".' });
            }
          }
        }
      }
    } catch (error) {
      console.error('❌ Erro ao processar mensagem:', error);
    }
  });

  sock.ev.on('creds.update', saveCreds);
}

connectToWhatsApp();  // Chama a função de conexão com o WhatsApp
