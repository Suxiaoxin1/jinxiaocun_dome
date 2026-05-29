import type {
  LowStockPart,
  NamedPartStock,
  PartStock,
  PartUsage,
  ProductBomItem
} from "../shared/types";

export function calculateBomConsumption(
  bomItems: ProductBomItem[],
  outboundQuantity: number
): PartUsage[] {
  if (!Number.isInteger(outboundQuantity) || outboundQuantity <= 0) {
    throw new Error("出库数量必须为正整数");
  }

  const totals = new Map<string, number>();
  for (const item of bomItems) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new Error(`产品配件用量必须为正整数：${item.partId}`);
    }
    totals.set(item.partId, (totals.get(item.partId) ?? 0) + item.quantity * outboundQuantity);
  }

  return Array.from(totals.entries()).map(([partId, quantity]) => ({ partId, quantity }));
}

export function ensureCanOutboundProduct(
  stocks: PartStock[],
  bomItems: ProductBomItem[],
  outboundQuantity: number
): PartUsage[] {
  const required = calculateBomConsumption(bomItems, outboundQuantity);
  const stockByPart = new Map(stocks.map((stock) => [stock.partId, stock.quantity]));

  for (const item of required) {
    const current = stockByPart.get(item.partId) ?? 0;
    if (current < item.quantity) {
      throw new Error(`配件 ${item.partId} 库存不足：需要 ${item.quantity}，当前 ${current}`);
    }
  }

  return required;
}

export function calculateLowStockParts(
  stocks: NamedPartStock[],
  usageInPeriod: PartUsage[],
  periodDays: number,
  thresholdDays: number
): LowStockPart[] {
  if (!Number.isInteger(periodDays) || periodDays <= 0) {
    throw new Error("统计周期天数必须为正整数");
  }
  if (!Number.isInteger(thresholdDays) || thresholdDays <= 0) {
    throw new Error("低库存阈值天数必须为正整数");
  }

  const usageByPart = new Map<string, number>();
  for (const usage of usageInPeriod) {
    usageByPart.set(usage.partId, (usageByPart.get(usage.partId) ?? 0) + usage.quantity);
  }

  return stocks
    .map((stock) => {
      const averageDailyUsage = (usageByPart.get(stock.partId) ?? 0) / periodDays;
      if (averageDailyUsage <= 0) {
        return null;
      }
      const remainingDays = stock.quantity / averageDailyUsage;
      if (remainingDays >= thresholdDays) {
        return null;
      }
      return {
        partId: stock.partId,
        partName: stock.partName,
        currentStock: stock.quantity,
        averageDailyUsage: Number(averageDailyUsage.toFixed(2)),
        remainingDays: Number(remainingDays.toFixed(2))
      };
    })
    .filter((item): item is LowStockPart => item !== null)
    .sort((a, b) => a.remainingDays - b.remainingDays);
}

export function applyStocktake(
  stock: Required<Pick<PartStock, "partId" | "quantity">> &
    Pick<PartStock, "remark" | "lastStocktakeAt">,
  actualQuantity: number,
  remark: string,
  stocktakeAt: string
): PartStock {
  if (!Number.isInteger(actualQuantity) || actualQuantity < 0) {
    throw new Error("盘点数量必须为非负整数");
  }

  return {
    partId: stock.partId,
    quantity: actualQuantity,
    remark,
    lastStocktakeAt: stocktakeAt
  };
}
