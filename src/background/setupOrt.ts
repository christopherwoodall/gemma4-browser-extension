import { env } from "@huggingface/transformers";

// Disable attempting to cache extension wasm assets in Cache API (which rejects moz-extension:// URLs)
env.useWasmCache = false;

if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
  const ortPrefix = chrome.runtime.getURL("ort/");

  if (env.backends?.onnx?.wasm) {
    // Providing directory string ending with '/' enables ONNX Runtime Web to dynamically resolve
    // the appropriate wasm/mjs binary (jsep for WebGPU, asyncify for CPU/WASM fallback)
    env.backends.onnx.wasm.wasmPaths = ortPrefix;
    env.backends.onnx.wasm.numThreads = 1;
    env.backends.onnx.wasm.proxy = false;
  }
}
