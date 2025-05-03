class WhatsappRequest {
    constructor({ phone, message }) {
        if (!phone || !message) {
            throw new Error('Faltan campos obligatorios: phone y message')
        }

        this.message = message
        this.phone = this.formatPhone(phone)
    }

    formatPhone(phone) {
        const base = phone.replace(/[^0-9]/g, '') // limpia caracteres
        if (!base || base.length < 8) {
            throw new Error('Número de teléfono inválido')
        }
        return `${base}@s.whatsapp.net`
    }
}

export default WhatsappRequest