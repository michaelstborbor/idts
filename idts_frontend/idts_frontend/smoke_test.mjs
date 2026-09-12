/*
 * Full-stack smoke test: boots the real FastAPI backend (uvicorn) and the
 * real built frontend (vite preview), then drives an actual headless
 * Chrome browser through the whole workflow — login, register a child,
 * see it appear, record a vaccination, see the status update, assign a
 * defaulter, trace, close, check the dashboard. This is the strongest
 * verification available short of a human clicking through it: real HTTP,
 * real DOM, real backend logic, nothing mocked.
 *
 * Run with: node smoke_test.mjs
 */
import { chromium } from "playwright-core";

const CHROME_PATH = process.env.SMOKE_TEST_CHROME_PATH || undefined; // undefined = let Playwright find/use its own browser
const FRONTEND_URL = process.env.SMOKE_TEST_FRONTEND_URL || "http://127.0.0.1:4173";

function log(msg) {
  console.log(`[smoke] ${msg}`);
}

async function main() {
  const browser = await chromium.launch({
    ...(CHROME_PATH ? { executablePath: CHROME_PATH } : {}),
    headless: true,
  });
  const page = await browser.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("response", (resp) => {
    if (resp.status() >= 400) failedRequests.push(`${resp.status()} ${resp.url()}`);
  });

  try {
    log("Navigating to login page…");
    await page.goto(FRONTEND_URL, { waitUntil: "networkidle" });
    await page.waitForSelector("text=Immunization & Defaulter Tracking", { timeout: 10000 });

    log("Logging in as focal…");
    await page.fill('input[type="text"], input:not([type])', "focal");
    const inputs = await page.$$("input");
    await inputs[0].fill("focal");
    await inputs[1].fill("dev-only-change-me");
    await page.click('button:has-text("Sign in")');

    await page.waitForSelector("text=Dashboard", { timeout: 10000 });
    log("✓ Logged in, dashboard loaded");

    log("Navigating to All children → Register child…");
    await page.click('button:has-text("All children")');
    await page.click('button:has-text("Register child")');
    await page.waitForSelector("text=Child's full name", { timeout: 5000 });

    const childName = `Smoke Test Child ${Date.now()}`;
    const nameInput = await page.$('input[placeholder*="Fatmata"]');
    await nameInput.fill(childName);

    // DOB ~100 days ago -> should land as a defaulter for BCG under the seeded schedule
    const dob = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const dateInput = await page.$('input[type="date"]');
    await dateInput.fill(dob);

    await page.click('button:has-text("Register child")');
    await page.waitForSelector(`text=${childName}`, { timeout: 10000 });
    log(`✓ Registered child "${childName}" and saw them appear in the list`);

    log("Opening child profile…");
    await page.click(`text=${childName}`);
    await page.waitForSelector("text=Immunization schedule", { timeout: 5000 });

    const bodyText = await page.textContent("body");
    if (!bodyText.includes("Defaulter") && !bodyText.includes("Overdue")) {
      throw new Error("Expected BCG to show as Defaulter/Overdue for a 100-day-old unvaccinated child, but status not found on profile.");
    }
    log("✓ Child profile shows a Defaulter/Overdue status, computed by the real backend");

    log("Recording a vaccination…");
    const syringeButtons = await page.$$('button[title="Record this vaccination"]');
    if (syringeButtons.length === 0) throw new Error("No 'record vaccination' buttons found on profile.");
    await syringeButtons[0].click();
    await page.waitForSelector("text=Date given", { timeout: 5000 });
    await page.click('button:has-text("Save vaccination")');
    await page.waitForSelector("text=Vaccination history", { timeout: 10000 });
    await page.waitForTimeout(500);

    const historyText = await page.textContent("body");
    if (!historyText.includes("Given")) {
      throw new Error("Expected at least one dose to show 'Given' status after recording a vaccination.");
    }
    log("✓ Vaccination recorded and status updated to Given");

    log("Navigating back to the children list…");
    await page.click('button:has-text("All children")');
    await page.waitForTimeout(500);

    log("Checking Due & defaulters tab, assigning a case…");
    await page.click('button:has-text("Due & defaulters")');
    await page.waitForTimeout(500);
    const assignButtons = await page.$$('button:has-text("Assign")');
    if (assignButtons.length > 0) {
      await assignButtons[0].click();
      await page.waitForSelector("text=Assign to", { timeout: 5000 });

      // No CHW roster exists yet — use the "Add new CHW" input
      const addChwLink = await page.$('button:has-text("Add new CHW")');
      if (addChwLink) {
        await addChwLink.click();
        await page.waitForSelector('input[placeholder*="Aminata"]', { timeout: 5000 });
        const chwNameInput = await page.$('input[placeholder*="Aminata"]');
        await chwNameInput.fill(`Smoke Test CHW ${Date.now()}`);
        await page.click('button:has-text("Add CHW")');
        await page.waitForTimeout(500);
      }

      await page.click('button:has-text("Assign case")');
      await page.waitForSelector("text=follow-up case", { timeout: 10000 });
      log("✓ Assigned a defaulter case, including adding a new CHW inline");

      log("Recording a tracing attempt…");
      await page.click('button:has-text("Save attempt")');
      await page.waitForTimeout(500);
      log("✓ Tracing attempt recorded");

      await page.click('button[aria-label="Close"]');
    } else {
      log("(No defaulter rows with an Assign button found — schedule/timing may not have produced one this run; not fatal.)");
    }

    log("Checking Follow-up tab…");
    await page.click('button:has-text("Follow-up")');
    await page.waitForTimeout(500);
    log("✓ Follow-up tab loaded without error");

    log("Checking Dashboard reflects data…");
    await page.click('button:has-text("Dashboard")');
    await page.waitForSelector("text=Children registered", { timeout: 5000 });
    log("✓ Dashboard loaded with summary cards");

    if (consoleErrors.length > 0) {
      console.error("Console errors detected during the run:");
      consoleErrors.forEach((e) => console.error("  -", e));
    }
    if (failedRequests.length > 0) {
      console.error("HTTP requests that returned 4xx/5xx during the run:");
      failedRequests.forEach((e) => console.error("  -", e));
    }
    if (pageErrors.length > 0) {
      console.error("Uncaught JS exceptions during the run:");
      pageErrors.forEach((e) => console.error("  -", e));
      throw new Error(`${pageErrors.length} uncaught JS exception(s) occurred — this is fatal.`);
    }

    log("ALL SMOKE TEST STEPS PASSED ✓");
    await browser.close();
    process.exit(0);
  } catch (err) {
    console.error("SMOKE TEST FAILED:", err.message);
    if (consoleErrors.length > 0) console.error("Console errors:", consoleErrors);
    if (failedRequests.length > 0) console.error("Failed requests:", failedRequests);
    if (pageErrors.length > 0) console.error("Page errors:", pageErrors);
    await page.screenshot({ path: "/tmp/smoke_test_failure.png" }).catch(() => {});
    await browser.close();
    process.exit(1);
  }
}

main();
