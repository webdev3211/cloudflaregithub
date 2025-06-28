// index.ts
import { Hono } from 'hono'
import { FormData, File } from 'formdata-node'
import { fileFromPath } from 'formdata-node/file-from-path'

const app = new Hono()

const TWITTER_BASE_URL = 'https://api.twitter.com/2'

function getOAuthBaseString(oauth: Record<string, string>, url: string, method: string): string {
    const paramString = Object.keys(oauth)
        .sort()
        .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(oauth[key])}`)
        .join('&')

    return `${method}&${encodeURIComponent(url)}&${encodeURIComponent(paramString)}`
}

async function getOAuthHeader(env: any, url: string, method = 'POST') {
    const oauth: Record<string, string> = {
        oauth_consumer_key: env.TWITTER_API_KEY,
        oauth_token: env.TWITTER_ACCESS_TOKEN,
        oauth_nonce: crypto.randomUUID(),
        oauth_signature_method: 'HMAC-SHA1',
        oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
        oauth_version: '1.0',
    }

    const baseString = getOAuthBaseString(oauth, url, method)
    const signingKey = `${encodeURIComponent(env.TWITTER_API_SECRET)}&${encodeURIComponent(env.TWITTER_ACCESS_SECRET)}`

    // HMAC-SHA1 using Web Crypto API
    const keyBuffer = new TextEncoder().encode(signingKey)
    const baseBuffer = new TextEncoder().encode(baseString)

    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyBuffer,
        { name: 'HMAC', hash: 'SHA-1' },
        false,
        ['sign']
    )

    const signatureArrayBuffer = await crypto.subtle.sign('HMAC', cryptoKey, baseBuffer)
    const signatureBytes = new Uint8Array(signatureArrayBuffer)
    const signature = btoa(String.fromCharCode(...signatureBytes))

    oauth['oauth_signature'] = signature

    return (
        'OAuth ' +
        Object.entries(oauth)
            .map(([k, v]) => `${k}="${encodeURIComponent(v)}"`)
            .join(', ')
    )
}

async function signedPost(env: any, url: string, body: any) {
    const headers = {
        Authorization: await getOAuthHeader(env, url),
        'Content-Type': 'application/json',
        'User-Agent': env.USER_AGENT
    }
    return await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    })
}

app.get('/healthcheck', (c) => {
    console.log("Req came at healthcheck: ", c.env.TWITTER_ACCESS_SECRET);
    return c.json({ success: true, user_id: c.env.USER_ID })
})

app.post('/autotweet/tweet', async (c) => {
    const { text, image_url } = await c.req.json()
    const env = c.env
    let media_id = null

    if (image_url) {
        try {
            const imageRes = await fetch(image_url)
            const imageBuffer = await imageRes.arrayBuffer()
            const form = new FormData()
            const blob = new Blob([imageBuffer], { type: 'image/jpeg' })
            form.set('media', new File([blob], 'image.jpg'))

            const headers = {
                Authorization: await getOAuthHeader(env, 'https://upload.twitter.com/1.1/media/upload.json'),
            }

            const uploadRes = await fetch('https://upload.twitter.com/1.1/media/upload.json', {
                method: 'POST',
                headers,
                body: form as any,
            })

            const uploadJson = await uploadRes.json()
            media_id = uploadJson.media_id_string
        } catch (err) {
            console.log('Image upload error:', err)
        }
    }

    const tweetBody = media_id ? { text, media: { media_ids: [media_id] } } : { text }

    try {
        const tweetRes = await signedPost(env, TWITTER_BASE_URL + '/tweets', tweetBody)
        const tweetJson = await tweetRes.json()
        console.log(tweetJson);
        return c.json({ success: true, id: tweetJson.data.id })
    } catch (err: any) {
        console.log("Errro at /tweet due to: " + err);
        return c.json({ success: false, message: err.message }, 500)
    }
})

app.post('/autotweet/retweet', async (c) => {
    const { tweet_id } = await c.req.json()
    const env = c.env
    try {
        const res = await signedPost(env, `${TWITTER_BASE_URL}/users/${env.USER_ID}/retweets`, { tweet_id })
        if (!res.ok) throw new Error(await res.text())
        return c.json({ success: true, message: 'Retweet done success' })
    } catch (err: any) {
        console.log("Errro at /retweet due to: " + err);
        return c.json({ success: false, message: err.message }, 500)
    }
})

app.post('/autotweet/like', async (c) => {
    const { tweet_id } = await c.req.json()
    const env = c.env
    try {
        const res = await signedPost(env, `${TWITTER_BASE_URL}/users/${env.USER_ID}/likes`, { tweet_id })
        if (!res.ok) throw new Error(await res.text())
        return c.json({ success: true, message: 'Like done success' })
    } catch (err: any) {
        console.log("Errro at /like due to: " + err);
        return c.json({ success: false, message: err.message }, 500)
    }
})

app.post('/autotweet/comment', async (c) => {
    const { tweet_id, text } = await c.req.json()
    const env = c.env
    try {
        const res = await signedPost(env, `${TWITTER_BASE_URL}/tweets`, {
            text,
            reply: { in_reply_to_tweet_id: tweet_id },
        })
        const data = await res.json()
        return c.json({ success: true, id: data.data.id, message: 'Reply done success' })
    } catch (err: any) {
        console.log("Errro at /comment due to: " + err);
        return c.json({ success: false, message: err.message }, 500)
    }
})

app.post('/autotweet/quote', async (c) => {
    const { tweet_id, text } = await c.req.json()
    const env = c.env
    try {
        const res = await signedPost(env, `${TWITTER_BASE_URL}/tweets`, {
            text,
            quote_tweet_id: tweet_id,
        })
        const data = await res.json()
        return c.json({ success: true, id: data.data.id, message: 'Quote done success' })
    } catch (err: any) {
        console.log("Errro at /quote due to: " + err);
        return c.json({ success: false, message: err.message }, 500)
    }
})

export default app
