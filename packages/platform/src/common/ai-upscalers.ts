import fs from "node:fs/promises";
import type { AiUpscalingCapabilities } from "@discstream/contracts";
import { runCommand } from "./process.js";

const REAL_ESRGAN_EXECUTABLE = "realesrgan-ncnn-vulkan";

export async function detectAiUpscaling(projectExecutable?: string, cudaRoot?: string): Promise<AiUpscalingCapabilities> {
  const cudaPython = cudaRoot ? `${cudaRoot}/venv/bin/python` : undefined;
  const cudaRunner = cudaRoot ? `${cudaRoot}/Real-ESRGAN/inference_realesrgan.py` : undefined;
  if (cudaPython && cudaRunner && (await isExecutable(cudaPython)) && (await fileExists(cudaRunner))) {
    const cuda = await runCommand(cudaPython, ["-c", "import torch; print(torch.cuda.is_available())"], { timeoutMs: 5000 });
    if (cuda.code === 0 && cuda.stdout.trim() === "True") {
      return {
        available: true,
        backend: "realesrgan-pytorch-cuda",
        gpuAccelerated: true,
        executable: cudaRunner,
        pythonExecutable: cudaPython,
        fallbackExecutable: projectExecutable && (await isExecutable(projectExecutable)) ? projectExecutable : undefined
      };
    }
  }
  const configuredExecutable = process.env.DISCSTREAM_REALESRGAN_PATH?.trim();
  const localExecutable = configuredExecutable || projectExecutable;

  if (localExecutable && (await isExecutable(localExecutable))) {
    return readyCapabilities(localExecutable);
  }

  const result = await runCommand("which", [REAL_ESRGAN_EXECUTABLE], { timeoutMs: 1200 });
  const executable = result.code === 0 ? result.stdout.trim() : "";

  if (!executable) {
    return {
      available: false,
      gpuAccelerated: false
    };
  }

  return readyCapabilities(executable);
}

function readyCapabilities(executable: string): AiUpscalingCapabilities {
  return {
    available: true,
    backend: "realesrgan-ncnn-vulkan",
    gpuAccelerated: true,
    executable
  };
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
