import { FeatureExtractionPipeline, pipeline } from "@huggingface/transformers";

import { FEATURE_EXTRACTION_ID, MODELS } from "../../shared/constants.ts";
import { formatOrtError, isWebGpuSupported } from "./deviceHelper.ts";

const model = MODELS[FEATURE_EXTRACTION_ID];

class FeatureExtractor {
  private pipeline: FeatureExtractionPipeline = null;

  public getFeatureExtractionPipeline = async (
    onDownloadProgress: (id: string, percentage: number) => void = () => {}
  ): Promise<FeatureExtractionPipeline> => {
    if (this.pipeline) return this.pipeline;

    const hasWebGpu = await isWebGpuSupported();
    const preferredDevice = hasWebGpu ? "webgpu" : "wasm";

    try {
      console.log(
        `[FeatureExtractor] Initializing feature extraction pipeline with device: ${preferredDevice}`
      );
      const pipe = await pipeline("feature-extraction", model.modelId, {
        dtype: model.dtype,
        device: preferredDevice,
        progress_callback: (i) => {
          if (i.status === "progress_total") {
            onDownloadProgress(model.modelId, i.progress);
          }
        },
      });
      this.pipeline = pipe as FeatureExtractionPipeline;
      return this.pipeline;
    } catch (primaryError) {
      if (preferredDevice === "webgpu") {
        console.warn(
          "[FeatureExtractor] Failed to initialize on WebGPU, falling back to wasm (fp32):",
          formatOrtError(primaryError)
        );
        try {
          const pipe = await pipeline("feature-extraction", model.modelId, {
            dtype: "fp32",
            device: "wasm",
            progress_callback: (i) => {
              if (i.status === "progress_total") {
                onDownloadProgress(model.modelId, i.progress);
              }
            },
          });
          this.pipeline = pipe as FeatureExtractionPipeline;
          return this.pipeline;
        } catch (fallbackError) {
          const formatted = formatOrtError(fallbackError, "FeatureExtractor:wasm-fallback");
          console.error("Failed to initialize feature extraction pipeline (wasm fallback):", formatted);
          throw formatted;
        }
      }

      const formatted = formatOrtError(primaryError, "FeatureExtractor");
      console.error("Failed to initialize feature extraction pipeline:", formatted);
      throw formatted;
    }
  };

  public extractFeatures = async (
    input: Array<string>
  ): Promise<Array<Array<number>>> => {
    const pipe = await this.getFeatureExtractionPipeline();
    const result = await pipe(input, { normalize: true, pooling: "mean" });
    return result.tolist();
  };
}

export default FeatureExtractor;
