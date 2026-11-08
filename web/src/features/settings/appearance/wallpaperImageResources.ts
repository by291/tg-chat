import { readWallpaperImage } from './wallpaperImages';

interface WallpaperImageResource {
  ready: Promise<void>;
  users: number;
  url?: string;
}

const resources = new Map<string, WallpaperImageResource>();

function releaseUnusedResource(imageId: string, resource: WallpaperImageResource) {
  if (resource.users > 0) {
    return;
  }
  if (resource.url) {
    URL.revokeObjectURL(resource.url);
    resource.url = undefined;
  }
  if (resources.get(imageId) === resource) {
    resources.delete(imageId);
  }
}

async function decodeWallpaper(imageId: string, resource: WallpaperImageResource) {
  const blob = await readWallpaperImage(imageId);
  if (!blob) {
    throw new Error('This wallpaper is unavailable. Choose another image or reset the background.');
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    resource.url = url;
    releaseUnusedResource(imageId, resource);
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

/** Retain decoded wallpaper pixels across preparation, view snapshots, and the mounted image. */
export function acquireWallpaperImage(imageId: string) {
  let resource = resources.get(imageId);
  if (!resource) {
    resource = {
      ready: Promise.resolve(),
      users: 0,
    };
    resources.set(imageId, resource);
    resource.ready = decodeWallpaper(imageId, resource);
  }
  resource.users += 1;
  const retained = resource;
  let isReleased = false;
  return {
    ready: retained.ready,
    release: () => {
      if (isReleased) {
        return;
      }
      isReleased = true;
      retained.users -= 1;
      releaseUnusedResource(imageId, retained);
    },
  };
}

/** Read only fully decoded images so a transition never captures a half-loaded wallpaper. */
export function getPreparedWallpaperUrl(imageId: string | undefined) {
  return imageId ? resources.get(imageId)?.url : undefined;
}
