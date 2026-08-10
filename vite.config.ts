import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    // Generates type files so consumers get IntelliSense in VS Code
    dts({})
  ],
  build: {
    lib: {
      // Defines the entry point of your module
      entry: 'src/index.ts',
      name: 'JsPredict',
      formats: ['es'],
      fileName: 'jspredict',
    },
    // Ensures your bundle doesn't include code you expect users to provide
    rollupOptions: {
      external: ['satellite.js'],
    },
  },
});