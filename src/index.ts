import Koa from 'koa'

const app = new Koa()

app.use((ctx) => {
    ctx.body = 'hello word';
})

const port = 38080
app.listen(port, () => {
    console.log('server opened');
})