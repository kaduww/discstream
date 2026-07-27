import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { detectAiUpscaling } from "./ai-upscalers.js";
import * as processModule from "./process.js";

describe("AI upscaler detection", () => {
  afterEach(() => {
    delete process.env.DISCSTREAM_REALESRGAN_PATH;
    vi.restoreAllMocks();
  });

  it("prefers the executable installed inside the project", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "discstream-ai-"));
    const executable = path.join(directory, "realesrgan-ncnn-vulkan");
    await writeFile(executable, "#!/bin/sh\nexit 0\n");
    await chmod(executable, 0o755);
    const commandSpy = vi.spyOn(processModule, "runCommand");

    await expect(detectAiUpscaling(executable)).resolves.toMatchObject({
      available: true,
      executable
    });
    expect(commandSpy).not.toHaveBeenCalled();
  });

  it("prefers the project-local CUDA backend when PyTorch confirms CUDA", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "discstream-cuda-"));
    const python = path.join(directory, "venv", "bin", "python");
    const runner = path.join(directory, "Real-ESRGAN", "inference_realesrgan.py");
    await writeFileWithParents(python, "#!/bin/sh\nexit 0\n", 0o755);
    await writeFileWithParents(runner, "# runner\n", 0o644);
    vi.spyOn(processModule, "runCommand").mockResolvedValueOnce({ code: 0, stdout: "True\n", stderr: "" });

    await expect(detectAiUpscaling(undefined, directory)).resolves.toMatchObject({
      available: true,
      backend: "realesrgan-pytorch-cuda",
      pythonExecutable: python,
      executable: runner
    });
  });

  it("reports Real-ESRGAN NCNN as a GPU backend when installed", async () => {
    vi.spyOn(processModule, "runCommand").mockResolvedValueOnce({
      code: 0,
      stdout: "/opt/homebrew/bin/realesrgan-ncnn-vulkan\n",
      stderr: ""
    });

    await expect(detectAiUpscaling()).resolves.toEqual({
      available: true,
      backend: "realesrgan-ncnn-vulkan",
      gpuAccelerated: true,
      executable: "/opt/homebrew/bin/realesrgan-ncnn-vulkan"
    });
  });

  it("keeps AI restoration optional when no backend is installed", async () => {
    vi.spyOn(processModule, "runCommand").mockResolvedValueOnce({
      code: 1,
      stdout: "",
      stderr: ""
    });

    await expect(detectAiUpscaling()).resolves.toEqual({
      available: false,
      gpuAccelerated: false
    });
  });
});

async function writeFileWithParents(filePath: string, contents: string, mode: number): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
  await chmod(filePath, mode);
}
