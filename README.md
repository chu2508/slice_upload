---
# 主题列表：juejin, github, smartblue, cyanosis, channing-cyan, fancy, hydrogen, condensed-night-purple, greenwillow, v-green, vue-pro, healer-readable, mk-cute, jzman, geek-black, awesome-green, qklhk-chocolate
# 贡献主题：https://github.com/xitu/juejin-markdown-themes
theme: juejin
highlight:
---

# 如何实现一个切片上传服务

最近项目中遇到的一个需求，要求上传文件时如果碰上断网或是其他情况导致上传失败，那么下次开始上传同一份文件，可以从断点开始需传。百度了一下，发现要实现这个功能，需要后端的配合，所以自己就用 koa 实现一个简单的切片上传服务，用来给开发前端时调试用。现在把实现过程记录下来，以作备忘。

## 思路

要实现断点续传在于以下几点：

1. 获取文件的唯一标识
2. 获取文件的长度
3. 记录已经上传的长度
4. 记录这些数据
5. 将文件切片并上传
6. 将切片文件合并
7. 文件的完整性校验

这些需要后端与前端共同配合完成。

## 实现

根据上述要点我们来看一下如何实现一个切片上传的接口。

### 记录文件元数据

我们需要先提供一个接口供前端调用，将文件的元数据上传，根据元数据生成一个上传任务，后续如果异常断开了任务，我们也能根据元数据获取到当前任务的进度。元数据包括文件名，文件唯一标识、文件长度、切片的大小。其中文件唯一标识是通过哈希算法计算得出，这边我们选择的是哈希算法是[md5](https://baike.baidu.com/item/MD5/212708?fr=aladdin),这是一个很常用的哈希加密算法，特点是快速和稳定。

#### 前端代码

```js
/**
 * input file onChange 回调函数
 */
async function onFileChange(e) {
  const files = e.target.files;
  const file = files[0];
  const fileMetadata = await getFileMetadata(file); // 获取文件元数据
  const task = await getTaskInfo(fileMetadata); // 上传元数据得到task信息
  const chunks = await getFileChunks(file, task.chunkSize); // 将文件切片
  readyUploadFiles[task.hash] = { task, chunks }; // 本地保存任务信息与切片信息
  updateTable();
}

/**
 * 获取文件的元信息
 * @param {File}} file
 */
async function getFileMetadata(file) {
  const hash = await getFileMd5(file); // 获取文件hash; 使用的是 spark-md5库
  const fileName = file.name;
  const fileType = file.type;
  const fileSize = file.size;
  return { hash, fileName, fileType, fileSize };
}

/**
 * 获取上传任务信息
 * @param {{hash: string, fileName: string, fileType: string,  fileSize: number}} metadata
 */
async function getTaskInfo(metadata) {
  return fetch("http://127.0.0.1:38080/api/task", {
    method: "POST",
    body: JSON.stringify(metadata),
    headers: { "Content-Type": "application/json" },
  }).then((res) => res.json());
}
```

#### 后端接口代码

```ts
import Koa from "koa";
import KoaRouter from "@koa/router";
const router = new KoaRouter({ prefix: "/api" });
const upload_map = {};
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

const app = new Koa();
app.use(router.routes());
```

### 文件切片上传

获取到上传任务之后，就可以根据任务里的 chunkSize 将文件切片,然后上传了。

#### 前端代码

通过递归调用函数，将 chunk 依次上传。

```js
/**
 * 根据chunkSize将文件切片
 * @param {File} file
 * @param {number} chunkSize
 */
async function getFileChunks(file, chunkSize) {
  const result = [];
  const chunks = Math.ceil(file.size / chunkSize);

  for (let index = 0; index < chunks; index++) {
    const start = index * chunkSize,
      end = start + chunkSize >= file.size ? file.size : start + chunkSize;
    result.push(file.slice(start, end));
  }
  return result;
}

/**
 * 开始上传切片
 * @param {*} task
 * @param {*} chunks
 */
async function beginUploadChunks(task, chunks) {
  if (task.done) {
    return;
  }
  const start = task.currentChunk * task.chunkSize;
  const end =
    start + task.chunkSize >= task.fileSize
      ? task.fileSize
      : start + task.chunkSize;
  try {
    const nextTask = await uploadChunks(
      task.hash,
      chunks[task.currentChunk],
      start,
      end
    );
    readyUploadFiles[task.hash].task = nextTask;
    updateTable();
    await beginUploadChunks(nextTask, chunks);
  } catch (error) {
    console.error(error);
  }
}
/**
 * 上传chunk数据
 * @param {string} hash
 * @param {Blob} chunk
 * @param {number} start
 * @param {number} end
 */
async function uploadChunks(hash, chunk, start, end) {
  const data = new FormData();
  data.append("hash", hash);
  data.append("chunk", chunk);
  data.append("start", start);
  data.append("end", end);
  const res = await fetch("http://127.0.0.1:38080/api/upload_chunk", {
    method: "POST",
    body: data,
  }).then((res) => res.json());
  if (res.error) {
    throw new Error(res.error);
  } else {
    return res;
  }
}
```

#### 后端代码

后端使用了 koa-body 库来解析 multipart/form-data 格式的数据

```ts
import KoaBody from "koa-body";
app.use(KoaBody({ multipart: true }));
// 接收上传的chunk
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
    // 删除koa-body，帮我们保存的临时文件
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
```

### 文件合并与校验

切片全部上传之后就可以合并切片并校验文件的完整性了

#### 前端代码

```js
async function concatChunks(hash) {
  return fetch("http://127.0.0.1:38080/api/concat_chunk", {
    method: "POST",
    body: JSON.stringify({ hash }),
    headers: { "Content-Type": "application/json" },
  }).then((res) => res.json());
}
```

#### 后端代码

在最后的合并步骤，我们要通过各项数据校验的文件的完整性

```ts
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

  // 先校验 chunk数量是否一致
  const chunkDir = getTempDirByHash(hash);
  const chunkCount = Math.ceil(task.fileSize / task.chunkSize);
  const chunkPaths = await fs.promises.readdir(chunkDir);
  if (chunkCount !== chunkPaths.length) {
    ctx.body = { error: "文件切片校验不一致" };
    ctx.status = 400;
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
  // 合并文件
  await concatChunks(filePath, chunkFullPaths);
  const stat = await fs.promises.stat(filePath);
  // 校验文件的大小
  if (stat.size !== task.fileSize) {
    ctx.body = { error: "文件大小校验不一致" };
    ctx.status = 400;
    return;
  }

  // 最后校验hash
  const fileHash = await getFileMd5(filePath);
  if (fileHash !== task.hash) {
    ctx.body = { error: "文件哈希校验不一致" };
    ctx.status = 400;
    return;
  }

  // 文件上传成功将任务与临时文件夹删除
  upload_map[task.hash] = undefined;

  ctx.body = { ok: true };
});
```

## 总结

首先获取文件的元信息，通过将元信息保存在服务器上，记录下上传任务的状态，我们实现了文件的断点续传功能。
