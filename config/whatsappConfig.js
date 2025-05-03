import baileys, {DisconnectReason, makeInMemoryStore, useMultiFileAuthState} from "@whiskeysockets/baileys"
import qrcode from "qrcode-terminal";
import P from "pino"

const makeWASocket = baileys.makeWASocket
let sock
const store = makeInMemoryStore({ logger: P({ level: 'silent' }) })
async function initializeWhatsAppClient() {
   const { state, saveCreds } = await useMultiFileAuthState('auth')

   sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      syncFullHistory: true
   })

   store.bind(sock.ev)

   sock.ev.on('creds.update', saveCreds)

   sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update

      if (qr) {
         qrcode.generate(qr, { small: true })
         console.log('📱 Escanea este código QR con WhatsApp')
      }

      if (connection === 'close') {
         const shouldReconnect =
             lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
         if (shouldReconnect) {
            console.log('🔌 Reconectando...')
            initializeWhatsAppClient()
         } else {
            console.log('❌ Sesión cerrada manualmente.')
         }
      }

      if (connection === 'open') {
         console.log('🟢 Conectado a WhatsApp')
      }
   })

   sock.ev.on('messages.upsert', async ({messages, type})=>{
        if (type === 'notify') {
           for (const msg of messages) {
              const form = msg.key.remoteJid
              const body = msg.message?.conversation || msg.message?.extendedTextMessage?.text

              console.log(`Mensaje recibido: [${form}] ${body}`)

              await sock.sendMessage(form, { text: 'Hola, ¿en que puedo ayudarle?' })
           }
        }
   })
}


export { initializeWhatsAppClient, sock }