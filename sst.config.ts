/// <reference path="./.sst/platform/config.d.ts" />
const prodDomain = "e.g., app.example.com (domain must be registered on Cloudflare)";
const devDomain = "e.g., dev.example.codes (stages like 'dev' will deploy to 'dev.dev.example.codes')";

export default $config({
  app(input) {
    return {
      name: "websocket-test",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "cloudflare",
      providers: {
        cloudflare: true,
        command: "1.0.1",
        random: "4.17.0",
      },
    };
  },
  async run() {
    const { Nuxt } = await import("./nuxflare/nuxt");
    const { Worker } = await import("./nuxflare/worker");

    const domain =
      $app.stage === "production"
        ? prodDomain || undefined
        : devDomain
        ? `${$app.stage}.${devDomain}`
        : undefined;
    // Create WebSockets worker
    const { websocketsUrl } = await Worker({
      name: "WebSockets",
      dir: "./websockets",
      main: "index.ts",
      durableObjects: [{ className: "WebSockets", bindingName: "WEBSOCKETS" }],
    });
    // Create Nuxt app and pass the WebSockets URL
    Nuxt("App", {
      dir: ".",
      domain,
      outputDir: ".output",
      extraVars: {
        NUXT_PUBLIC_WEBSOCKETS_URL: websocketsUrl,
      },
    });
  },
});
