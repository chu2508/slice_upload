(function init() {
  const file_btn = document.getElementById("file_btn");
  const temp = document.getElementById("file-upload-tpl").innerHTML;
  const table = document.querySelector("#upload-list");
  file_btn.onchange = onFileChange;
  table.onclick = onUploadBtnClick;
  const readyUploadFiles = {}; // 准备好进行上传的文件

  async function onFileChange(e) {
    const files = e.target.files;
    const file = files[0];
    const fileMetadata = await getFileMetadata(file); // 获取文件元数据
    const task = await getTaskInfo(fileMetadata); // 上传元数据得到task信息
    const chunks = await getFileChunks(file, task.chunkSize); // 将文件切片
    readyUploadFiles[task.hash] = { task, chunks }; // 本地保存任务信息与切片信息
    updateTable();
  }

  async function onUploadBtnClick(e) {
    const target = e.target;
    const isBtn = target.className.indexOf("upload-item-btn") > -1;
    if (isBtn) {
      const hash = target.dataset.hash;
      const uploadInfo = readyUploadFiles[hash];
      await beginUploadChunks(uploadInfo.task, uploadInfo.chunks);
      const res = await concatChunks(uploadInfo.task.hash);
      if (res.error) {
        alert(res.error);
      } else if (res.ok) {
        alert("合并成功");
      }
    }
  }

  async function concatChunks(hash) {
    return fetch("http://127.0.0.1:38080/api/concat_chunk", {
      method: "POST",
      body: JSON.stringify({ hash }),
      headers: { "Content-Type": "application/json" },
    }).then((res) => res.json());
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

  function delay(time) {
    return new Promise((r) => setTimeout(r, time));
  }

  /**
   * 更新列表html
   */
  function updateTable() {
    updateUploadInfoTable(readyUploadFiles);
  }

  /**
   * 替换更新列表 tbody
   * @param {*} upload
   */
  function updateUploadInfoTable(upload) {
    const tbody = document.querySelector("#upload-list tbody");
    let str = "";
    for (const key in upload) {
      if (Object.hasOwnProperty.call(upload, key)) {
        str += temp.replace(/{{(.+)}}/g, (_, propsKey) => {
          if (propsKey === "progress") {
              if (upload[key].task.done) {
                  return '100%'
              }
            const progress =
              (
                (upload[key].task.currentChunk / upload[key].chunks.length) *
                100
              ).toFixed(2) + "%";
            return progress;
          }
          return upload[key].task[propsKey];
        });
      }
    }
    tbody.innerHTML = str;
  }
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
   * 获取文件的元信息
   * @param {File}} file
   */
  async function getFileMetadata(file) {
    const hash = await getFileMd5(file);
    const fileName = file.name;
    const fileType = file.type;
    const fileSize = file.size;
    return { hash, fileName, fileType, fileSize };
  }
  /**
   * 获取文件md5哈希
   * @param {File} file
   * @return {string} 哈希字符串
   */
  function getFileMd5(file) {
    return new Promise((resolve, reject) => {
      var blobSlice =
          File.prototype.slice ||
          File.prototype.mozSlice ||
          File.prototype.webkitSlice,
        chunkSize = 2097152, // Read in chunks of 2MB
        chunks = Math.ceil(file.size / chunkSize),
        currentChunk = 0,
        spark = new SparkMD5.ArrayBuffer(),
        fileReader = new FileReader();

      fileReader.onload = function (e) {
        console.log("read chunk nr", currentChunk + 1, "of", chunks);
        spark.append(e.target.result); // Append array buffer
        currentChunk++;

        if (currentChunk < chunks) {
          loadNext();
        } else {
          console.log("finished loading");
          const hexHash = spark.end();
          console.info("computed hash", hexHash); // Compute hash
          resolve(hexHash);
        }
      };

      fileReader.onerror = function (error) {
        console.warn("oops, something went wrong.");
        reject(error);
      };

      function loadNext() {
        var start = currentChunk * chunkSize,
          end = start + chunkSize >= file.size ? file.size : start + chunkSize;

        fileReader.readAsArrayBuffer(blobSlice.call(file, start, end));
      }

      loadNext();
    });
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
})();
