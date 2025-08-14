import tailwindcss from "@tailwindcss/vite";

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  nitro: {
    preset: 'cloudflare_module',
    experimental: {
      websocket: true,
      openAPI: true
    },
    cloudflare: {
      deployConfig: true,
      nodeCompat: true
    },
  },

  runtimeConfig: {
    public: {
      websocketsUrl: "ws://localhost:8787",
    },
  },

  modules: ['@vueuse/nuxt', '@nuxt/ui'],

  css: ['~/assets/css/main.css'],
})
