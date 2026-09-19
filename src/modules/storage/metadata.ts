import { imageSize } from 'image-size';

export interface MediaMetadata {
  width: number | null;
  height: number | null;
  duration: number | null;
  mimeType: string;
  fileSize: number;
}

/**
 * Extracts width and height from image buffer.
 */
export function extractImageMetadata(buffer: Buffer, declaredMimeType: string): MediaMetadata {
  let width: number | null = null;
  let height: number | null = null;
  let detectedType = declaredMimeType;

  try {
    const dimensions = imageSize(buffer);
    if (dimensions.width) width = dimensions.width;
    if (dimensions.height) height = dimensions.height;
    if (dimensions.type) {
      if (dimensions.type === 'jpg' || dimensions.type === 'jpeg') detectedType = 'image/jpeg';
      else if (dimensions.type === 'png') detectedType = 'image/png';
      else if (dimensions.type === 'gif') detectedType = 'image/gif';
      else if (dimensions.type === 'webp') detectedType = 'image/webp';
      else if (dimensions.type === 'svg') detectedType = 'image/svg+xml';
    }
  } catch (err) {
    console.warn('Could not extract image dimensions:', err);
  }

  return {
    width,
    height,
    duration: null,
    mimeType: detectedType,
    fileSize: buffer.length,
  };
}

/**
 * Parses MP4 ISO BMFF box structure to extract width, height, and duration (in seconds).
 */
export function parseMp4Metadata(buffer: Buffer): { width: number | null; height: number | null; duration: number | null } {
  let width: number | null = null;
  let height: number | null = null;
  let duration: number | null = null;

  try {
    let offset = 0;
    let timescale = 1000;

    while (offset < buffer.length - 8) {
      const boxSize = buffer.readUInt32BE(offset);
      const boxType = buffer.toString('ascii', offset + 4, offset + 8);

      const actualBoxSize = boxSize === 1 ? Number(buffer.readBigUInt64BE(offset + 8)) : boxSize;
      if (actualBoxSize <= 0) break;

      if (boxType === 'moov' || boxType === 'trak' || boxType === 'mdia') {
        // Container box, step inside
        offset += (boxSize === 1 ? 16 : 8);
        continue;
      }

      if (boxType === 'mvhd') {
        // Movie header box
        const version = buffer.readUInt8(offset + 8);
        if (version === 1) {
          timescale = buffer.readUInt32BE(offset + 28);
          const rawDuration = buffer.readBigUInt64BE(offset + 32);
          if (timescale > 0) {
            duration = Math.round(Number(rawDuration) / timescale);
          }
        } else {
          timescale = buffer.readUInt32BE(offset + 20);
          const rawDuration = buffer.readUInt32BE(offset + 24);
          if (timescale > 0) {
            duration = Math.round(rawDuration / timescale);
          }
        }
      } else if (boxType === 'tkhd') {
        // Track header box
        const version = buffer.readUInt8(offset + 8);
        const widthOffset = version === 1 ? offset + 96 : offset + 84;
        const heightOffset = version === 1 ? offset + 100 : offset + 88;

        if (heightOffset + 4 <= buffer.length) {
          const w = buffer.readUInt32BE(widthOffset) >> 16;
          const h = buffer.readUInt32BE(heightOffset) >> 16;
          if (w > 0 && h > 0) {
            width = w;
            height = h;
          }
        }
      }

      offset += actualBoxSize;
    }
  } catch (err) {
    console.warn('Error parsing MP4 metadata:', err);
  }

  return { width, height, duration };
}

/**
 * Extracts metadata for video file.
 */
export function extractVideoMetadata(buffer: Buffer, declaredMimeType: string): MediaMetadata {
  let width: number | null = null;
  let height: number | null = null;
  let duration: number | null = null;

  if (declaredMimeType.includes('mp4') || declaredMimeType.includes('quicktime')) {
    const parsed = parseMp4Metadata(buffer);
    width = parsed.width;
    height = parsed.height;
    duration = parsed.duration;
  }

  return {
    width,
    height,
    duration,
    mimeType: declaredMimeType,
    fileSize: buffer.length,
  };
}

/**
 * Main media metadata extraction dispatcher.
 */
export function extractMediaMetadata(buffer: Buffer, declaredMimeType: string): MediaMetadata {
  if (declaredMimeType.startsWith('image/')) {
    return extractImageMetadata(buffer, declaredMimeType);
  } else if (declaredMimeType.startsWith('video/')) {
    return extractVideoMetadata(buffer, declaredMimeType);
  }

  return {
    width: null,
    height: null,
    duration: null,
    mimeType: declaredMimeType || 'application/octet-stream',
    fileSize: buffer.length,
  };
}
