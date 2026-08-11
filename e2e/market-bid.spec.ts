import { test, expect } from '@playwright/test';
import { mockAuth, mockGameServer, mockMarket, freshGameState, loginAsTestUser } from './fixtures';

const REQUEST = {
  id: 42,
  city: 'muenchen',
  merchantId: 'grosshandel',
  productId: 'wheat',
  quantity: 500,
  maxPricePerUnit: 0.25,
  expiresAt: Date.now() + 5 * 60 * 1000,
  bidCount: 0,
};

test.describe('Market bid flow', () => {
  test('submits a bid for an open request using storage the farm actually has', async ({ page }) => {
    await mockAuth(page);
    // Farm starts with 1000kg of wheat in storage so a bid can be filled.
    await mockGameServer(page, freshGameState({ wheat: 1000 }));

    let submittedBid: any = null;
    await mockMarket(page, {
      requests: [REQUEST],
      onBidSubmit: body => { submittedBid = body; },
    });

    await loginAsTestUser(page);

    await page.click('#nav-market-btn');
    await expect(page.locator('.market-tab-btn.market-tab-active')).toContainText('Anfragen');

    const requestCard = page.locator('.request-card', { hasText: 'Weizen' });
    await expect(requestCard).toBeVisible();
    await requestCard.locator('.request-card-main').click();

    const bidForm = requestCard.locator('.bid-form');
    await expect(bidForm).toBeVisible();
    await bidForm.locator('.bid-qty-inp').fill('200');

    await bidForm.locator('.bid-submit-btn').click();

    await expect.poll(() => submittedBid).not.toBeNull();
    expect(submittedBid).toMatchObject({
      requestId: 42,
      farmId: 'muenchen',
      quantityOffered: 200,
    });
    expect(submittedBid.pricePerUnit).toBeGreaterThan(0);
    expect(submittedBid.pricePerUnit).toBeLessThanOrEqual(REQUEST.maxPricePerUnit);
  });

  test('blocks a bid quantity larger than what is in storage', async ({ page }) => {
    await mockAuth(page);
    // Only 50kg in storage, far less than the 500kg the request asks for.
    await mockGameServer(page, freshGameState({ wheat: 50 }));

    let submittedBid: any = null;
    await mockMarket(page, {
      requests: [REQUEST],
      onBidSubmit: body => { submittedBid = body; },
    });

    await loginAsTestUser(page);
    await page.click('#nav-market-btn');

    const requestCard = page.locator('.request-card', { hasText: 'Weizen' });
    await requestCard.locator('.request-card-main').click();
    const bidForm = requestCard.locator('.bid-form');
    await bidForm.locator('.bid-qty-inp').fill('500');
    await bidForm.locator('.bid-submit-btn').click();

    // Client-side guard rejects it before any network call is made.
    await expect(page.locator('#notification')).toContainText('Nicht genug im Lager');
    expect(submittedBid).toBeNull();
  });
});
