import { existsSync } from 'fs';

export function resolveDockerHostname(hostname: string, dockerHostname: string, localHostname = '127.0.0.1'): string {
  if (hostname !== dockerHostname) {
    return hostname;
  }

  return existsSync('/.dockerenv') ? hostname : localHostname;
}

export function resolveRabbitMqUrl(url: string | undefined): string {
  const fallback = 'amqp://admin:admin@localhost:5672';
  const value = url || fallback;

  try {
    const parsed = new URL(value);
    parsed.hostname = resolveDockerHostname(parsed.hostname, 'rabbitmq', 'localhost');
    return parsed.toString();
  } catch {
    return value;
  }
}
