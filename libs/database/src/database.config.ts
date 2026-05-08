import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { existsSync } from 'fs';

function resolveDatabaseHost(host: string | undefined): string {
  const resolvedHost = host || '127.0.0.1';

  if (resolvedHost !== 'postgres') {
    return resolvedHost;
  }

  return existsSync('/.dockerenv') ? resolvedHost : '127.0.0.1';
}

export const getDatabaseConfig = (
  configService: ConfigService,
  entities: any[],
  migrations: any[] = [],
): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: resolveDatabaseHost(configService.get<string>('DB_HOST')),
  port: configService.get<number>('DB_PORT'),
  username: configService.get<string>('DB_USERNAME'),
  password: configService.get<string>('DB_PASSWORD'),
  database: configService.get<string>('DB_NAME'),
  entities,
  synchronize: configService.get<string>('NODE_ENV') === 'development',
  logging: configService.get<string>('NODE_ENV') === 'development',
  migrations,
  migrationsRun: false,
  ssl: configService.get<string>('NODE_ENV') === 'production',
  poolSize: 10,
  extra: {
    max: 10,
    connectionTimeoutMillis: 5000,
  },
});
