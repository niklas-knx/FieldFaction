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
    await mockGameServer(page, freshGameState(), true);
    await page.goto('/');

    await page.fill('#f-login', 'testuser');
    await page.fill('#f-password', 'correct-password');
    await page.click('.auth-submit');

    await expect(page.locator('.field-card').first()).toBeVisible();
  });

  test('registers a new account and reaches the farm screen', async ({ page }) => {
    await mockAuth(page);
    await mockGameServer(page, freshGameState(), true);
    await page.goto('/');

    await page.click('#tab-register');
    await page.fill('#f-username', 'brandnewuser');
    await page.fill('#f-email', 'new@example.com');
    await page.fill('#f-password', 'supersecure1');
    await page.click('.auth-submit');

    await expect(page.locator('.field-card').first()).toBeVisible();
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
