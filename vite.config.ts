import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { resolve } from "path";
import { defineConfig } from "vite";

const targetBrowser = process.env.TARGET_BROWSER || "chrome";
const outDir = `dist/${targetBrowser}`;

function copyOrtAssets(outputDir: string) {
  try {
    const directPath = resolve(__dirname, "node_modules/onnxruntime-web/dist");
    let ortDist = existsSync(directPath) ? directPath : null;

    if (!ortDist) {
      const pnpmDir = resolve(__dirname, "node_modules/.pnpm");
      if (existsSync(pnpmDir)) {
        for (const entry of readdirSync(pnpmDir)) {
          if (
            entry.startsWith("@huggingface+transformers@") ||
            entry.startsWith("onnxruntime-web@")
          ) {
            const candidate = resolve(
              pnpmDir,
              entry,
              "node_modules/onnxruntime-web/dist"
            );
            if (existsSync(candidate)) {
              ortDist = candidate;
              break;
            }
          }
        }
      }
    }

    if (ortDist) {
      const targetDir = resolve(__dirname, `${outputDir}/ort`);
      if (!existsSync(targetDir)) {
        mkdirSync(targetDir, { recursive: true });
      }
      const filesToCopy = [
        "ort-wasm-simd-threaded.asyncify.mjs",
        "ort-wasm-simd-threaded.asyncify.wasm",
        "ort-wasm-simd-threaded.mjs",
        "ort-wasm-simd-threaded.wasm",
        "ort-wasm-simd-threaded.jsep.mjs",
        "ort-wasm-simd-threaded.jsep.wasm",
      ];
      for (const file of filesToCopy) {
        const src = resolve(ortDist, file);
        if (existsSync(src)) {
          copyFileSync(src, resolve(targetDir, file));
        }
      }
      console.log(`Copied ONNX Runtime WASM assets to ${targetDir}`);
    } else {
      console.warn(
        "Could not find onnxruntime-web/dist directory to copy WASM assets."
      );
    }
  } catch (err) {
    console.error("Failed to copy ORT assets:", err);
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "inline-content-script",
      closeBundle() {
        try {
          // Inline the types import in content.js
          const contentPath = resolve(__dirname, `${outDir}/content.js`);
          let content = readFileSync(contentPath, "utf-8");

          // Find the import statement and extract the imported variable name
          const importMatch = content.match(
            /import\{([A-Z])\s+as\s+([a-z])\}from"([^"]+)";/
          );
          if (importMatch) {
            const importedName = importMatch[1]; // e.g., "C"
            const localName = importMatch[2]; // e.g., "a"
            const importPath = importMatch[3];
            const fullImportPath = resolve(__dirname, outDir, importPath);

            // Read the imported file
            const importedContent = readFileSync(fullImportPath, "utf-8");

            // Find which variable is exported as importedName
            // Format: export{S as B,T as C,A as R,G as a};
            const exportPattern = new RegExp(
              `([A-Z])\\s+as\\s+${importedName}[,}]`
            );
            const exportMatch = importedContent.match(exportPattern);

            if (exportMatch) {
              const actualVarName = exportMatch[1]; // e.g., "T"

              // Inline the content and replace the actual variable name with local name
              let inlinedContent = importedContent.replace(
                /export\{[^}]+\};?/,
                ""
              );
              // Replace both "var T=" and ",T=" patterns
              inlinedContent = inlinedContent.replace(
                new RegExp(`([,\\s])${actualVarName}=`, "g"),
                `$1${localName}=`
              );
              // Also replace references like (T||{})
              inlinedContent = inlinedContent.replace(
                new RegExp(`\\(${actualVarName}\\|\\|`, "g"),
                `(${localName}||`
              );

              // Replace the import with the inlined content
              content = content.replace(importMatch[0], inlinedContent);

              writeFileSync(contentPath, content);
              console.log("Inlined imports in content.js");
            }
          }
        } catch (e) {
          console.error("Failed to inline content script:", e);
        }
      },
    },
    {
      name: "post-build",
      closeBundle() {
        try {
          const source = resolve(__dirname, `${outDir}/src/sidebar/index.html`);
          const dest = resolve(__dirname, `${outDir}/sidebar.html`);
          const srcDir = resolve(__dirname, `${outDir}/src`);
          let html = readFileSync(source, "utf-8");

          html = html.replace(/src="\/assets\//g, 'src="./assets/');
          html = html.replace(/href="\/assets\//g, 'href="./assets/');

          writeFileSync(dest, html);
          rmSync(srcDir, { recursive: true, force: true });

          console.log(
            "Moved sidebar.html to dist root and cleaned up src directory"
          );

          // Copy local ONNX Runtime assets
          copyOrtAssets(outDir);

          // Clean up duplicate hashed wasm file in assets if present
          const assetsDir = resolve(__dirname, `${outDir}/assets`);
          if (existsSync(assetsDir)) {
            for (const f of readdirSync(assetsDir)) {
              if (f.startsWith("ort-wasm-simd-threaded.asyncify-") && f.endsWith(".wasm")) {
                rmSync(resolve(assetsDir, f), { force: true });
                console.log(`Cleaned up duplicate hashed wasm asset: ${f}`);
              }
            }
          }
        } catch (e) {
          console.error("Failed in post-build step:", e);
        }
      },
    },
    {
      name: "generate-manifest",
      closeBundle() {
        try {
          const manifestPath = resolve(__dirname, "public/manifest.json");
          const baseManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
          const manifest = { ...baseManifest };

          // Always ensure ort/* is web accessible
          manifest.web_accessible_resources = [
            {
              resources: ["ort/*"],
              matches: ["<all_urls>"],
            },
          ];

          if (targetBrowser === "firefox") {
            delete manifest.side_panel;
            manifest.permissions = (manifest.permissions || []).filter(
              (p: string) => p !== "sidePanel"
            );
            manifest.sidebar_action = {
              default_panel: "sidebar.html",
              default_title: "Gemma 4 Assistant",
              default_icon: {
                "16": "icons/icon-16.png",
                "32": "icons/icon-32.png",
                "48": "icons/icon-48.png",
                "128": "icons/icon-128.png",
              },
            };
            manifest.background = {
              scripts: ["background.js"],
              type: "module",
            };
            manifest.browser_specific_settings = {
              gecko: {
                id: "gemma4-assistant@example.com",
                strict_min_version: "115.0",
              },
            };
          } else {
            manifest.background = {
              service_worker: "background.js",
              type: "module",
            };
          }

          const destPath = resolve(__dirname, `${outDir}/manifest.json`);
          writeFileSync(destPath, JSON.stringify(manifest, null, 2));
          console.log(`Generated manifest.json for target: ${targetBrowser}`);
        } catch (e) {
          console.error("Failed to generate target manifest:", e);
        }
      },
    },
  ],
  publicDir: "public",
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidebar: resolve(__dirname, "src/sidebar/index.html"),
        background: resolve(__dirname, "src/background/background.ts"),
        content: resolve(__dirname, "src/content/content.ts"),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === "background" || chunkInfo.name === "content") {
            return "[name].js";
          }
          return "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
        // Prevent code splitting for content script
        manualChunks: (id) => {
          // If the module is imported by content script, inline it
          if (id.includes("src/content") || id.includes("src/shared")) {
            return undefined;
          }
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ["@huggingface/transformers"],
  },
});
