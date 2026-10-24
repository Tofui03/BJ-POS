import { ref } from "vue";

// Bundled product photos (optional). Hardware seed items ship without images;
// cashiers can import photos from USB via Electron.
const mods = import.meta.glob("./assets/products/*.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const byKey: Record<string, string> = {};
for (const [path, url] of Object.entries(mods)) {
  const key = path.split("/").pop()!.replace(/\.png$/, "");
  byKey[key] = url;
}

// User-imported images (Electron): filename -> data URL. Reactive so the grid
// and item tiles update after an import. item.image stores them as "user:<file>".
const userImages = ref<Record<string, string>>({});

/** Populate the user image library (called once on boot, and after imports). */
export function setUserImages(list: { name: string; dataUrl: string }[]): void {
  userImages.value = Object.fromEntries(list.map((i) => [i.name, i.dataUrl]));
}

/** Load the on-disk image library from Electron (no-op in the browser). */
export async function loadUserImages(): Promise<void> {
  if (window.images) setUserImages(await window.images.list());
}

/** User images for the picker grid, as `{ id: "user:<file>", url }`. */
export function listUserImages(): { id: string; url: string }[] {
  return Object.entries(userImages.value).map(([name, url]) => ({ id: `user:${name}`, url }));
}

/** Resolve an item.image value (bundled key, path, or "user:<file>") to a URL. */
export function productImage(keyOrPath?: string | null): string | null {
  if (!keyOrPath) return null;
  if (keyOrPath.startsWith("user:")) return userImages.value[keyOrPath.slice(5)] ?? null;
  const key = keyOrPath.split("/").pop()!.replace(/\.[a-z]+$/i, "");
  return byKey[key] ?? null;
}

/** As a CSS background-image value, falling back to `none` (shows the tint). */
export function imageCss(keyOrPath?: string | null): string {
  const url = productImage(keyOrPath);
  return url ? `url('${url}')` : "none";
}

export interface ProductImage {
  /** Filename without extension (e.g. "talapia") — what's stored on item.image. */
  key: string;
  url: string;
}

/** Every bundled product image, for the admin "Select image" picker grid. */
export const PRODUCT_IMAGES: ProductImage[] = Object.entries(mods)
  .map(([path, url]) => ({ key: path.split("/").pop()!.replace(/\.png$/, ""), url }))
  .sort((a, b) => a.key.localeCompare(b.key));

/** Normalise a key or path ("/images/talapia.png") to its bare key ("talapia"). */
export function imageKey(keyOrPath?: string | null): string {
  if (!keyOrPath) return "";
  return keyOrPath.split("/").pop()!.replace(/\.[a-z]+$/i, "");
}
