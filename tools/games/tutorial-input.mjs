/** Deliberate walkthrough input; rapid-input regressions bypass this helper.
 * Let the browser's native double-tap count reset between new explanations.
 */
export async function advanceTutorial(page, touch = false) {
  if (touch) await page.waitForTimeout(700);
  const next = page.locator('#tutorial-next');
  if (touch) await next.tap(); else await next.click();
}
