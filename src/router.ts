import KoaRouter from "@koa/router";
import path from "path";
import fs from "fs";
import { md5 } from "./utils/md5";
import { mkdir } from "./utils/mkdir";
import { SliceService } from "./SliceService";

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
export const router = new KoaRouter({ prefix: "/api" });
const sliceService = new SliceService(path.resolve(__dirname, "../upload"));
const upload_map: { [key: string]: UploadTask | undefined } = {};
router.post("/task", (ctx) => {
  const metadata = ctx.request.body;
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
  let chunkPath;
  if (chunk instanceof Array) {
    chunkPath = chunk[0].path;
  } else {
    chunkPath = chunk.path;
  }

  const task = upload_map[hash];
  if (task && !task.done) {
    // 等待写入完成
    await sliceService.write(task.hash, chunkPath, start, end);
    // 删除@koa/body库，帮我们保存的临时文件
    await fs.promises.unlink(chunkPath);
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
  const filePath = path.resolve(path.join(__dirname, "../upload", `/file/${task.fileName}`));
  await concatChunks(filePath, chunkFullPaths);
  const stat = await fs.promises.stat(filePath);
  if (stat.size !== task.fileSize) {
    ctx.body = { error: "文件长度校验不一致" };
    ctx.status = 500;
    return;
  }

  const fileHash = await md5(filePath);
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
function getTempDirByHash(hash: string) {
  return path.resolve(path.join(__dirname, "../upload", `/chunk_temp/${hash}`));
}
