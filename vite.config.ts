import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks: {
          tfjs: ["@tensorflow/tfjs", "@tensorflow/tfjs-backend-webgl"],
          posedet: ["@tensorflow-models/pose-detection"],
        },
      },
    },
  },
  server: {
    host: true,
  },
});
