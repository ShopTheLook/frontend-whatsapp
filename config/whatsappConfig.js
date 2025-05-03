import baileys, {
    DisconnectReason,
    makeInMemoryStore,
    useMultiFileAuthState
} from "@whiskeysockets/baileys"
import qrcode from "qrcode-terminal"
import P from "pino"
import MessageDTO from "../entity/messageDTO.js"
import OpenAIHttpRequest from "../httpRequest/OpenAIHttpRequest.js"
import {bucket} from "./storageConfig.js";
import MessageImageDTO from "../entity/messageImageDTO.js";
   // ← importamos el bucket de Firebase

const { makeWASocket, downloadMediaMessage } = baileys

let sock
const store = makeInMemoryStore({ logger: P({ level: "silent" }) })

async function initializeWhatsAppClient() {
    const { state, saveCreds } = await useMultiFileAuthState("auth")

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        syncFullHistory: true
    })

    store.bind(sock.ev)
    sock.ev.on("creds.update", saveCreds)

    sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
        if (qr) qrcode.generate(qr, { small: true })
        if (
            connection === "close" &&
            lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
        ) {
            console.log("🔌 Reconectando…")
            initializeWhatsAppClient()
        }
        if (connection === "open") console.log("🟢 Conectado a WhatsApp")
    })

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify") return

        for (const msg of messages) {
            const from = msg.key.remoteJid

            // 1) DESENROLLAR posibles envueltos
            let message = msg.message
            if (message?.ephemeralMessage) message = message.ephemeralMessage.message
            if (message?.viewOnceMessage)  message = message.viewOnceMessage.message

            // 2) SI ES IMAGEN
            if (message?.imageMessage) {
                console.log(`📸 Imagen recibida de ${from}`)
                try {
                    // descargamos buffer descifrado
                    const buffer = await downloadMediaMessage(
                        msg,
                        "buffer",
                        {},
                        { reuploadRequest: sock.updateMediaMessage }
                    )

                    // subimos a Firebase Storage
                    const filename = `whatsapp_${msg.key.id}.jpg`
                    const dest = `images/${filename}`
                    const file = bucket.file(dest)
                    await file.save(buffer, { metadata: { contentType: "image/jpeg" } })
                    await file.makePublic()
                    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${dest}`

                    console.log(`✅ Imagen subida a Storage: ${publicUrl}`)

                    // Aqui se envia la imagen al backend
                    const dto = new MessageImageDTO({
                        uid: from,
                        timestamp: msg.messageTimestamp,
                        imageUrl: publicUrl
                    })
                    const res = await OpenAIHttpRequest(dto)
                    const reply =
                        typeof res === "string"
                            ? res
                            : "⚠️ Error procesando tu mensaje, inténtalo más tarde."

                    await sock.sendMessage(from, { text: reply })
                } catch (err) {
                    console.error("❌ Error procesando imagen:", err)
                    await sock.sendMessage(from, {
                        text: "⚠️ No pude procesar tu imagen, lo siento."
                    })
                }
                continue
            }

            // 3) PROCESAR TEXTO con OpenAI
            const body =
                message?.conversation ||
                message?.extendedTextMessage?.text ||
                ""
            console.log(`📩 Mensaje de ${from}: ${body}`)

            const dto = new MessageDTO({
                uid: from,
                timestamp: msg.messageTimestamp,
                message: body
            })
            const res = await OpenAIHttpRequest(dto)
            const reply =
                typeof res === "string"
                    ? res
                    : "⚠️ Error procesando tu mensaje, inténtalo más tarde."

            await sock.sendMessage(from, { text: reply })
        }
    })
}

export { initializeWhatsAppClient, sock }