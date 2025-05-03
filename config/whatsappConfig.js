import baileys, {
    DisconnectReason,
    makeInMemoryStore,
    useMultiFileAuthState
} from "@whiskeysockets/baileys"
import qrcode from "qrcode-terminal"
import P from "pino"
import axios from "axios"

import MessageDTO from "../entity/messageDTO.js"
import MessageImageDTO from "../entity/messageImageDTO.js"
import ProductSearchResponse, {ProductResponse} from "../entity/productSearchResponse.js"


import OpenAIHttpRequest from "../httpRequest/OpenAIHttpRequest.js"
import { bucket } from "./storageConfig.js"

const { makeWASocket, downloadMediaMessage } = baileys
const store = makeInMemoryStore({ logger: P({ level: "silent" }) })
let sock

export async function initializeWhatsAppClient() {
    const { state, saveCreds } = await useMultiFileAuthState("auth")

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        syncFullHistory: true,
        generateHighQualityLinkPreview: true,
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

            // 1) DESENROLLAR mensajes especiales
            let message = msg.message
            if (message?.ephemeralMessage) message = message.ephemeralMessage.message
            if (message?.viewOnceMessage) message = message.viewOnceMessage.message

            // 2) SI ES IMAGEN
            if (message?.imageMessage) {
                console.log(`📸 Imagen recibida de ${from}`)
                try {
                    // Descargar imagen descifrada
                    const buffer = await downloadMediaMessage(
                        msg,
                        "buffer",
                        {},
                        { reuploadRequest: sock.updateMediaMessage }
                    )

                    // Subir a Firebase Storage
                    const filename = `whatsapp_${msg.key.id}.jpg`
                    const dest = `images/${filename}`
                    const file = bucket.file(dest)
                    await file.save(buffer, { metadata: { contentType: "image/jpeg" } })
                    await file.makePublic()
                    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${dest}`

                    console.log(`✅ Imagen subida a Storage: ${publicUrl}`)

                    // Enviar DTO al backend y recibir array directamente
                    const dto = new MessageImageDTO({
                        uid: from,
                        timestamp: msg.messageTimestamp,
                        imageUrl: publicUrl
                    })
                    const rawProducts = await OpenAIHttpRequest(dto)

                    if (!Array.isArray(rawProducts)) {
                        throw new Error(`Se esperaba un array, llegó ${typeof rawProducts}`)
                    }

                    // Envolver cada objeto en ProductResponse
                    const products = rawProducts.map(p => new ProductResponse(p))

                    // Enviar resultados por WhatsApp
                    for (const product of products) {
                        const caption = `🛍️ *${product.name}*\n💶 ${product.price} €\n🔗 ${product.link}`
                        const mediaArray = []

                        for (const [i, url] of product.images.entries()) {
                            try {
                                const imgBuffer = await downloadImageAsBuffer(url)
                                if (!imgBuffer) continue
                                mediaArray.push({
                                    image: imgBuffer,
                                    caption: i === 0 ? caption : undefined
                                })
                            } catch (err) {
                                console.error(`❌ Error descargando ${url}:`, err.message)
                            }
                        }

                        for (const media of mediaArray) {
                            await sock.sendMessage(from, media)
                        }
                    }

                } catch (err) {
                    console.error("❌ Error procesando imagen:", err)
                    await sock.sendMessage(from, {
                        text: "⚠️ No pude procesar tu imagen, lo siento."
                    })
                }
                continue
            }

            // 3) PROCESAR TEXTO
            const body =
                message?.conversation ||
                message?.extendedTextMessage?.text ||
                ""
            console.log(`📩 Mensaje de ${from}: ${body}`)

            try {
                const dto = new MessageDTO({
                    uid: from,
                    timestamp: msg.messageTimestamp,
                    message: body
                })
                const res = await OpenAIHttpRequest(dto)

                if (res?.top && res?.bottom) {
                    const productData = new ProductSearchResponse(res)
                    const sections = [productData.top, productData.bottom]

                    for (const product of sections) {
                        const caption = `🛍️ *${product.name}*\n💶 ${product.price} €\n🔗 ${product.link}`
                        const mediaArray = []

                        for (const [i, url] of product.images.entries()) {
                            try {
                                const imgBuffer = await downloadImageAsBuffer(url)
                                if (!imgBuffer) continue
                                mediaArray.push({
                                    image: imgBuffer,
                                    caption: i === 0 ? caption : undefined
                                })
                            } catch (err) {
                                console.error(`❌ Error descargando ${url}:`, err.message)
                            }
                        }

                        for (const media of mediaArray) {
                            await sock.sendMessage(from, media)
                        }
                    }

                } else {
                    await sock.sendMessage(from, {
                        text: res.detail || "⚠️ No se pudo procesar la respuesta correctamente."
                    })
                }

            } catch (err) {
                console.error("❌ Error procesando texto:", err)
                await sock.sendMessage(from, {
                    text: "⚠️ Hubo un error al procesar tu mensaje."
                })
            }
        }
    })
}

async function downloadImageAsBuffer(url) {
    const { data } = await axios.get(url, {
        responseType: "arraybuffer",
        headers: {
            "User-Agent": "Mozilla/5.0",
            Referer: "https://www.zara.com/",
            Accept: "image/*,*/*;q=0.8"
        }
    })
    return Buffer.from(data)
}

export { sock }