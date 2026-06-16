import { expect, test } from "@playwright/test";

test("authenticated inventory shell exposes confirmed modules", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("账号").fill("admin");
  await page.getByLabel("密码").fill("admin123");
  await page.getByRole("button", { name: "登录" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "伯尼科技" })).toBeVisible();
  await expect(page.getByText("ERP 系统 / 首页")).toBeVisible();
  await expect(page.getByRole("button", { name: /待入库订单/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "产品组装" })).toBeVisible();
  await expect(page.getByRole("button", { name: "出库管理" })).toBeVisible();
  await expect(page.getByRole("button", { name: "财务管理" })).toHaveCount(0);
});
