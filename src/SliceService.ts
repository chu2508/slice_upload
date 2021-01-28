import path from "path";
import fs from "fs";
import { mkdir } from "./utils/mkdir";
import { md5 } from "./utils/md5";
export interface SliceServiceOptions {
  tempDir?: string;
}

const defaultOptions = {
  tempDir: path.resolve(path.join(__dirname, "../tempDir")),
};

export class SliceService {
  private _options: Required<SliceServiceOptions>;
  private _outputDir: string;
  constructor(outputDir: string, options?: SliceServiceOptions) {
    this._options = { ...defaultOptions, ...options };
    this._outputDir = outputDir;

    mkdir(this._outputDir);
  }

  async write(fileHash: string, chunkPath: string, start: number, end: number) {
    this._makeTempDirByHash(fileHash);
    const chunkHash = await md5(chunkPath);
    const recvPath = `${this._getTempDirByHash(fileHash)}/${start}-${end}-${chunkHash}`;

    await this._pipeWrite(chunkPath, recvPath);
  }

  private _makeTempDirByHash(hash: string) {
    const dirPath = this._getTempDirByHash(hash);
    mkdir(dirPath);
  }

  private _getTempDirByHash(hash: string) {
    return path.join(this._options.tempDir, hash);
  }

  private _pipeWrite(originPath: string, recvPath: string) {
    const read = fs.createReadStream(originPath);
    const write = fs.createWriteStream(recvPath);

    read.pipe(write);
    return new Promise((resolve, reject) => write.on("end", resolve));
  }
}
