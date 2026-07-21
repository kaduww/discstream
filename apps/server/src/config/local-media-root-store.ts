import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import type { LocalMediaRootConfig } from "@discstream/local-media";

interface StoredLocalMediaRoots {
  roots: LocalMediaRootConfig[];
}

export class LocalMediaRootStore {
  private rootsValue: LocalMediaRootConfig[] = [];

  constructor(
    private readonly filePath: string,
    private readonly envRoots: LocalMediaRootConfig[]
  ) {}

  get roots(): LocalMediaRootConfig[] {
    return [...this.rootsValue];
  }

  async load(): Promise<LocalMediaRootConfig[]> {
    const storedRoots = await this.readStoredRoots();
    this.rootsValue = uniqueRoots([...this.envRoots, ...storedRoots]);
    return this.roots;
  }

  async addRoot(rootPath: string, displayName?: string): Promise<LocalMediaRootConfig[]> {
    const resolvedPath = path.resolve(rootPath);
    const stat = await fs.stat(resolvedPath);
    if (!stat.isDirectory()) {
      throw new Error("Path is not a directory.");
    }

    const root = {
      displayName: displayName?.trim() || path.basename(resolvedPath) || resolvedPath,
      path: resolvedPath,
      enabled: true
    };

    this.rootsValue = uniqueRoots([...this.rootsValue, root]);
    await this.savePersistedRoots();
    return this.roots;
  }

  async removeRoot(rootId: string): Promise<LocalMediaRootConfig[]> {
    this.rootsValue = this.rootsValue.filter((root) => root.id !== rootId);
    await this.savePersistedRoots();
    return this.roots;
  }

  private async readStoredRoots(): Promise<LocalMediaRootConfig[]> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<StoredLocalMediaRoots>;
      return Array.isArray(parsed.roots) ? parsed.roots.filter(isRootConfig) : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }

  private async savePersistedRoots(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(
      this.filePath,
      `${JSON.stringify({ roots: this.rootsValue }, null, 2)}\n`,
      "utf8"
    );
  }
}

function uniqueRoots(roots: LocalMediaRootConfig[]): LocalMediaRootConfig[] {
  const seen = new Set<string>();
  const output: LocalMediaRootConfig[] = [];

  for (const root of roots) {
    const resolvedPath = path.resolve(root.path);
    if (seen.has(resolvedPath)) {
      continue;
    }

    seen.add(resolvedPath);
    output.push({
      ...root,
      id: root.id ?? stableId("root", resolvedPath),
      path: resolvedPath,
      enabled: root.enabled
    });
  }

  return output;
}

function stableId(prefix: string, input: string): string {
  const digest = crypto.createHash("sha1").update(input).digest("hex").slice(0, 12);
  return `${prefix}-${digest}`;
}

function isRootConfig(value: unknown): value is LocalMediaRootConfig {
  return Boolean(
    value &&
      typeof value === "object" &&
      "displayName" in value &&
      "path" in value &&
      "enabled" in value &&
      typeof (value as LocalMediaRootConfig).displayName === "string" &&
      typeof (value as LocalMediaRootConfig).path === "string" &&
      typeof (value as LocalMediaRootConfig).enabled === "boolean"
  );
}
