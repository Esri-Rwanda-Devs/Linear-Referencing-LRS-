import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const remote = "https://gh.space.gov.rw";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: "127.0.0.1",
    proxy: {
      "/portal": { target: remote, changeOrigin: true, secure: true },
      "/server": { target: remote, changeOrigin: true, secure: true },
    },
  },
});
