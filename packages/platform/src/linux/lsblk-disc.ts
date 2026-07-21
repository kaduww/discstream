import type { DiscType, MountedVolume } from "@discstream/contracts";

interface LsblkNode {
  name?: string;
  path?: string;
  type?: string;
  mountpoint?: string | null;
  label?: string | null;
  fstype?: string | null;
  children?: LsblkNode[];
}

interface LsblkOutput {
  blockdevices?: LsblkNode[];
}

export interface LsblkDiscInfo {
  devicePath: string;
  mediaPresent: boolean;
  mountedVolume?: MountedVolume;
  inferredDiscType: DiscType;
}

export function parseLsblkDiscInfo(jsonText: string, devicePath: string): LsblkDiscInfo {
  const parsed = JSON.parse(jsonText) as LsblkOutput;
  const node = findDevice(parsed.blockdevices ?? [], devicePath);
  if (!node) {
    return {
      devicePath,
      mediaPresent: false,
      inferredDiscType: "none"
    };
  }

  const mountedNode = [node, ...(node.children ?? [])].find((item) => Boolean(item.mountpoint));
  const mountedVolume = mountedNode?.mountpoint
    ? {
        mountPath: mountedNode.mountpoint,
        label: mountedNode.label ?? undefined,
        filesystem: mountedNode.fstype ?? undefined
      }
    : undefined;

  const mediaPresent = Boolean(mountedVolume || node.fstype || node.label || (node.children?.length ?? 0) > 0);

  return {
    devicePath,
    mediaPresent,
    mountedVolume,
    inferredDiscType: mediaPresent ? (mountedVolume ? "data-disc" : "unknown") : "none"
  };
}

function findDevice(nodes: LsblkNode[], devicePath: string): LsblkNode | undefined {
  for (const node of nodes) {
    if (node.path === devicePath || (node.name ? `/dev/${node.name}` : undefined) === devicePath) {
      return node;
    }

    const child = findDevice(node.children ?? [], devicePath);
    if (child) {
      return child;
    }
  }

  return undefined;
}
