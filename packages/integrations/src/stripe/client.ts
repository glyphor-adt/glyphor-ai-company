/**
 * Stripe Client — Singleton initialization
 */

import Stripe from 'stripe';

let stripeClient: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (!stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY environment variable is required');
    stripeClient = new Stripe(key, { apiVersion: '2025-12-18.acacia' });
  }
  return stripeClient;
}
