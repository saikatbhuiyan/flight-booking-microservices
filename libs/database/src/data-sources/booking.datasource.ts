import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { existsSync } from 'fs';

config({ path: 'apps/booking-service/.env' });

const dbHost = process.env.DB_HOST || 'localhost';
const resolvedDbHost = dbHost === 'postgres' && !existsSync('/.dockerenv') ? '127.0.0.1' : dbHost;

export default new DataSource({
  type: 'postgres',
  host: resolvedDbHost,
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'booking_db',
  entities: ['apps/booking-service/src/entities/*.entity.ts'],
  migrations: ['apps/booking-service/src/migrations/*.ts'],
  synchronize: false,
});
