// config/firebaseAdmin.js
import admin from "firebase-admin"
import { readFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

// __dirname en ESM
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Carga tu clave de servicio JSON
const serviceAccount = JSON.parse(
    readFileSync(join(__dirname, "serviceAccountKey.json"), "utf8")
)

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: "gitgartenconnect.appspot.com"  // <- tu bucket
})

export const bucket = admin.storage().bucket()