import path from "node:path";
import fs from "node:fs/promises";
import { makeError } from "@discstream/contracts";

export interface AllowedRoot {
  id: string;
  displayName: string;
  path: string;
  enabled: boolean;
}

export async function normalizeRoot(root: AllowedRoot): Promise<AllowedRoot> {
  return {
    ...root,
    path: path.resolve(root.path)
  };
}

export async function ensureInsideRoot(root: AllowedRoot, candidatePath: string): Promise<string> {
  const normalizedRoot = await normalizeRoot(root);
  const absoluteCandidate = path.resolve(normalizedRoot.path, candidatePath);
  const relative = path.relative(normalizedRoot.path, absoluteCandidate);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw makeError("MEDIA_PATH_NOT_ALLOWED", "This media path is outside the configured media folder.", {
      recoverable: false
    });
  }

  return absoluteCandidate;
}

export async function canReadRoot(root: AllowedRoot): Promise<boolean> {
  try {
    await fs.access(root.path);
    return true;
  } catch {
    return false;
  }
}
