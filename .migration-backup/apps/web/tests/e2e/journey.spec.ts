import { expect, test } from "@playwright/test";

test.describe("main apply journey gates", () => {
  test("signup starts onboarding and never skips consent", async ({ page }) => {
    await page.goto("/sign-up");
    await expect(page.getByRole("heading", { name: /create your memory/i })).toBeVisible();
    await expect(page.getByText(/confirm how 1-Apply may use your documents/i)).toBeVisible();
  });

  test("unauthenticated users cannot open memory, documents, opportunities, or applications", async ({ page }) => {
    for (const path of [
      "/app",
      "/app/memory",
      "/app/documents",
      "/app/opportunities",
      "/app/applications",
      "/app/onboarding/consent",
      "/app/onboarding/profile",
      "/app/onboarding/documents",
      "/app/onboarding/review",
    ]) {
      await page.goto(path);
      await expect(page).toHaveURL(/sign-in/);
    }
  });

  test("marketing journey names memory, fit, resume match, answers, and tracking", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/application memory/i).first()).toBeVisible();
    await expect(page.getByText(/fit index/i).first()).toBeVisible();
    await expect(page.getByText(/match resume/i)).toBeVisible();
    await expect(page.getByText(/evidence only/i)).toBeVisible();
    await expect(page.getByText(/track deadline/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /create your memory/i }).first()).toHaveAttribute("href", "/sign-up");
  });
});
