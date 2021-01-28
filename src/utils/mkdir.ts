import path from "path";
import fs from "fs";

export function mkdir(dirPath: string) {
  if (!fs.existsSync(path.dirname(dirPath))) {
    mkdir(path.dirname(dirPath));
  }
  fs.mkdirSync(dirPath);
}
