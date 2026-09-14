import path from "path";
import fs from "fs";

const BASE_DIR = process.cwd();

// Default base URL (matches old app.py)
const DEFAULT_BASE_URL = "https://ai.lightwheel.net:8086";
const DEFAULT_MODEL = "gpt-image-2";

export interface ModelCapability {
  supported_sizes: Array<{ size: string; ratio: string }>;
  supports_quality: boolean;
  quality_options: string[];
  supports_negative_prompt: boolean;
  max_reference_images: number;
}

export interface Capabilities {
  [model: string]: ModelCapability;
}

function defaultCapabilities(): Capabilities {
  return {
    [DEFAULT_MODEL]: {
      supported_sizes: [
        { size: "1024x1024", ratio: "1:1" },
        { size: "2048x2048", ratio: "1:1" },
        { size: "1024x1536", ratio: "2:3" },
        { size: "1536x1024", ratio: "3:2" },
        { size: "1024x1792", ratio: "9:16" },
        { size: "1792x1024", ratio: "16:9" },
      ],
      supports_quality: false,
      quality_options: [],
      supports_negative_prompt: false,
      max_reference_images: 16,
    },
  };
}

let _capabilitiesCache: Capabilities | null = null;

export function loadCapabilities(): Capabilities {
  if (_capabilitiesCache) return _capabilitiesCache;

  const defaults = defaultCapabilities();
  const filePath = path.join(BASE_DIR, "model_capabilities.json");

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const overrides = JSON.parse(raw) as Record<string, Partial<ModelCapability>>;

    // Merge: overrides take precedence, defaults fill gaps
    for (const [model, caps] of Object.entries(overrides)) {
      if (defaults[model]) {
        defaults[model] = { ...defaults[model], ...caps };
      } else {
        defaults[model] = {
          supported_sizes: caps.supported_sizes || [],
          supports_quality: caps.supports_quality ?? false,
          quality_options: caps.quality_options || [],
          supports_negative_prompt: caps.supports_negative_prompt ?? false,
          max_reference_images:
            caps.max_reference_images ?? 16,
        };
      }
    }
  } catch {
    // File not found or invalid — use defaults
  }

  _capabilitiesCache = defaults;
  return defaults;
}

export function getModelCapabilities(
  capabilities: Capabilities,
  model: string
): ModelCapability {
  return (
    capabilities[model] ||
    capabilities[DEFAULT_MODEL] || {
      supported_sizes: [],
      supports_quality: false,
      quality_options: [],
      supports_negative_prompt: false,
      max_reference_images: 16,
    }
  );
}

export function supportedSizes(caps: ModelCapability): string[] {
  return caps.supported_sizes.map((s) => s.size);
}

export function getConfig() {
  return {
    baseUrl: process.env.LIGHTWHEEL_BASE_URL || DEFAULT_BASE_URL,
    model: DEFAULT_MODEL,
    tlsVerify: process.env.LIGHTWHEEL_TLS_VERIFY !== "false",
    generationTimeout: parseInt(
      process.env.GENERATION_TIMEOUT || "300",
      10
    ),
    outputsDir: process.env.OUTPUTS_DIR || "public/outputs",
    capabilities: loadCapabilities(),
  };
}