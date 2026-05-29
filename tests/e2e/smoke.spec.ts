import { expect, test } from "@playwright/test";

test("loads the scaffold shell", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "伯尼进销存系统" })).toBeVisible();
});
