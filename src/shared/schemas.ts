import { z } from "zod";

const nullableText = z.string().trim().nullable();
const optionalIsoText = z.string().datetime().optional();
const requiredIsoText = z.string().datetime();
const positiveInteger = z.number().int().positive();
const integer = z.number().int();
const nonnegativeInteger = z.number().int().nonnegative();
const purchaseStatusSchema = z.preprocess((value) => normalizePurchaseStatus(String(value ?? "")), z.enum(["已下单", "在途", "工厂缺货", "已入库", "部分入库"]));

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const userCreateSchema = z.object({
  username: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
  password: z.string().min(6),
  role: z.enum(["admin", "operator", "purchaser", "inbound", "outbound", "operation"]),
  enabled: z.boolean().optional().default(true),
});

export const userUpdateSchema = z.object({
  displayName: z.string().trim().min(1),
  password: z.string().optional(),
  role: z.enum(["admin", "operator", "purchaser", "inbound", "outbound", "operation"]),
  enabled: z.boolean(),
});

export const partSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  weight: z.number().nonnegative().nullable(),
  imageUrl: nullableText,
  specification: nullableText,
  remark: nullableText,
  currentStock: nonnegativeInteger.optional(),
});

export const productSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  imageUrl: nullableText.optional().default(null),
  remark: nullableText.optional().default(null),
  bomItems: z.array(
    z.object({
      partId: z.string().min(1),
      quantity: positiveInteger,
    }),
  ).min(1),
});

export const purchaseOrderSchema = z.object({
  orderNo: z.string().trim().min(1).optional(),
  logisticsNo: nullableText.optional().default(null),
  partId: z.string().min(1),
 orderQuantity: positiveInteger,
 status: purchaseStatusSchema.optional().default("已下单"),
 remark: nullableText.optional().default(null),
  orderTime: optionalIsoText,
});

export const receivePurchaseReceiptSchema = z.object({
  orderNo: z.string().trim().min(1).optional(),
  inboundQuantity: nonnegativeInteger,
  addToExisting: z.boolean().optional().default(false),
  logisticsNo: nullableText.optional(),
  status: purchaseStatusSchema.optional(),
  remark: nullableText.optional().default(null),
  inboundTime: optionalIsoText,
});

export const otherInboundSchema = z.object({
  inboundSource: z.string().min(1),
  partId: z.string().min(1),
  inboundQuantity: positiveInteger,
  inboundTime: requiredIsoText,
  operatorName: nullableText.optional().default(null),
  remark: nullableText.optional().default(null),
});

export const storeSchema = z.object({
  name: z.string().min(1),
  remark: nullableText.optional().default(null),
  enabled: z.boolean().optional().default(true),
});

export const storeProductBindingSchema = z.object({
  productIds: z.array(z.string().min(1)),
});

export const userStoreBindingSchema = z.object({
  storeIds: z.array(z.string().min(1)),
});

export const outboundOperatorSchema = z.object({
  name: z.string().trim().min(1),
  enabled: z.boolean().optional().default(true),
});

export const outboundSchema = z.object({
  productId: z.string().min(1),
  storeId: z.string().min(1),
  outboundQuantity: positiveInteger.optional(),
  preOutboundQuantity: positiveInteger.optional(),
  actualOutboundQuantity: positiveInteger.optional(),
  outboundTime: optionalIsoText,
  operatorName: z.string().min(1),
  remark: nullableText.optional().default(null),
}).superRefine((value, context) => {
  if (value.preOutboundQuantity === undefined) {
    context.addIssue({
      code: "custom",
      message: "预出库数量必填",
      path: ["preOutboundQuantity"],
    });
  }
});

export const outboundPlanSchema = z.object({
  storeId: z.string().min(1),
  operatorName: z.string().min(1),
  remark: nullableText.optional().default(null),
  createdAt: optionalIsoText,
  items: z.array(
    z.object({
      productId: z.string().min(1),
      preOutboundQuantity: positiveInteger,
    }),
  ).min(1),
});

export const outboundShipmentSchema = z.object({
  planId: z.string().min(1).optional(),
  operatorName: z.string().min(1),
  outboundTime: optionalIsoText,
  shipmentType: nullableText.optional().default(null),
  goodsId: nullableText.optional().default(null),
  pickupNo: nullableText.optional().default(null),
  cartonCount: positiveInteger.nullable().optional().default(null),
  weight: z.number().nonnegative().nullable().optional().default(null),
  dimensions: nullableText.optional().default(null),
  remark: nullableText.optional().default(null),
  items: z.array(
    z.object({
      planItemId: z.string().min(1),
      shippedQuantity: nonnegativeInteger,
      finishRemaining: z.boolean().optional().default(false),
    }),
  ).min(1),
}).superRefine((value, context) => {
  value.items.forEach((item, index) => {
    if (item.shippedQuantity === 0 && !item.finishRemaining) {
      context.addIssue({
        code: "custom",
        message: "本次发货数量必须大于 0，或勾选发货完结/移出发货单",
        path: ["items", index, "shippedQuantity"],
      });
    }
  });
});

export const outboundShipmentApprovalSchema = z.object({
  items: z.array(
    z.object({
      shipmentItemId: z.string().min(1),
      shippedQuantity: nonnegativeInteger,
    }),
  ).min(1).optional(),
});

export const stockRemarkSchema = z.object({
  remark: nullableText,
});

export const stocktakeSchema = z.object({
  partId: z.string().min(1),
  actualQuantity: integer,
  remark: nullableText.optional().default(null),
  stocktakeTime: requiredIsoText,
});

function normalizePurchaseStatus(value: string) {
  if (value === "缺货") return "工厂缺货";
  if (value === "已下单") return "已下单";
  if (value === "全部入库") return "已入库";
  if (value === "已签收") return "已入库";
  if (value === "部分签收") return "部分入库";
  return value;
}
