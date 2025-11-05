import path from "node:path";
import { __dirname_esm, create } from "swagger2apis";
// 通常情况下,你的json应该通过网络请求去获取,这里为了方便,所以直接使用静态文件
import swaggerJSON from "./json/swagger_2.json";

const app = create(
  // 注意这里是一个对象,不是字符串
  swaggerJSON,
  {
    outdir: path.join(
      __dirname_esm(import.meta.url),
      // 这里实际上可以理解为命令空间
      "./BASE"
    ),
    // 敏感信息开关
    safe: false
  }
);
// 传入适配器导入地址,开始生成文件
app.start("../request.ts");
