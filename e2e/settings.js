const path = require("node:path");
const { createRequire } = require("node:module");
const backend = path.resolve(process.env.BACKEND_PATH || path.join(__dirname, "../../ClothingShopProject"));
const be = createRequire(path.join(backend, "package.json"));
module.exports = { backend, be, frontend: "http://127.0.0.1:4300", api: "http://127.0.0.1:4500",
  secret: "browser-e2e-only-secret-not-a-production-credential", password: "LocalDemo123!",
  stateFile: path.join(__dirname, "../.cache/e2e.json") };
