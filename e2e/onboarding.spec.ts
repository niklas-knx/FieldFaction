import { test, expect } from '@playwright/test';
import { mockAuth, mockGameServer, mockMarket, verificationLinkFor, mockCitySearch } from './fixtures';

// End-to-end journey through the pieces added for the email-verification +
// choose-your-starting-city work: register -> "check your email" -> click the
// verification link -> pick a starting city -> land on a farm at that city.
// mockGameServer starts with no state at all (brand new, verified account), so the
// app must show the location picker before any farm view — exactly like the real
// server's `{newGame: true}` (no `state`) response.

test.describe('Onboarding: register -> verify -> choose starting location', () => {
  test('full journey from registration to a farm at the chosen city', async ({ page }) => {
    await mockAuth(page);
    await mockGameServer(page);
    await mockMarket(page);
    await mockCitySearch(page, 'Hamburg', 53.55, 9.99);

    await page.goto('/');
    await page.click('#tab-register');
    await page.fill('#f-username', 'newplayer');
    await page.fill('#f-email', 'newplayer@example.com');
    await page.fill('#f-password', 'supersecure1');
    await page.click('.auth-submit');

    await expect(page.locator('.auth-check-email')).toBeVisible();
    await expect(page.locator('.field-card')).toHaveCount(0);

    // Klick auf den per Mail verschickten Bestätigungslink
    await page.goto(verificationLinkFor('newplayer'));

    // Kein Spielstand vorhanden -> Startort-Auswahl statt Hof-Ansicht
    await expect(page.locator('.start-loc-root')).toBeVisible();
    await expect(page.locator('#start-loc-confirm')).toBeDisabled();

    await page.fill('#start-loc-city', 'Hamburg');
    const result = page.locator('.new-loc-dd-item').first();
    await expect(result).toBeVisible();
    await expect(result).toContainText('Hamburg');
    await result.click();

    await expect(page.locator('#start-loc-confirm')).toBeEnabled();
    await page.click('#start-loc-confirm');

    const firstPlot = page.locator('.field-card').first();
    await expect(firstPlot).toBeVisible();
  });
});
