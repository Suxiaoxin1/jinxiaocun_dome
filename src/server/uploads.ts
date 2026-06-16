import type { Request, Response } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";

const supportedImageTypes = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
]);

export const uploadPartImage = createImageUpload("parts", "part");
export const uploadProductImage = createImageUpload("products", "product");

export function handlePartImageUpload(request: Request, response: Response) {
  handleImageUpload(request, response, "parts");
}

export function handleProductImageUpload(request: Request, response: Response) {
  handleImageUpload(request, response, "products");
}

function createImageUpload(namespace: "parts" | "products", filenamePrefix: string) {
  const uploadRoot = path.resolve("uploads", namespace);
  return multer({
    storage: multer.diskStorage({
      destination: (_request, _file, callback) => {
        mkdirSync(uploadRoot, { recursive: true });
        callback(null, uploadRoot);
      },
      filename: (_request, file, callback) => {
        const extension = supportedImageTypes.get(file.mimetype) ?? path.extname(file.originalname);
        callback(null, `${filenamePrefix}-${Date.now()}-${randomUUID()}${extension}`);
      },
    }),
    limits: {
      fileSize: 5 * 1024 * 1024,
    },
    fileFilter: (_request, file, callback) => {
      if (!supportedImageTypes.has(file.mimetype)) {
        callback(new Error("仅支持 PNG、JPG 图片"));
        return;
      }
      callback(null, true);
    },
  });
}

function handleImageUpload(request: Request, response: Response, namespace: "parts" | "products") {
  if (!request.file) {
    throw new Error("请选择要上传的图片");
  }
  if (!imageContentMatchesType(request.file.path, request.file.mimetype)) {
    unlinkUploadedFile(request.file.path);
    throw new Error("图片内容与格式不匹配");
  }
  response.json({ imageUrl: `/uploads/${namespace}/${request.file.filename}` });
}

function imageContentMatchesType(filePath: string, mimetype: string) {
  const header = readFileSync(filePath).subarray(0, 8);
  if (mimetype === "image/png") {
    return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).equals(header);
  }
  if (mimetype === "image/jpeg") {
    return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  }
  return false;
}

function unlinkUploadedFile(filePath: string) {
  try {
    unlinkSync(filePath);
  } catch {
    // Best-effort cleanup; the upload response still needs to report the validation error.
  }
}
