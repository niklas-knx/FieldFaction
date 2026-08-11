import { test, expect } from '@playwright/test';
import { mockAuth, mockGameServer, freshGameState } from './fixtures';

test.describe('Login & Registration', () => {
  test('shows an error on invalid login credentials', async ({ page }) => {
    await mockAuth(page);
    await page.goto('/');

    await page.fill('#f-login', 'testuser');
    await page.fill('#f-password', 'wrong-password');
    await page.click('.auth-submit');

    await expect(page.locator('#auth-error')).toContainText('Benutzername oder Passwort falsch');
  });

  test('logs in successfully and reaches the farm screen', async ({ page }) => {
    await mockAuth(page);
    await mockGameServer(page, freshGameState());
    await page.goto('/');

    await page.fill('#f-login', 'testuser');
    await page.fill('#f-password', 'correct-password');
    await page.click('.auth-submit');

    await expect(page.locator('.field-card').first()).toBeVisible();
  });

  test('logging in before verifying shows the "check your email" screen with a resend option', async ({ page }) => {
    await mockAuth(page);
    await page.goto('/');

    await page.fill('#f-login', 'unverified');
    await page.fill('#f-password', 'correct-password');
    await page.click('.auth-submit');

    await expect(page.locator('.auth-check-email')).toBeVisible();
    await expect(page.locator('.auth-check-email')).toContainText('unverified');
    await page.click('#resend-verification-btn');
    await expect(page.locator('#resend-verification-btn')).toContainText('Erneut gesendet');
  });

  test('registering shows the "check your email" screen instead of entering the game', async ({ page }) => {
    await mockAuth(page);
    await page.goto('/');

    await page.click('#tab-register');
    await page.fill('#f-username', 'brandnewuser');
    await page.fill('#f-email', 'new@example.com');
    await page.fill('#f-password', 'supersecure1');
    await page.click('.auth-submit');

    await expect(page.locator('.auth-check-email')).toBeVisible();
    await expect(page.locator('.auth-check-email')).toContainText('new@example.com');
    await expect(page.locator('.field-card')).toHaveCount(0);
  });

  test('shows an error when the username is already taken', async ({ page }) => {
    await mockAuth(page);
    await page.goto('/');

    await page.click('#tab-register');
    await page.fill('#f-username', 'taken');
    await page.fill('#f-email', 'taken@example.com');
    await page.fill('#f-password', 'supersecure1');
    await page.click('.auth-submit');

    await expect(page.locator('#auth-error')).toContainText('bereits vergeben');
  });
});
