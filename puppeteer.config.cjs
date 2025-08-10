/** Container-safe Puppeteer config (used by your code or mermaid-cli via --puppeteerConfigFile) */
module.exports = {
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium-browser",
  headless: "new",
  args: (process.env.PUPPETEER_ARGS || "")
    .split(" ")
    .filter(Boolean),
  defaultViewport: { width: 1280, height: 800 },
};
