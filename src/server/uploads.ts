import type { Request, Response } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

const uploadRoot = path.resolve("uploads", "parts");
const supportedImageTypes = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
]);

export const uploadPartImage = multer({
  storage: multer.diskStorage({
    destination: (_request, _file, callback) => {
      mkdirSync(uploadRoot, { recursive: true });
      callback(null, uploadRoot);
    },
    filename: (_request, file, callback) => {
      const extension = supportedImageTypes.get(file.mimetype) ?? path.extname(file.originalname);
      callback(null, `part-${Date.now()}-${randomUUID()}${extension}`);
    },
  }),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (_request, file, callback) => {
    if (!supportedImageTypes.has(file.mimetype)) {
      callback(new Error("仅支持 PNG、JPG、WEBP 图片"));
      return;
    }
    callback(null, true);
  },
});

export function handlePartImageUpload(request: Request, response: Response) {
  if (!request.file) {
    throw new Error("请选择要上传的图片");
  }
  response.json({ imageUrl: `/uploads/parts/${request.file.filename}` });
}
