import path from 'path'
import {bucket} from "./storageConfig.js";

/**
 * Sube un fichero local al bucket y devuelve su URL pública.
 *
 * @param {string} localFilePath  Ruta en disco al fichero (p.ej. './downloads/img.jpg')
 * @param {string} [bucketPath]   Ruta dentro del bucket (p.ej. 'whatsapp/img.jpg').
 *                                Por defecto será 'images/<basename>'
 * @returns {Promise<string>}     URL pública de Firebase Storage
 */
export async function uploadImageFile(localFilePath, bucketPath) {
    // Usa el nombre original si no se pasa destino
    const destination =
        bucketPath ||
        `images/${Date.now()}_${path.basename(localFilePath)}`

    // Sube el fichero
    await bucket.upload(localFilePath, {
        destination,
        metadata: { contentType: 'image/jpeg' },
        public: true
    })

    // Devuelve URL pública
    return `https://storage.googleapis.com/${bucket.name}/${destination}`
}

/**
 * Sube un Buffer directamente al bucket y devuelve su URL pública.
 *
 * @param {Buffer} buffer         Contenido del archivo en memoria
 * @param {string} filename       Nombre del fichero (p.ej. 'foo.jpg')
 * @param {string} [bucketPath]   Ruta dentro del bucket. Por defecto 'images/<filename>'
 * @returns {Promise<string>}
 */
export async function uploadImageBuffer(buffer, filename, bucketPath) {
    const destination =
        bucketPath ||
        `images/${Date.now()}_${filename}`

    const file = bucket.file(destination)
    // Guarda el buffer
    await file.save(buffer, {
        metadata: { contentType: 'image/jpeg' }
    })
    // Hazlo público
    await file.makePublic()

    return `https://storage.googleapis.com/${bucket.name}/${destination}`
}