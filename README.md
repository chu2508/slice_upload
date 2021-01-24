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

这些需要服务端与前端共同配合完成。

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
const upload_map = {}
router.post("/task", (ctx) => {
  const metadata = ctx.request.body;
  // 建立临时文件夹存放chunks文件，方便后续合并数据
  makeTempDirByFileHash(metadata.hash);
  let task = upload_map[metadata.hash];
  if (!task) {
    // 将任务信息保存起来，后续断点续传就需要用到这个信息
      task = { chunkSize: 500, currentChunk: 0, done: false ,...metadata };
      upload_map[metadata.hash] = task;
  }
  ctx.body = task;
});

const app = new Koa();
app.use(router.routes());

```
