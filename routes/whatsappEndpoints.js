import express from 'express'

import {sock} from "../config/whatsappConfig.js";
import WhatsappRequest from "../entity/whatsappRequest.js";
const router = express.Router()

router.post('/send_message', async (req, res) => {
    let dto

    try {
        dto = new WhatsappRequest(req.body)
    } catch (err) {
        return res.status(400).json({ error: err.message })
    }

    try {
        await sock.sendMessage(dto.phone, { text: dto.message })
        res.json({ success: true })
    } catch (err) {
        console.error('❌ Error enviando el mensaje:', err)
        res.status(500).json({ error: 'Error al enviar el mensaje' })
    }
})

export default router