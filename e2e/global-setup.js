const fs = require("node:fs");
const path = require("node:path");
const { backend, be, frontend, api, secret, stateFile } = require("./settings");
module.exports = async function setup() {
  const { MongoMemoryReplSet } = be("mongodb-memory-server-core");
  const mongo = await MongoMemoryReplSet.create({ binary: { version: "7.0.24", downloadDir: path.join(backend, ".cache/mongodb") },
    replSet: { count: 1, ip: "127.0.0.1" } });
  let runtime, web;
  const close = async () => {
    if (web) await new Promise(resolve => web.close(resolve));
    await runtime?.close();
    await mongo.stop();
    fs.rmSync(stateFile, { force: true });
  };
  try {
    const mongoUri = mongo.getUri("clothing_e2e");
    const env = { NODE_ENV: "test", HOST: "127.0.0.1", PORT: "4500", MONGO_URI: mongoUri, JWT_SECRET: secret,
      FRONTEND_URL: frontend, CLOUDINARY_ENABLED: "false", VNPAY_ENABLED: "true", VNP_TMN_CODE: "E2EDEMO",
      VNP_HASH_SECRET: "e2e-provider-signature-only", VNP_URL: "https://gateway.test/pay", VNP_RETURN_URL: api + "/api/vnpay/return",
      VNP_RESULT_URL: frontend + "/payment-result" };
    Object.assign(process.env, env);
    runtime = await be("./server").start({ env, scheduler: false });
    web = require("../app").start({ NODE_ENV: "test", HOST: "127.0.0.1", PORT: "4300", BACKEND_URL: api });
    await new Promise((resolve, reject) => { web.once("listening", resolve); web.once("error", reject); });
    if (!(await fetch(api + "/health/ready")).ok) throw new Error("E2E backend is not ready");
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ mongoUri }), { mode: 0o600 });
    return close;
  } catch (error) { await close(); throw error; }
};
