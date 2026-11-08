import { Hono } from 'hono'

const app = new Hono().basePath('/api')

app.get('/hello', (c) =>
    c.json({ message: 'Hello from Hono', time: new Date().toISOString() })
)

export default app