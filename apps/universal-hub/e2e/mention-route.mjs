/**
 * Post the design example and prove chips, assignment, and pings.
 * Run against a running Singularity (BASE_URL). Default is the Vite preview.
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const base = process.env.BASE_URL ?? "http://127.0.0.1:5173/";
const out = new URL("../screenshots/", import.meta.url);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on("pageerror", (err) => {
  console.error("pageerror", err.message);
  process.exitCode = 1;
});

await page.goto(base);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.getByRole("button", { name: "Enter the seeded fleet as Scotty" }).click();
await page.getByRole("button", { name: "Use the example" }).click();
await page.getByRole("button", { name: "Post", exact: true }).click();
await page.getByText("Assignee Iris").first().waitFor({ timeout: 10000 });
await mkdir(out, { recursive: true });
await page.screenshot({ path: new URL("./e2e-feed-mobile.png", out).pathname });

await page.evaluate(() => {
  location.hash = "#/pings";
});
await page.getByText("Iris · task").waitFor({ timeout: 10000 });
await page.getByText("Cooper · mention").waitFor({ timeout: 10000 });
await page.screenshot({ path: new URL("./e2e-pings-mobile.png", out).pathname });

await page.setViewportSize({ width: 1280, height: 800 });
await page.evaluate(() => {
  location.hash = "#/o/goal-001-example";
});
await page.getByText("Stand up Singularity as the fleet hub").waitFor();
await page.screenshot({ path: new URL("./e2e-goal-desktop.png", out).pathname });

if (process.exitCode) {
  console.error("E2E failed");
  await browser.close();
  process.exit(process.exitCode);
}
console.log("E2E pass: post, chip assign, pings");
await browser.close();
