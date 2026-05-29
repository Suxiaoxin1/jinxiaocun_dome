import { describe, expect, it } from "vitest";
import {
  calculateBomConsumption,
  calculateLowStockParts,
  ensureCanOutboundProduct,
  applyStocktake
} from "../../src/domain/inventory";
import type { ProductBomItem, PartStock } from "../../src/shared/types";

describe("inventory domain rules", () => {
  it("calculates part consumption from product BOM and outbound quantity", () => {
    const bom: ProductBomItem[] = [
      { productId: "product-a", partId: "part-b", quantity: 3 },
      { productId: "product-a", partId: "part-c", quantity: 2 }
    ];

    expect(calculateBomConsumption(bom, 2)).toEqual([
      { partId: "part-b", quantity: 6 },
      { partId: "part-c", quantity: 4 }
    ]);
  });

  it("blocks product outbound when any required part is short", () => {
    const stocks: PartStock[] = [
      { partId: "part-b", quantity: 5 },
      { partId: "part-c", quantity: 9 }
    ];
    const bom: ProductBomItem[] = [
      { productId: "product-a", partId: "part-b", quantity: 3 },
      { productId: "product-a", partId: "part-c", quantity: 2 }
    ];

    expect(() => ensureCanOutboundProduct(stocks, bom, 2)).toThrow(
      "配件 part-b 库存不足：需要 6，当前 5"
    );
  });

  it("marks parts with less than 10 days of stock as low stock", () => {
    const result = calculateLowStockParts(
      [
        { partId: "part-b", partName: "配件B", quantity: 18 },
        { partId: "part-c", partName: "配件C", quantity: 50 }
      ],
      [
        { partId: "part-b", quantity: 60 },
        { partId: "part-c", quantity: 30 }
      ],
      30,
      10
    );

    expect(result).toEqual([
      {
        partId: "part-b",
        partName: "配件B",
        currentStock: 18,
        averageDailyUsage: 2,
        remainingDays: 9
      }
    ]);
  });

  it("updates stock quantity, remark, and stocktake time after stocktaking", () => {
    expect(
      applyStocktake(
        { partId: "part-b", quantity: 20, remark: "旧备注", lastStocktakeAt: null },
        17,
        "盘点少 3 个",
        "2026-05-29T09:00:00.000Z"
      )
    ).toEqual({
      partId: "part-b",
      quantity: 17,
      remark: "盘点少 3 个",
      lastStocktakeAt: "2026-05-29T09:00:00.000Z"
    });
  });
});
