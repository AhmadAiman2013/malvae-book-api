import { Hono } from 'hono'

const app = new Hono().basePath('/api')

app.get('/hello', (c) => {
    console.log({ level: 'info', msg: 'call Hello', userAgent: c.req.header('user-agent') })
    return c.json({ message: 'Hello from Hono', time: new Date().toISOString() })
})

export default app