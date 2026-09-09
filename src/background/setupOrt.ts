import { env } from "@huggingface/transformers";

if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
  const ortPrefix = chrome.runtime.getURL("ort/");

  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.wasmPaths = {
      mjs: `${ortPrefix}ort-wasm-simd-threaded.asyncify.mjs`,
      wasm: `${ortPrefix}ort-wasm-simd-threaded.asyncify.wasm`,
    };
    env.backends.onnx.wasm.numThreads = 1;
    env.backends.onnx.wasm.proxy = false;
  }
}
