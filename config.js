module.exports = function configuration(env = process.env) {
  const mode = env.NODE_ENV || "development";
  if (!["development", "test", "production"].includes(mode)) throw new Error("Invalid NODE_ENV");
  let backend;
  try {
    backend = new URL(env.BACKEND_URL);
    if (!["http:", "https:"].includes(backend.protocol) || backend.username || backend.password || backend.pathname !== "/" ||
        backend.search || backend.hash || (mode === "production" && backend.protocol !== "https:")) throw new Error();
  } catch { throw new Error("BACKEND_URL must be an origin; production requires HTTPS"); }
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid PORT");
  return { port, host: env.HOST || "0.0.0.0", public: { apiBase: backend.origin + "/api", socketUrl: backend.origin } };
};
