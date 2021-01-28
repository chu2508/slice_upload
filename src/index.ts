import Koa from "koa";
import KoaBody from "koa-body";
import KoaStatic from "koa-static";
import path from "path";
import cors from "koa2-cors";
import { router } from "./router";
const app = new Koa();
app.use(cors());
app.use(KoaStatic(path.resolve(path.join(__dirname, "../public/"))));
app.use(KoaBody({ multipart: true }));
app.use(router.routes());

const port = 38080;
app.listen(port, () => {
  console.log("server opened");
});
