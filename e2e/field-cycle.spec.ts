import { test, expect } from '@playwright/test';
import { mockAuth, mockGameServer, freshGameState, mockMarket, loginAsTestUser } from './fixtures';

// A crop's growth phase takes real-world days (see src/farm/Farm.ts FIELD_WORK_TICKS /
// growthTicks, 1 tick = 1 real second), so a browser e2e test can only cover the
// instant UI transitions (empty -> fallow -> tilling started). The full deterministic
// cycle through to harvest is covered by the fast tick-loop unit test in src/farm/Farm.test.ts.
//
// Since Issue #7, every click round-trips through POST /game/action — mockGameServer
// applies the real Farm.ts reducers against a mutable in-memory state, just like the
// real server does, so these assertions still exercise production game logic.

test.describe('Field interactions', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await mockGameServer(page, freshGameState());
    await mockMarket(page);
    await loginAsTestUser(page);
  });

  test('designating an empty plot as a field turns it fallow', async ({ page }) => {
    const firstPlot = page.locator('.field-card').first();
    await expect(firstPlot).toHaveClass(/field-card-empty/);

    await firstPlot.click();
    await expect(page.locator('#plot-use-picker')).toBeVisible();

    await page.click('#pup-field');
    await expect(firstPlot).toHaveClass(/field-card-fallow/);
    await expect(page.locator('#plot-use-picker')).toBeHidden();
  });

  test('clicking a fallow field starts tilling using the starter tractor and plow', async ({ page }) => {
    const firstPlot = page.locator('.field-card').first();
    await firstPlot.click();
    await page.click('#pup-field');
    await expect(firstPlot).toHaveClass(/field-card-fallow/);

    await firstPlot.click();
    await expect(firstPlot).toHaveClass(/field-card-being_tilled/);
    await expect(firstPlot).toContainText('Pflügen');

    // Busy fields are not clickable again while an action is in progress
    await expect(firstPlot.locator('.fc-body-working')).toBeVisible();
  });
});
