import path from "node:path";

export function getStorageRoot() {
  if (process.env.CHAT2SKILLS_STORAGE_ROOT?.trim()) {
    return process.env.CHAT2SKILLS_STORAGE_ROOT.trim();
  }

  // Vercel serverless file system is read-only except /tmp.
  if (process.env.VERCEL) {
    return path.join("/tmp", "chat2skills");
  }

  return path.join(process.cwd(), "storage");
}

export function getOutputsRoot() {
  return path.join(getStorageRoot(), "outputs");
}
