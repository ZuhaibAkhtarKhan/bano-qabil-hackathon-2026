import { expect, test } from "@playwright/test";

test("marketing homepage renders the product promise", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /grounded AI/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /get started/i }).first()).toBeVisible();
});

test("sign-in is reachable and app routes stay gated", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /forgot password/i })).toBeVisible();
  await page.goto("/app");
  await expect(page).toHaveURL(/sign-in/);
});

test("sign-up advertises onboarding path", async ({ page }) => {
  await page.goto("/sign-up");
  await expect(page.getByRole("heading", { name: /create your memory/i })).toBeVisible();
  await expect(page.getByText(/confirm how 1-Apply may use your documents/i)).toBeVisible();
});

test("forgot password page is reachable", async ({ page }) => {
  await page.goto("/forgot-password");
  await expect(page.getByRole("heading", { name: /reset your password/i })).toBeVisible();
});
