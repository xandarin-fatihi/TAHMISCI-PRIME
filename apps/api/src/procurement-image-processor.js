"use strict";

const sharp = require("sharp");

const MAX_INPUT_PIXELS = 60 * 1000 * 1000;
const DEFAULT_THUMBNAIL_SIDE = 480;

function createProcurementImageProcessor(options = {}) {
  const primaryQuality = clamp(options.primaryQuality, 88, 70, 95);
  const thumbnailQuality = clamp(options.thumbnailQuality, 76, 60, 90);
  const timeoutSeconds = clamp(options.timeoutSeconds, 15, 3, 60);

  return async function processProcurementImage(input = {}) {
    if (!Buffer.isBuffer(input.buffer) || !input.buffer.length) throw new TypeError("Geçerli görsel buffer'ı gerekli.");
    const maxThumbnailSide = clamp(input.maxThumbnailSide, DEFAULT_THUMBNAIL_SIDE, 160, 1024);
    const source = sharp(input.buffer, {
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
      sequentialRead: true,
      pages: 1
    }).timeout({ seconds: timeoutSeconds });

    // EXIF yönü fiziksel piksellere uygulanır; metadata bilerek taşınmaz.
    const metadata = await source.metadata();
    if (metadata.width > 24000 || metadata.height > 24000 || metadata.width * metadata.height > MAX_INPUT_PIXELS) {
      const error = new Error("Görsel boyut sınırını aşıyor.");
      error.code = "DOCUMENT_TOO_LARGE";
      throw error;
    }
    const primary = await source
      .rotate()
      .resize({ width: 4000, height: 4000, fit: "inside", withoutEnlargement: true })
      .webp({ quality: primaryQuality, effort: 4, smartSubsample: true })
      .toBuffer();
    const thumbnailBuffer = await sharp(primary, {
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
      sequentialRead: true
    })
      .timeout({ seconds: timeoutSeconds })
      .resize({ width: maxThumbnailSide, height: maxThumbnailSide, fit: "inside", withoutEnlargement: true })
      .webp({ quality: thumbnailQuality, effort: 4, smartSubsample: true })
      .toBuffer();

    return { buffer: primary, thumbnailBuffer, thumbnailMimeType: "image/webp", reencoded: true };
  };
}

function clamp(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Math.max(minimum, Math.min(maximum, Number.isFinite(number) ? Math.trunc(number) : fallback));
}

module.exports = { createProcurementImageProcessor };
