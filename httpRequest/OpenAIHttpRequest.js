async function fetchOpenAIRequest(message) {
const apiUrl = process.env.OPENAI_API_URL
    if (!apiUrl) {
        console.log('API URL is not defined in the environment variables.')
    }
    console.log(message)
    const res = await fetch(apiUrl+"/api/v1/process", {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },body: JSON.stringify(message)
    })
    if (!res.ok) {
        console.log(`Error: ${res.status} ${res.statusText}`)
    }
    return res.json()
}

export default fetchOpenAIRequest