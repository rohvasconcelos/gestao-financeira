import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';

async function connectToWhatsApp() {
    console.log("🔄 Inicializando autenticação...");
    
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    console.log("✅ Autenticação carregada com sucesso!");

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true // Para exibir o QR Code no terminal
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log("📸 Escaneie o QR Code abaixo:");
            qrcode.generate(qr, { small: true }); // Exibe QR Code no terminal
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom) 
                ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut 
                : true;

            console.log('🔌 Conexão fechada:', lastDisconnect?.error, '🔄 Reconectando:', shouldReconnect);

            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('✅ Conectado ao WhatsApp com sucesso!');
        }
    });

    sock.ev.on('messages.upsert', async (event) => {
        for (const m of event.messages) {
            if (!m.key.fromMe) {
                console.log('📩 Mensagem recebida:', m.message);

                const remoteJid = m.key.remoteJid;
                if (remoteJid) {
                    await sock.sendMessage(remoteJid, { text: 'Olá! Mensagem recebida com sucesso.' });
                    console.log('✅ Resposta enviada para:', remoteJid);
                }
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

connectToWhatsApp();
