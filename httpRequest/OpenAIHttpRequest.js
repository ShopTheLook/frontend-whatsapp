async function fetchOpenAIRequest(message) {
    const apiUrl = process.env.OPENAI_API_URL;

    if (!apiUrl) {
        console.error('[ERROR] La variable de entorno OPENAI_API_URL no está definida. Asegúrate de configurarla antes de ejecutar la función.');
        return null;
    }

    try {
        const res = await fetch(`${apiUrl}/api/v1/process`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(message),
        });

        if (!res.ok) {
            let detailMessage = '';
            try {
                const errorJson = await res.json();
                detailMessage = errorJson.detail || 'Error desconocido';
            } catch (e) {
                detailMessage = await res.text();
            }

            const error = `[ERROR HTTP ${res.status}] La API respondió con un error.\nMotivo: ${res.statusText}\nDetalles: ${detailMessage}`;
            console.error(error);

            return detailMessage;
        }

        return await res.json();
    } catch (error) {
        console.error('[ERROR DE CONEXIÓN] No se pudo conectar con el servidor de OpenAI.');
        console.error('Posibles causas:');
        console.error('- La URL es incorrecta.');
        console.error('- El servidor está caído.');
        console.error('- Hay un problema de red o cortafuegos.');
        console.error('Detalles técnicos:', error);
        return null;
    }
}

export default fetchOpenAIRequest;