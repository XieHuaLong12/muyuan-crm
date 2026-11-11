import { image } from '@kit.ImageKit';
import { fileIo as fs, picker } from '@kit.CoreFileKit';
import { photoAccessHelper } from '@kit.MediaLibraryKit';
import { common } from '@kit.AbilityKit';
import { Api } from './Http';

/** A file chosen on the phone, read into memory and ready to upload. */
export class PickedFile {
  name: string = '';
  mimeType: string = '';
  data: ArrayBuffer = new ArrayBuffer(0);
}

/** Extensions → the types the server accepts (services/whatsapp-media-service.ts MEDIA_TYPES_ALLOWED). */
const MIME: Record<string, string> = {
  'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'webp': 'image/webp', 'gif': 'image/gif',
  'pdf': 'application/pdf', 'txt': 'text/plain', 'zip': 'application/zip', 'mp4': 'video/mp4', 'mp3': 'audio/mpeg',
  'm4a': 'audio/mp4', 'aac': 'audio/aac', 'amr': 'audio/amr', 'wav': 'audio/wav', 'ogg': 'audio/ogg',
  'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

/** WhatsApp shows pictures up to 5 MB; larger ones (and HEIC from the camera) are re-encoded as JPEG. */
const PHOTO_LIMIT = 4500000;
const PHOTO_SIDE = 2560;
const THUMB_LIMIT = 60;

/** EXIF orientation → clockwise degrees (string and numeric forms). */
function rotationOf(orientation: string): number {
  if (orientation === 'Right-top' || orientation === '6') return 90;
  if (orientation === 'Bottom-right' || orientation === '3') return 180;
  if (orientation === 'Left-bottom' || orientation === '8') return 270;
  return 0;
}

/** Pictures and files: choosing them on the phone, preparing them for WhatsApp, and showing signed-in pictures. */
export class Media {
  private static thumbs: Map<string, image.PixelMap> = new Map<string, image.PixelMap>();
  private static pending: Map<string, Promise<image.PixelMap>> = new Map<string, Promise<image.PixelMap>>();
  private static order: string[] = [];

  static mimeOf(name: string): string {
    const dot = name.lastIndexOf('.');
    if (dot < 0) return '';
    const type = MIME[name.slice(dot + 1).toLowerCase()];
    return type === undefined ? '' : type;
  }

  static nameOf(uri: string): string {
    const last = uri.split('/').pop();
    if (last === undefined || last.length === 0) return 'file';
    try {
      return decodeURIComponent(last);
    } catch (e) {
      return last;
    }
  }

  /** System photo picker: no permission needed, the user chooses. */
  static async pickPhotos(max: number): Promise<string[]> {
    const options = new photoAccessHelper.PhotoSelectOptions();
    options.MIMEType = photoAccessHelper.PhotoViewMIMETypes.IMAGE_TYPE;
    options.maxSelectNumber = max;
    const result = await new photoAccessHelper.PhotoViewPicker().select(options);
    return result.photoUris;
  }

  /** System file picker (PDF, Word, Excel…). */
  static async pickFiles(context: common.Context, max: number): Promise<string[]> {
    const options = new picker.DocumentSelectOptions();
    options.maxSelectNumber = max;
    return await new picker.DocumentViewPicker(context).select(options);
  }

  static readUri(uri: string): ArrayBuffer {
    const file = fs.openSync(uri, fs.OpenMode.READ_ONLY);
    try {
      const size = fs.statSync(file.fd).size;
      const buffer = new ArrayBuffer(size);
      fs.readSync(file.fd, buffer);
      return buffer;
    } finally {
      fs.closeSync(file);
    }
  }

  /** A chosen photo as WhatsApp takes it: JPEG/PNG under 4.5 MB as they are, anything else re-encoded. */
  static async photo(uri: string): Promise<PickedFile> {
    const picked = new PickedFile();
    const name = Media.nameOf(uri);
    const data = Media.readUri(uri);
    const type = Media.mimeOf(name);
    if ((type === 'image/jpeg' || type === 'image/png') && data.byteLength <= PHOTO_LIMIT) {
      picked.name = name;
      picked.mimeType = type;
      picked.data = data;
      return picked;
    }
    const base = name.lastIndexOf('.') > 0 ? name.slice(0, name.lastIndexOf('.')) : name;
    picked.name = `${base}.jpg`;
    picked.mimeType = 'image/jpeg';
    picked.data = await Media.toJpeg(data, PHOTO_SIDE);
    return picked;
  }

  /** A chosen document; mimeType '' means the server would refuse it. */
  static file(uri: string): PickedFile {
    const picked = new PickedFile();
    picked.name = Media.nameOf(uri);
    picked.mimeType = Media.mimeOf(picked.name);
    picked.data = Media.readUri(uri);
    return picked;
  }

  private static async decode(data: ArrayBuffer, maxSide: number): Promise<image.PixelMap> {
    const source = image.createImageSource(data);
    try {
      const info = await source.getImageInfo();
      const longest = Math.max(info.size.width, info.size.height);
      const scale = longest > maxSide ? maxSide / longest : 1;
      const options: image.DecodingOptions = {
        desiredSize: { width: Math.max(1, Math.round(info.size.width * scale)), height: Math.max(1, Math.round(info.size.height * scale)) }
      };
      const pixelMap = await source.createPixelMap(options);
      let orientation = '';
      try {
        orientation = await source.getImageProperty(image.PropertyKey.ORIENTATION);
      } catch (e) {
        orientation = '';
      }
      const degrees = rotationOf(orientation);
      if (degrees !== 0) {
        await pixelMap.rotate(degrees);
      }
      return pixelMap;
    } finally {
      source.release();
    }
  }

  static async toJpeg(data: ArrayBuffer, maxSide: number): Promise<ArrayBuffer> {
    const pixelMap = await Media.decode(data, maxSide);
    const packer = image.createImagePacker();
    try {
      const options: image.PackingOption = { format: 'image/jpeg', quality: 85 };
      return await packer.packing(pixelMap, options);
    } finally {
      packer.release();
      pixelMap.release();
    }
  }

  /** A signed-in picture (chat photo, product photo) scaled to maxSide px; the last 60 stay in memory. */
  static thumbnail(href: string, maxSide: number): Promise<image.PixelMap> {
    const key = `${href}|${maxSide}`;
    const hit = Media.thumbs.get(key);
    if (hit !== undefined) {
      return Promise.resolve(hit);
    }
    const waiting = Media.pending.get(key);
    if (waiting !== undefined) {
      return waiting;
    }
    const loading = Media.load(href, maxSide, key);
    Media.pending.set(key, loading);
    return loading;
  }

  private static async load(href: string, maxSide: number, key: string): Promise<image.PixelMap> {
    try {
      const data = await Api.download(href);
      const pixelMap = await Media.decode(data, maxSide);
      Media.thumbs.set(key, pixelMap);
      Media.order.push(key);
      if (Media.order.length > THUMB_LIMIT) {
        const oldest = Media.order.shift();
        if (oldest !== undefined) {
          Media.thumbs.delete(oldest);
        }
      }
      return pixelMap;
    } finally {
      Media.pending.delete(key);
    }
  }
}
