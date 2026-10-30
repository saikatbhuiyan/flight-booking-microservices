/**
 * Replays dead-lettered event messages to the exchange/routing key they originally came from (read from the x-death
 * header RabbitMQ adds when it dead-letters). Messages without x-death (e.g. booking's outbox DLQ publishes) cannot be
 * routed back and are left in place.
 *
 *   npm run dlq:replay -- --queue booking.dead-letter                # dry run: list what would be replayed
 *   npm run dlq:replay -- --queue booking.dead-letter --limit 5 --execute
 *
 * Consumers are idempotent (processed events / Redis claims), so replaying a message twice is safe.
 */
import { connect, GetMessage } from 'amqplib';
import { resolveRabbitMqUrl } from '@app/common';

interface XDeath {
  exchange?: string;
  'routing-keys'?: string[];
  queue?: string;
  reason?: string;
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

export function originOf(message: GetMessage): { exchange: string; routingKey: string; from?: string } | null {
  const deaths = message.properties.headers?.['x-death'] as XDeath[] | undefined;
  const first = deaths?.[deaths.length - 1]; // x-death is most-recent-first; the last entry is the original hop
  if (!first?.exchange || !first['routing-keys']?.length) {
    return null;
  }
  return { exchange: first.exchange, routingKey: first['routing-keys'][0], from: first.queue };
}

async function main(): Promise<void> {
  const queue = arg('queue');
  const limit = Number(arg('limit') ?? 10);
  const execute = process.argv.includes('--execute');
  if (!queue || !Number.isInteger(limit) || limit < 1) {
    throw new Error('Usage: dlq:replay -- --queue <dead-letter queue> [--limit <n>=10] [--execute]');
  }

  const connection = await connect(resolveRabbitMqUrl(process.env.RABBITMQ_URL));
  const channel = await connection.createConfirmChannel();
  const held: GetMessage[] = [];
  let replayed = 0;
  let skipped = 0;

  try {
    // Messages stay unacked until the end, so each one is visited once even when it is put back.
    for (let i = 0; i < limit; i++) {
      const message = await channel.get(queue, { noAck: false });
      if (!message) break;

      const origin = originOf(message);
      const label = `${message.fields.routingKey} (${message.properties.messageId ?? message.fields.deliveryTag})`;
      if (!origin) {
        console.log(`skip    ${label}: no x-death origin`);
        held.push(message);
        skipped++;
        continue;
      }

      console.log(`${execute ? 'replay ' : 'would  '} ${label} -> ${origin.exchange} / ${origin.routingKey}`);
      if (!execute) {
        held.push(message);
        continue;
      }

      const headers = { ...message.properties.headers };
      delete headers['x-death'];
      channel.publish(origin.exchange, origin.routingKey, message.content, { ...message.properties, headers });
      await channel.waitForConfirms();
      channel.ack(message);
      replayed++;
    }
  } finally {
    held.forEach((message) => channel.nack(message, false, true));
    await channel.close();
    await connection.close();
  }

  console.log(`${execute ? 'replayed' : 'dry run:'} ${execute ? replayed : held.length - skipped}, skipped ${skipped}`);
}

if (require.main === module) {
  main().catch((error: Error) => {
    console.error(error.message);
    process.exit(1);
  });
}
