import { z } from "zod";

const nullableText = z.string().trim().nullable();
const optionalIsoText = z.string().datetime().optional();
const requiredIsoText = z.string().datetime();
const positiveInteger = z.number().int().positive();
const nonnegativeInteger = z.number().int().nonnegative();
const purchaseStatusSchema = z.enum(["缺货", "在途", "已签收", "部分签收"]);

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const partSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(["在售", "不在售"]),
  weight: z.number().nonnegative().nullable(),
  imageUrl: nullableText,
  specification: nullableText,
  remark: nullableText,
});

export const productSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  remark: nullableText.optional().default(null),
  bomItems: z.array(
    z.object({
      partId: z.string().min(1),
      quantity: positiveInteger,
    }),
  ).min(1),
});

export const purchaseOrderSchema = z.object({
  orderNo: z.string().min(1),
  logisticsNo: nullableText.optional().default(null),
  partId: z.string().min(1),
  orderQuantity: positiveInteger,
  status: purchaseStatusSchema,
  remark: nullableText.optional().default(null),
  orderTime: optionalIsoText,
});

export const receivePurchaseReceiptSchema = z.object({
  inboundQuantity: nonnegativeInteger,
  status: purchaseStatusSchema.optional(),
  remark: nullableText.optional().default(null),
  inboundTime: optionalIsoText,
});

export const otherInboundSchema = z.object({
  inboundNo: z.string().min(1),
  partId: z.string().min(1),
  inboundQuantity: positiveInteger,
  inboundTime: requiredIsoText,
  operatorName: nullableText.optional().default(null),
  remark: nullableText.optional().default(null),
});

export const storeSchema = z.object({
  name: z.string().min(1),
  remark: nullableText.optional().default(null),
});

export const outboundSchema = z.object({
  productId: z.string().min(1),
  storeId: z.string().min(1),
  outboundQuantity: positiveInteger,
  outboundTime: optionalIsoText,
  operatorName: z.string().min(1),
  remark: nullableText.optional().default(null),
});

export const stockRemarkSchema = z.object({
  remark: nullableText,
});

export const stocktakeSchema = z.object({
  partId: z.string().min(1),
  actualQuantity: nonnegativeInteger,
  remark: nullableText.optional().default(null),
  stocktakeTime: requiredIsoText,
});
