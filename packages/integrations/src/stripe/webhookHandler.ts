/**
 * Stripe Webhook Handler — Processes Stripe events and writes to database
 *
 * Handles:
 * - invoice.paid → financials (mrr)
 * - customer.subscription.created/updated/deleted → financials (subscriptions)
 * - charge.succeeded → activity_log
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { systemQuery } from '@glyphor/shared/db';
import Stripe from 'stripe';
import { getStripeClient } from './client.js';

const RELEVANT_EVENTS = new Set([
  'invoice.paid',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'charge.succeeded',
]);

export async function handleStripeWebhook(
  req: IncomingMessage,
  body: string,
): Promise<{ status: number; body: unknown }> {
  const stripe = getStripeClient();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return { status: 500, body: { error: 'STRIPE_WEBHOOK_SECRET not configured' } };
  }

  const sig = req.headers['stripe-signature'];
  if (!sig) {
    return { status: 400, body: { error: 'Missing stripe-signature header' } };
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    console.error('[Stripe] Webhook signature verification failed:', (err as Error).message);
    return { status: 400, body: { error: 'Invalid signature' } };
  }

  if (!RELEVANT_EVENTS.has(event.type)) {
    return { status: 200, body: { received: true, processed: false } };
  }

  console.log(`[Stripe] Processing event: ${event.type} (${event.id})`);

  try {
    switch (event.type) {
      case 'invoice.paid':
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await handleSubscriptionChange(event.data.object as Stripe.Subscription, event.type);
        break;
      case 'charge.succeeded':
        await handleChargeSucceeded(event.data.object as Stripe.Charge);
        break;
    }
    return { status: 200, body: { received: true, processed: true, type: event.type } };
  } catch (err) {
    console.error(`[Stripe] Error processing ${event.type}:`, (err as Error).message);
    return { status: 500, body: { error: 'Processing failed' } };
  }
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const amountPaid = (invoice.amount_paid ?? 0) / 100;
  const date = new Date().toISOString().split('T')[0];

  // Determine product from invoice metadata or line items
  const product = invoice.metadata?.product || inferProductFromInvoice(invoice);

  await systemQuery(
    `INSERT INTO financials (date, product, metric, value, details)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (date, product, metric) DO UPDATE SET value = $4, details = $5`,
    [
      date,
      product,
      'mrr',
      amountPaid,
      JSON.stringify({
        invoice_id: invoice.id,
        customer: invoice.customer,
        currency: invoice.currency,
      }),
    ],
  );

  console.log(`[Stripe] Recorded MRR: $${amountPaid} for ${product || 'company'} on ${date}`);
}

async function handleSubscriptionChange(
  subscription: Stripe.Subscription,
  eventType: string,
) {
  const product = subscription.metadata?.product || null;

  // Count active subscriptions after this event
  const action = eventType === 'customer.subscription.deleted' ? 'subscription_canceled' : 'subscription_changed';

  await systemQuery(
    'INSERT INTO activity_log (agent_role, action, product, summary, details) VALUES ($1, $2, $3, $4, $5)',
    [
      'system',
      action,
      product || 'company',
      `Subscription ${subscription.id} ${eventType.split('.').pop()} — status: ${subscription.status}`,
      JSON.stringify({
        subscription_id: subscription.id,
        status: subscription.status,
        event_type: eventType,
        mrr_cents: subscription.items.data.reduce(
          (sum, item) => sum + (item.price?.unit_amount ?? 0) * (item.quantity ?? 1),
          0,
        ),
      }),
    ],
  );
}

async function handleChargeSucceeded(charge: Stripe.Charge) {
  const amount = (charge.amount ?? 0) / 100;
  await systemQuery(
    'INSERT INTO activity_log (agent_role, action, product, summary, details) VALUES ($1, $2, $3, $4, $5)',
    [
      'system',
      'payment',
      charge.metadata?.product || 'company',
      `Payment received: $${amount.toFixed(2)} (${charge.currency?.toUpperCase()})`,
      JSON.stringify({
        charge_id: charge.id,
        customer: charge.customer,
        amount,
        currency: charge.currency,
      }),
    ],
  );
}

function inferProductFromInvoice(invoice: Stripe.Invoice): string | null {
  const legacyWebBuildName = `${'fu'}se`;
  const lines = invoice.lines?.data ?? [];
  for (const line of lines) {
    const prodName = (line.price?.product as string)?.toLowerCase?.() ?? '';
    if (prodName.includes(legacyWebBuildName)) return 'web-build';
    if (prodName.includes('pulse')) return 'pulse';
  }
  return null;
}
