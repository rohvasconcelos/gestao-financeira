import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import dotenv from 'dotenv';
import { Configuration, OpenAIApi } from 'openai';

// Carregar variáveis de ambiente do .env
dotenv.config();

// Configuração da OpenAI
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// Função para gerar respostas da OpenAI
async function getOpenAIResponse(message) {
  try {
    const response = await openai.createCompletion({
      model: 'text-davinci-003', // Ou use 'gpt-3.5-turbo' ou 'gpt-4' se necessário
      prompt: message,
      max_tokens: 150,
    });
    return response.data.choices[0].text.trim();
  } catch (error) {
    console.error('Erro ao chamar a OpenAI:', error);
    return 'Desculpe, não consegui processar sua solicitação no momento.';
  }
}

// Função para processar a mensagem recebida e enviar uma resposta
async function processMessage(message) {
  const response = await getOpenAIResponse(message);
  return response;
}

// Conectar-se ao WhatsApp e configurar o bot
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true, // Exibe o QR code no terminal
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        connectToWhatsApp();
      }
    } else if (connection === 'open') {
      console.log('Conexão aberta!');
    }
  });

  // Processar as mensagens recebidas
  sock.ev.on('messages.upsert', async (event) => {
    for (const m of event.messages) {
      const messageText = m.message.conversation || '';
      console.log('Mensagem recebida:', messageText);

      // Chamar a IA da OpenAI para gerar uma resposta
      const response = await processMessage(messageText);
      await sock.sendMessage(m.key.remoteJid, { text: response });
    }
  });

  // Salvar credenciais quando atualizadas
  sock.ev.on('creds.update', saveCreds);
}

// Iniciar a conexão com o WhatsApp
connectToWhatsApp();
