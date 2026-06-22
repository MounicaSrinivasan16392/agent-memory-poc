/**
 * RabbitMQ job publisher (memory-api) and consumer (worker).
 * Routing keys: memory.summarize, memory.session_end
 */
import amqp from "amqplib";
import { config } from "../config.js";

async function createJobPublisher() {
  try {
    const conn = await amqp.connect(config.rabbitmq.url);
    const channel = await conn.createChannel();
    await channel.assertExchange(config.rabbitmq.exchange, "topic", { durable: true });
    return {
      async publish(routingKey, payload) {
        channel.publish(
          config.rabbitmq.exchange,
          routingKey,
          Buffer.from(JSON.stringify(payload)),
          { persistent: true, contentType: "application/json" }
        );
      }
    };
  } catch (err) {
    throw new Error(
      `[memory] RabbitMQ required at ${config.rabbitmq.url} \u2014 run docker compose up rabbitmq and npm run worker. ${err}`
    );
  }
}

async function startJobConsumer(handler) {
  const conn = await amqp.connect(config.rabbitmq.url);
  const channel = await conn.createChannel();
  await channel.assertExchange(config.rabbitmq.exchange, "topic", { durable: true });
  await channel.assertQueue(config.rabbitmq.queue, { durable: true });
  await channel.bindQueue(config.rabbitmq.queue, config.rabbitmq.exchange, "memory.#");
  await channel.consume(config.rabbitmq.queue, async (msg) => {
    if (!msg) return;
    const routingKey = msg.fields.routingKey;
    const payload = JSON.parse(msg.content.toString());
    try {
      await handler(routingKey, payload);
      channel.ack(msg);
    } catch (err) {
      console.error(`[memory-worker] job failed ${routingKey}:`, err);
      channel.nack(msg, false, false);
    }
  });
  console.log(`[memory-worker] listening on ${config.rabbitmq.queue} (memory.#)`);
}
export {
  createJobPublisher,
  startJobConsumer
};
