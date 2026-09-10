/**
 * Helper utilities for hardware device detection and ONNX error formatting.
 */

let webGpuAvailableCache: boolean | null = null;

/**
 * Checks if WebGPU is fully supported in the current environment by attempting
 * to request a GPU adapter. Caches result to avoid redundant adapter requests.
 */
export async function isWebGpuSupported(): Promise<boolean> {
  if (webGpuAvailableCache !== null) {
    return webGpuAvailableCache;
  }

  const nav = navigator as any;
  if (
    typeof navigator === "undefined" ||
    !("gpu" in navigator) ||
    !nav.gpu
  ) {
    webGpuAvailableCache = false;
    return false;
  }

  try {
    const adapter = await nav.gpu.requestAdapter({
      powerPreference: "high-performance",
    });
    webGpuAvailableCache = adapter !== null;
    return webGpuAvailableCache;
  } catch (err) {
    console.warn("[deviceHelper] WebGPU adapter request failed:", err);
    webGpuAvailableCache = false;
    return false;
  }
}

/**
 * Formats caught errors from ONNX Runtime Web.
 * Emscripten C++ exceptions are thrown across WASM boundaries as numeric pointers (e.g. 9547160).
 */
export function formatOrtError(err: unknown, context: string = ""): Error {
  if (err instanceof Error) {
    return err;
  }

  const prefix = context ? `[${context}] ` : "";
  if (typeof err === "number") {
    return new Error(
      `${prefix}ONNX Runtime WebAssembly internal exception (pointer: ${err}). ` +
        `This typically occurs when WebGPU initialization fails or the hardware adapter is incompatible.`
    );
  }

  return new Error(`${prefix}${String(err)}`);
}
