import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { existsSync } from 'fs';

config();

const dbHost = process.env.DB_HOST || 'localhost';
const resolvedDbHost = dbHost === 'postgres' && !existsSync('/.dockerenv') ? '127.0.0.1' : dbHost;

export default new DataSource({
  type: 'postgres',
  host: resolvedDbHost,
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'flight_booking',
  entities: ['apps/**/entities/*.entity{.ts,.js}'],
  migrations: ['migrations/*{.ts,.js}'],
  synchronize: false,
  logging: process.env.NODE_ENV === 'development',
});
