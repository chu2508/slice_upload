import Koa from "koa";
import KoaRouter from "@koa/router";
import KoaBody from "koa-body";
import KoaStatic from "koa-static";
import path from "path";
import cors from "koa2-cors";
import fs from "fs";
import crypto from "crypto";
const router = new KoaRouter({ prefix: "/api" });
interface FileMetadata {
  hash: string;
  fileSize: number;
  chunkSize: number;
  fileName: string;
  fileType: string;
}

type UploadTask = FileMetadata &
  (
    | {
        currentChunk: null;
        done: true;
      }
    | {
        currentChunk: number;
        done: false;
      }
  );
const upload_map: { [key: string]: UploadTask | undefined } = {};
router.post("/task", (ctx) => {
  const metadata = ctx.request.body;
  // 建立临时文件夹存放chunks文件，方便后续合并数据
  makeTempDirByFileHash(metadata.hash);
  let task = upload_map[metadata.hash];
  if (!task) {
    // 将任务信息保存起来，后续断点续传就需要用到这个信息
    task = { chunkSize: 500, currentChunk: 0, done: false, ...metadata };
    upload_map[metadata.hash] = task;
  }
  ctx.body = task;
});

router.post("/upload_chunk", async (ctx) => {
  const upload = ctx.request.body;
  const files = ctx.request.files;
  if (!files) {
    return;
  }
  const { hash, start, end } = upload;
  const { chunk } = files;
  //koa-body 会帮我们将form-data 内的文件自动写入硬盘，我们需要取到这个文件的路径，写入我们自己创建的临时文件夹内
  let filePath;
  if (chunk instanceof Array) {
    filePath = chunk[0].path;
  } else {
    filePath = chunk.path;
  }

  const task = upload_map[hash];
  if (task && !task.done) {
    // 将chunk 保存到临时文件夹内
    const chunkPath = getTempDirByHash(hash) + `/${start}-${end}`;
    const fileRead = fs.createReadStream(filePath);
    const chunkWrite = fs.createWriteStream(chunkPath);
    fileRead.pipe(chunkWrite);
    // 等待写入完成
    await new Promise((resolve) => fileRead.on("end", resolve));
    // 删除@koa/body库，帮我们保存的临时文件
    await fs.promises.unlink(filePath);
    // 下一个chunk 的下标
    task.currentChunk++;
    if (task.currentChunk >= Math.ceil(task.fileSize / task.chunkSize)) {
      // chunk全部上传了 将任务状态切换成完成
      (task.done as any) = true;
      (task.currentChunk as any) = null;
    }
    ctx.body = task;
  } else {
    ctx.status = 400;
    ctx.body = { error: "任务未创建" };
  }
});

router.post("/concat_chunk", async (ctx) => {
  const hash = ctx.request.body.hash;
  const task = upload_map[hash];
  if (!task) {
    ctx.body = { error: "任务未找到" };
    ctx.status = 400;
    return;
  }

  if (!task.done) {
    ctx.body = { error: "文件未全部上传" };
    ctx.status = 400;
    return;
  }

  const chunkDir = getTempDirByHash(hash);
  const chunkCount = Math.ceil(task.fileSize / task.chunkSize);
  const chunkPaths = await fs.promises.readdir(chunkDir);
  if (chunkCount !== chunkPaths.length) {
    ctx.body = { error: "文件切片校验不一致" };
    ctx.status = 500;
    return;
  }
  const chunkFullPaths = chunkPaths
    .sort((a, b) => {
      const a1 = a.split("-")[0];
      const b1 = b.split("-")[0];
      return Number(a1) - Number(b1);
    })
    .map((chunkPath) => path.join(chunkDir, chunkPath));
  const filePath = path.resolve(
    path.join(__dirname, "../upload", `/file/${task.fileName}`)
  );
  await concatChunks(filePath, chunkFullPaths);
  const stat = await fs.promises.stat(filePath);
  if (stat.size !== task.fileSize) {
    ctx.body = { error: "文件长度校验不一致" };
    ctx.status = 500;
    return;
  }

  const fileHash = await getFileMd5(filePath);
  if (fileHash !== task.hash) {
    ctx.body = { error: "文件哈希校验不一致" };
    ctx.status = 500;
    return;
  }

  // 文件上传成功将任务与临时文件夹删除
  upload_map[task.hash] = undefined;

  ctx.body = { ok: true };
});

async function concatChunks(filePath: string, chunkFullPaths: string[]) {
  const write = fs.createWriteStream(filePath);
  for (let chunkFullPath of chunkFullPaths) {
    const read = fs.createReadStream(chunkFullPath);
    read.pipe(write, { end: false });
    await new Promise((r) => read.on("end", r));
    read.close();
  }
  write.close();
}

const app = new Koa();
app.use(cors());
app.use(KoaStatic(path.resolve(path.join(__dirname, "../public/"))));
app.use(KoaBody({ multipart: true }));
app.use(router.routes());

const port = 38080;
app.listen(port, () => {
  console.log("server opened");
});

function makeTempDirByFileHash(hash: string) {
  const dirPath = getTempDirByHash(hash);
  const isExists = fs.existsSync(dirPath);
  if (!isExists) {
    mkdir(dirPath);
  }
}

function getTempDirByHash(hash: string) {
  return path.resolve(path.join(__dirname, "../upload", `/chunk_temp/${hash}`));
}

function mkdir(dirPath: string) {
  if (!fs.existsSync(path.dirname(dirPath))) {
    mkdir(path.dirname(dirPath));
  }
  fs.mkdirSync(dirPath);
}

async function getFileMd5(path: string) {
  const md5 = crypto.createHash("md5");
  const read = fs.createReadStream(path);
  read.on("data", (data) => md5.update(data));
  const hash = await new Promise<string>((r) =>
    read.on("end", () => r(md5.digest("hex")))
  );
  return hash;
}
