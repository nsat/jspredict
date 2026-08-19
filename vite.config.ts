import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import dts from 'vite-plugin-dts';
import { viteSingleFile } from 'vite-plugin-singlefile';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {

  // 1. CONFIG FOR BUILDING THE DEMO APP (Static Website)
  if (mode === 'demo') {
    return {
      // React + Tailwind for the shadcn/ui components. viteSingleFile inlines
      // all JS/CSS into a single index.html so the demo can be opened directly
      // from disk (file://) without a server.
      plugins: [react(), tailwindcss(), viteSingleFile()],
      base: './',
      resolve: {
        alias: {
          // shadcn/ui components import from "@/..."; map it to src/demo.
          '@': fileURLToPath(new URL('./src/demo', import.meta.url)),
          // satellite.js ships a multi-threaded (pthreads) WASM runtime that
          // relies on top-level await inside a worker. Rolldown cannot bundle
          // that worker for the browser build, and the demo only needs the
          // single-threaded runtime, so redirect the multi-thread import to the
          // single-thread build.
          '#wasm-multi-thread': fileURLToPath(
            new URL(
              './node_modules/satellite.js/wasm-build/base-release/index.js',
              import.meta.url,
            ),
          ),
        },
      },
      build: {
        outDir: 'dist-demo', // Saves the demo website here
      },
    };
  }
  
  return {
    plugins: [
      // Generates type files so consumers get IntelliSense in VS Code.
      // bundleTypes rolls every declaration into a single dist/jspredict.d.ts
      // via @microsoft/api-extractor. include is scoped to the library entry
      // so the demo app's declarations are not emitted.
      dts({
        bundleTypes: true,
        include: ['src/lib/**'],
        exclude: [
          'src/lib/__tests__/**'
        ]
      })
    ],
    build: {
      lib: {
        // Defines the entry point of your module
        entry: 'src/lib/main.ts',
        name: 'JsPredict',
        formats: ['es'],
        fileName: 'jspredict',
      },
      // Ensures your bundle doesn't include code you expect users to provide
      rollupOptions: {
        external: ['satellite.js'],
      }
    }
  }
});