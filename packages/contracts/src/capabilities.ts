import { z } from "zod";

export const supportedPlatformSchema = z.enum(["linux", "darwin"]);
export type SupportedPlatform = z.infer<typeof supportedPlatformSchema>;

export const commandCapabilitiesSchema = z.object({
  ffmpeg: z.boolean(),
  ffprobe: z.boolean(),
  cdparanoia: z.boolean(),
  cdInfo: z.boolean(),
  discid: z.boolean(),
  dvdbackup: z.boolean(),
  lsdvd: z.boolean(),
  eject: z.boolean(),
  lsblk: z.boolean(),
  udevadm: z.boolean(),
  udisksctl: z.boolean(),
  diskutil: z.boolean(),
  drutil: z.boolean(),
  ioreg: z.boolean()
});

export type CommandCapabilities = z.infer<typeof commandCapabilitiesSchema>;

export const aiUpscalingCapabilitiesSchema = z.object({
  available: z.boolean(),
  backend: z.enum(["realesrgan-ncnn-vulkan", "realesrgan-pytorch-cuda"]).optional(),
  gpuAccelerated: z.boolean(),
  executable: z.string().optional(),
  pythonExecutable: z.string().optional(),
  fallbackExecutable: z.string().optional()
});

export type AiUpscalingCapabilities = z.infer<typeof aiUpscalingCapabilitiesSchema>;

export const platformCapabilitiesSchema = z.object({
  platform: supportedPlatformSchema,
  platformVersion: z.string().optional(),
  architecture: z.string(),
  isRaspberryPi: z.boolean().optional(),
  commands: commandCapabilitiesSchema,
  videoEncoders: z.object({
    libx264: z.boolean(),
    h264VideoToolbox: z.boolean(),
    h264V4l2m2m: z.boolean(),
    h264Nvenc: z.boolean().optional()
  }),
  audioEncoders: z.object({
    aac: z.boolean(),
    libmp3lame: z.boolean(),
    flac: z.boolean()
  }),
  aiUpscaling: aiUpscalingCapabilitiesSchema.optional(),
  opticalDrives: z.number().int().nonnegative(),
  paths: z.object({
    configDir: z.string(),
    dataDir: z.string(),
    cacheDir: z.string(),
    logDir: z.string(),
    streamsDir: z.string(),
    coversDir: z.string()
  })
});

export type PlatformCapabilities = z.infer<typeof platformCapabilitiesSchema>;
