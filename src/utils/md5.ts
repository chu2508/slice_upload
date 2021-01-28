import fs from "fs";
import crypto from "crypto";

export async function md5(path: string) {
  const md5 = crypto.createHash("md5");
  const read = fs.createReadStream(path);
  read.on("data", (data) => md5.update(data));
  const hash = await new Promise<string>((r) => read.on("end", () => r(md5.digest("hex"))));
  return hash;
}
