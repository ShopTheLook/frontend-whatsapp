import baileys, {
    DisconnectReason, downloadContentFromMessage,
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
import {bucket} from "./storageConfig.js"

const {makeWASocket, downloadMediaMessage} = baileys
const store = makeInMemoryStore({logger: P({level: "silent"})})
let sock

export async function initializeWhatsAppClient() {
    const {state, saveCreds} = await useMultiFileAuthState("auth")

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        syncFullHistory: true,
        generateHighQualityLinkPreview: true,
    })

    store.bind(sock.ev)
    sock.ev.on("creds.update", saveCreds)

    sock.ev.on("connection.update", ({connection, lastDisconnect, qr}) => {
        if (qr) qrcode.generate(qr, {small: true})
        if (
            connection === "close" &&
            lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
        ) {
            console.log("🔌 Reconectando…")
            initializeWhatsAppClient()
        }
        if (connection === "open") console.log("🟢 Conectado a WhatsApp")
    })

    sock.ev.on("messages.upsert", async ({messages, type}) => {
        if (type !== "notify") return

        // JID de este bot/usuario para las menciones
        const meJid = sock.user?.id

        for (const msg of messages) {
            const from = msg.key.remoteJid

            // 1) Desenrollar posibles wrappers
            let message = msg.message
            if (message?.ephemeralMessage) message = message.ephemeralMessage.message
            if (message?.viewOnceMessage) message = message.viewOnceMessage.message
            const ctx = message.extendedTextMessage?.contextInfo
                || message.imageMessage?.contextInfo
                || message.videoMessage?.contextInfo
                || null

            // 2) En grupos, solo procesar si me mencionan
            if (from.endsWith("@g.us") && meJid) {
                const mentions =
                    message?.extendedTextMessage?.contextInfo?.mentionedJid || []
                const shortMeJid = meJid.split(':')[0] + '@s.whatsapp.net'
                if (!mentions.includes(meJid) && !mentions.includes(shortMeJid)) {
                    console.log(`🛑 Ignorando mensaje en ${from} porque no me mencionan`)
                    continue
                }
            }
            let quotedUrl, publicUrl

            // 3) Si es imagen
            if (message?.imageMessage) {
                console.log(`📸 Imagen recibida de ${from}`)
                try {
                    const buffer = await downloadMediaMessage(
                        msg,
                        "buffer",
                        {},
                        {reuploadRequest: sock.updateMediaMessage}
                    )
                    // Subir a Firebase Storage
                    const filename = `whatsapp_${msg.key.id}.jpg`
                    const dest = `images/${filename}`
                    const file = bucket.file(dest)
                    await file.save(buffer, {metadata: {contentType: "image/jpeg"}})
                    await file.makePublic()
                    publicUrl = `https://storage.googleapis.com/${bucket.name}/${dest}`

                    console.log(`✅ Imagen subida a Storage: ${publicUrl}`)

                    if (ctx?.quotedMessage) {
                        const quoted = ctx.quotedMessage

                        // a) Si citan una imagen → visión sobre la imagen citada
                        if (quoted.imageMessage) {
                            console.log(`🔎 Vision search en imagen citada de ${from}`)
                            try {
                                const buffer = await downloadContentFromMessage(
                                    quoted.imageMessage,
                                    "image",
                                )
                                // subimos buffer al bucket
                                const filename = `quoted_${ctx.quotedMessage.imageMessage.mediaKeyTimestamp}.jpg`
                                const dest = `images/${filename}`
                                const file = bucket.file(dest)
                                await file.save(buffer, {metadata: {contentType: "image/jpeg"}})
                                await file.makePublic()
                                quotedUrl = `https://storage.googleapis.com/${bucket.name}/${dest}`

                                console.log(`✅ Imagen subida a Storage: ${quotedUrl}`)

                                // enviamos a OpenAI para vision search

                            } catch (ex) {
                                console.error("❌ Error procesando imagen citada:", ex)
                                await sock.sendMessage(from, {
                                    text: ex?.response?.data?.detail || ex?.message
                                })
                            }
                            if (quotedUrl || publicUrl) {
                                try {
                                    // por ejemplo, envías un DTO con ambas URLs
                                    const dto = {quotedUrl, publicUrl}
                                    // enviamos la respuesta al chat
                                    await sock.sendMessage(from, {text: `🔍 Resultado: ${dto.quotedUrl || dto.publicUrl || "no hay imagen"}`})
                                } catch (e) {
                                    console.error("❌ Error llamando a API de visión:", e)
                                    await sock.sendMessage(from, {text: "⚠️ Error procesando imágenes."})
                                }
                                continue
                            }

                        }
                        const quotedText =
                            quoted.conversation ||
                            quoted.extendedTextMessage?.text ||
                            "[media o contenido no textual]"

                        // el cuerpo de la respuesta
                        const userReply = message.extendedTextMessage.text

                        console.log(`💬 Reply de ${from}: "${userReply}" sobre "${quotedText}"`)

                    }
                    // Procesar con OpenAI y enviar resultados
                    const dtoImg = new MessageImageDTO({
                        uid: from,
                        timestamp: msg.messageTimestamp,
                        imageUrl: publicUrl
                    })
                    const rawProducts = await OpenAIHttpRequest(dtoImg)
                    if (!Array.isArray(rawProducts)) {
                        throw new Error(`Se esperaba array, vino ${typeof rawProducts}`)
                    }
                    const products = rawProducts.map(p => new ProductResponse(p))

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
                        text: err?.response?.data?.detail || err?.message
                    })
                }
                continue
            }

            // 4) Procesar texto
            const body =
                message?.conversation ||
                message?.extendedTextMessage?.text ||
                ""
            console.log(`📩 Mensaje de ${from}: ${body}`)

            try {
                const dtoTxt = new MessageDTO({
                    uid: from,
                    timestamp: msg.messageTimestamp,
                    message: body
                })
                const res = await OpenAIHttpRequest(dtoTxt)

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
                        text: res?.detail || res
                    })
                }
            } catch (err) {
                console.error("❌ Error procesando texto:", err)
                await sock.sendMessage(from, {
                    text: err?.response?.data?.detail || err?.message
                })
            }
        }
    })
}

async function downloadImageAsBuffer(url) {
    const {data} = await axios.get(url, {
        responseType: "arraybuffer",
        headers: {
            "User-Agent": "Mozilla/5.0",
            Referer: "https://www.zara.com/",
            Accept: "image/*,*/*;q=0.8"
        }
    })
    return Buffer.from(data)
}

export {sock}