import { expect, test } from "@playwright/test";

test("loads the login shell", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "伯尼科技" })).toBeVisible();
  await expect(page.getByText("新用户请联系管理员开通账号")).toBeVisible();
  await expect(page.getByLabel("账号")).toBeVisible();
  await expect(page.getByLabel("密码")).toBeVisible();
});
