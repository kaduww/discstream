import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { makeError, type LocalMediaFolderBrowserResponse } from "@discstream/contracts";

interface BrowseRoot {
  displayName: string;
  path: string;
}

interface RealBrowseRoot extends BrowseRoot {
  realPath: string;
}

export class ServerFolderBrowser {
  constructor(private readonly rootPaths: string[]) {}

  async list(requestedPath?: string): Promise<LocalMediaFolderBrowserResponse> {
    const roots = await this.readableRoots();
    if (roots.length === 0) {
      throw makeError("LOCAL_MEDIA_ROOT_UNAVAILABLE", "No server folders are available to browse.", {
        hint: "Configure DISCSTREAM_LOCAL_MEDIA_BROWSE_ROOTS on the server."
      });
    }

    const currentPath = requestedPath ? await this.resolveDirectory(requestedPath, roots) : roots[0]!.realPath;
    const root = findContainingRoot(roots, currentPath);
    if (!root) {
      throw makeError("MEDIA_PATH_NOT_ALLOWED", "This folder is outside the browsable server folders.");
    }

    const directories = await this.listChildDirectories(currentPath);
    const parentPath = parentInsideRoot(currentPath, root);

    return {
      roots: roots.map((item) => ({
        displayName: item.displayName,
        path: item.realPath
      })),
      currentPath,
      parentPath,
      directories
    };
  }

  private async readableRoots(): Promise<RealBrowseRoot[]> {
    const roots: RealBrowseRoot[] = [];

    for (const rootPath of this.rootPaths) {
      try {
        const resolvedPath = path.resolve(rootPath);
        const stat = await fs.stat(resolvedPath);
        if (!stat.isDirectory()) {
          continue;
        }

        const realPath = await fs.realpath(resolvedPath);
        if (roots.some((root) => root.realPath === realPath)) {
          continue;
        }

        roots.push({
          displayName: displayNameForRoot(realPath),
          path: resolvedPath,
          realPath
        });
      } catch {
        continue;
      }
    }

    return roots.sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  private async resolveDirectory(requestedPath: string, roots: RealBrowseRoot[]): Promise<string> {
    const resolvedPath = path.resolve(requestedPath);
    const stat = await fs.stat(resolvedPath);
    if (!stat.isDirectory()) {
      throw makeError("LOCAL_MEDIA_ROOT_UNAVAILABLE", "This server path is not a folder.");
    }

    const realPath = await fs.realpath(resolvedPath);
    if (!findContainingRoot(roots, realPath)) {
      throw makeError("MEDIA_PATH_NOT_ALLOWED", "This folder is outside the browsable server folders.");
    }

    return realPath;
  }

  private async listChildDirectories(currentPath: string): Promise<LocalMediaFolderBrowserResponse["directories"]> {
    let entries;
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch {
      return [];
    }

    const directories: LocalMediaFolderBrowserResponse["directories"] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) {
        continue;
      }

      const childPath = path.join(currentPath, entry.name);
      try {
        await fs.access(childPath);
        directories.push({
          name: entry.name,
          path: childPath
        });
      } catch {
        continue;
      }
    }

    return directories.sort((left, right) => left.name.localeCompare(right.name));
  }
}

export function defaultServerFolderBrowseRoots(platform: NodeJS.Platform = process.platform): string[] {
  const roots = [os.homedir()];

  if (platform === "darwin") {
    roots.push("/Volumes");
  }

  if (platform === "linux") {
    roots.push("/media", "/mnt");
  }

  return roots;
}

function findContainingRoot(roots: RealBrowseRoot[], candidatePath: string): RealBrowseRoot | undefined {
  return roots
    .filter((root) => isInsideRoot(root.realPath, candidatePath))
    .sort((left, right) => right.realPath.length - left.realPath.length)[0];
}

function parentInsideRoot(currentPath: string, root: RealBrowseRoot): string | null {
  if (currentPath === root.realPath) {
    return null;
  }

  const parentPath = path.dirname(currentPath);
  return isInsideRoot(root.realPath, parentPath) ? parentPath : null;
}

function isInsideRoot(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function displayNameForRoot(rootPath: string): string {
  const homePath = os.homedir();
  if (rootPath === homePath) {
    return "Home";
  }

  return path.basename(rootPath) || rootPath;
}
