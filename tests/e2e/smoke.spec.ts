import { expect, test } from "@playwright/test";

test("loads the login shell", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "账号登录" })).toBeVisible();
  await expect(page.getByLabel("账号")).toBeVisible();
  await expect(page.getByLabel("密码")).toBeVisible();
});
