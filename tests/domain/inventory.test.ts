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

  it("merges duplicate BOM rows by partId when calculating consumption", () => {
    const bom: ProductBomItem[] = [
      { productId: "product-a", partId: "part-b", quantity: 3 },
      { productId: "product-a", partId: "part-b", quantity: 2 },
      { productId: "product-a", partId: "part-c", quantity: 1 }
    ];

    expect(calculateBomConsumption(bom, 2)).toEqual([
      { partId: "part-b", quantity: 10 },
      { partId: "part-c", quantity: 2 }
    ]);
  });

  it("throws when outbound quantity is invalid", () => {
    expect(() => calculateBomConsumption([], 0)).toThrow("出库数量必须为正整数");
    expect(() => calculateBomConsumption([], 1.5)).toThrow("出库数量必须为正整数");
  });

  it("throws when BOM quantity is invalid", () => {
    expect(() =>
      calculateBomConsumption([{ productId: "product-a", partId: "part-b", quantity: 0 }], 1)
    ).toThrow("产品配件用量必须为正整数：part-b");
    expect(() =>
      calculateBomConsumption([{ productId: "product-a", partId: "part-c", quantity: 1.5 }], 1)
    ).toThrow("产品配件用量必须为正整数：part-c");
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

  it("returns required usage when product outbound has sufficient parts", () => {
    const stocks: PartStock[] = [
      { partId: "part-b", quantity: 6 },
      { partId: "part-c", quantity: 4 }
    ];
    const bom: ProductBomItem[] = [
      { productId: "product-a", partId: "part-b", quantity: 3 },
      { productId: "product-a", partId: "part-c", quantity: 2 }
    ];

    expect(ensureCanOutboundProduct(stocks, bom, 2)).toEqual([
      { partId: "part-b", quantity: 6 },
      { partId: "part-c", quantity: 4 }
    ]);
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

  it("sorts low-stock results by remaining days ascending", () => {
    const result = calculateLowStockParts(
      [
        { partId: "part-b", partName: "配件B", quantity: 20 },
        { partId: "part-c", partName: "配件C", quantity: 5 }
      ],
      [
        { partId: "part-b", quantity: 60 },
        { partId: "part-c", quantity: 30 }
      ],
      30,
      15
    );

    expect(result.map((item) => item.partId)).toEqual(["part-c", "part-b"]);
    expect(result.map((item) => item.remainingDays)).toEqual([5, 10]);
  });

  it("excludes parts with exactly the threshold days remaining", () => {
    const result = calculateLowStockParts(
      [{ partId: "part-b", partName: "配件B", quantity: 20 }],
      [{ partId: "part-b", quantity: 60 }],
      30,
      10
    );

    expect(result).toEqual([]);
  });

  it("does not mark parts with zero or no usage as low stock", () => {
    const result = calculateLowStockParts(
      [
        { partId: "part-b", partName: "配件B", quantity: 0 },
        { partId: "part-c", partName: "配件C", quantity: 0 }
      ],
      [{ partId: "part-b", quantity: 0 }],
      30,
      10
    );

    expect(result).toEqual([]);
  });

  it("throws when low-stock usage quantity is invalid", () => {
    expect(() =>
      calculateLowStockParts(
        [{ partId: "part-b", partName: "配件B", quantity: 18 }],
        [{ partId: "part-b", quantity: -1 }],
        30,
        10
      )
    ).toThrow("配件消耗数量必须为非负整数：part-b");
    expect(() =>
      calculateLowStockParts(
        [{ partId: "part-c", partName: "配件C", quantity: 18 }],
        [{ partId: "part-c", quantity: 1.5 }],
        30,
        10
      )
    ).toThrow("配件消耗数量必须为非负整数：part-c");
  });

  it("throws when stock quantity is invalid for low-stock calculation", () => {
    expect(() =>
      calculateLowStockParts(
        [{ partId: "part-b", partName: "配件B", quantity: -1 }],
        [{ partId: "part-b", quantity: 60 }],
        30,
        10
      )
    ).toThrow("配件库存数量必须为非负整数：part-b");
    expect(() =>
      calculateLowStockParts(
        [{ partId: "part-c", partName: "配件C", quantity: 1.5 }],
        [{ partId: "part-c", quantity: 60 }],
        30,
        10
      )
    ).toThrow("配件库存数量必须为非负整数：part-c");
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

  it("throws when stocktake quantity is invalid", () => {
    const stock = { partId: "part-b", quantity: 20, remark: null, lastStocktakeAt: null };

    expect(() => applyStocktake(stock, -1, "盘点异常", "2026-05-29T09:00:00.000Z")).toThrow(
      "盘点数量必须为非负整数"
    );
    expect(() => applyStocktake(stock, 1.5, "盘点异常", "2026-05-29T09:00:00.000Z")).toThrow(
      "盘点数量必须为非负整数"
    );
  });
});
