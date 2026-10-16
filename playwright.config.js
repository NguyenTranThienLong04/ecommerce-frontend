const { defineConfig, devices } = require("@playwright/test");
module.exports = defineConfig({
  testDir: "./e2e", testMatch: "**/*.spec.js", fullyParallel: false, workers: 1,
  timeout: 45000, expect: { timeout: 10000 }, forbidOnly: !!process.env.CI, retries: 0,
  globalSetup: require.resolve("./e2e/global-setup"),
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://127.0.0.1:4300", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});
