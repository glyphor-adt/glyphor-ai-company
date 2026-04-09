/**
 * Ensures recipients of inter-agent messages are picked up by the scheduler heartbeat.
 *
 * GlyphorEventBus.emit(message.sent) only persists to Postgres — it does not invoke
 * WakeRouter unless Pub/Sub push to /event is configured (agent runs use GlyphorEventBus({})).
 * Without a row in agent_wake_queue, recipients wait for the generic work_loop to notice
 * pending messages, and the heartbeat run-gap could defer that indefinitely.
 */

import { systemQuery } from '@glyphor/shared/db';

export async function queueAgentMessageWake(params: {
  toAgent: string;
  fromAgent: string;
  messageId: string;
  message: string;
  priority: string;
  threadId: string;
  messageType: string;
}): Promise<void> {
  const { toAgent, fromAgent, messageId, message, priority, threadId, messageType } = params;
  const isUrgent = priority === 'urgent';
  const task = isUrgent ? 'urgent_message_response' : 'work_loop';
  const reason = isUrgent ? 'agent_message' : 'message.sent';
  const context = {
    message_id: messageId,
    to_agent: toAgent,
    from_agent: fromAgent,
    message,
    priority,
    thread_id: threadId,
    message_type: messageType,
    wake_reason: isUrgent
      ? `Urgent message from ${fromAgent}`
      : `New message from ${fromAgent}`,
  };

  try {
    await systemQuery(
      `INSERT INTO agent_wake_queue (agent_role, task, reason, context, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [toAgent, task, reason, JSON.stringify(context), 'pending'],
    );
  } catch (err) {
    console.warn('[queueAgentMessageWake] failed:', (err as Error).message);
  }
}
