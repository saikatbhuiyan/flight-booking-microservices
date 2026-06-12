import { Request } from 'express';
import { Role } from '../enums';

// Base Entity Interface
export interface IBaseEntity {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

// API Response Wrapper
export interface IApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  errors?: any[];
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
  };
}

// Pagination
export interface IPaginationOptions {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
}

export interface IPaginatedResult<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Message Broker
export interface IMessageBroker {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  publish<TInput>(pattern: string, data: TInput): Promise<void>;
  subscribe<TInput>(pattern: string, handler: (data: TInput) => Promise<void>): Promise<void>;
  emit<TInput>(pattern: string, data: TInput): void;
}

// Storage
export interface IStorageProvider {
  uploadFile(file: IFileUpload): Promise<IFileUploadResult>;
  downloadFile(key: string): Promise<Buffer>;
  deleteFile(key: string): Promise<void>;
  getSignedUrl(key: string, expiresIn?: number): Promise<string>;
  listFiles(prefix?: string): Promise<string[]>;
}

export interface IFileUpload {
  buffer: Buffer;
  originalName: string;
  mimetype: string;
  size: number;
  folder?: string;
}

export interface IFileUploadResult {
  key: string;
  url: string;
  bucket: string;
  size: number;
}

// Cache
export interface ICacheService {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: any, ttl?: number): Promise<void>;
  del(key: string): Promise<void>;
  reset(): Promise<void>;
  keys(pattern: string): Promise<string[]>;
}

// User
export interface IUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  isActive: boolean;
}

// JWT Payload
export interface IJwtPayload {
  sub: string;
  email: string;
  role: Role;
  iat?: number;
  exp?: number;
}

// Service Communication Patterns
export enum MessagePatterns {
  // Auth patterns
  AUTH_REGISTER = 'auth.register',
  AUTH_LOGIN = 'auth.login',
  AUTH_SIGNOUT = 'auth.signout',
  AUTH_VALIDATE = 'auth.validate',
  AUTH_REFRESH = 'auth.refresh',

  // User patterns
  USER_CREATE = 'user.create',
  USER_FIND_BY_ID = 'user.findById',
  USER_FIND_BY_EMAIL = 'user.findByEmail',
  USER_UPDATE = 'user.update',
  USER_DELETE = 'user.delete',

  // Flight patterns
  FLIGHT_CREATE = 'flight.create',
  FLIGHT_FIND_ALL = 'flight.findAll',
  FLIGHT_FIND_BY_ID = 'flight.findById',
  FLIGHT_SEARCH = 'flight.search.v2',
  FLIGHT_UPDATE = 'flight.update',
  FLIGHT_DELETE = 'flight.delete',

  // City patterns
  CITY_CREATE = 'city.create',
  CITY_FIND_ALL = 'city.findAll',
  CITY_FIND_BY_ID = 'city.findById',
  CITY_UPDATE = 'city.update',
  CITY_DELETE = 'city.delete',
  CITY_STATISTICS = 'city.statistics',

  // Airport patterns
  AIRPORT_CREATE = 'airport.create',
  AIRPORT_FIND_ALL = 'airport.findAll',
  AIRPORT_FIND_BY_ID = 'airport.findById',
  AIRPORT_SEARCH = 'airport.search',
  AIRPORT_UPDATE = 'airport.update',
  AIRPORT_DELETE = 'airport.delete',

  // Airplane patterns
  AIRPLANE_CREATE = 'airplane.create',
  AIRPLANE_FIND_ALL = 'airplane.findAll',
  AIRPLANE_FIND_BY_ID = 'airplane.findById',
  AIRPLANE_UPDATE = 'airplane.update',
  AIRPLANE_DELETE = 'airplane.delete',
  AIRPLANE_GET_SEATS = 'airplane.getSeats',

  // Seat patterns
  SEAT_CREATE = 'seat.create',
  SEAT_FIND_ALL = 'seat.findAll',
  SEAT_FIND_BY_ID = 'seat.findById',
  SEAT_UPDATE = 'seat.update',
  SEAT_DELETE = 'seat.delete',
  SEAT_BULK_CREATE = 'seat.bulkCreate',

  // Booking patterns
  BOOKING_CREATE = 'booking.create',
  BOOKING_FIND_ALL = 'booking.findAll',
  BOOKING_FIND_BY_ID = 'booking.findById',
  BOOKING_FIND_BY_USER = 'booking.findByUser',
  BOOKING_UPDATE = 'booking.update',
  BOOKING_CANCEL = 'booking.cancel',
  BOOKING_COMPLETE = 'booking.complete',
  BOOKING_EXTEND = 'booking.extend',
  BOOKING_CHECK_AVAILABILITY = 'booking.checkAvailability',

  // Notification patterns
  NOTIFICATION_SEND_EMAIL = 'notification.sendEmail',
  NOTIFICATION_SEND_SMS = 'notification.sendSms',

  // Payment patterns
  PAYMENT_CREATE_INTENT = 'payment.create_intent',
  PAYMENT_GET_INTENT = 'payment.get_intent',
  PAYMENT_CONFIRM_INTENT = 'payment.confirm_intent',
  PAYMENT_CREATE_REFUND = 'payment.create_refund',
  PAYMENT_GET_REFUNDS = 'payment.get_refunds',
}

// Events for async communication
export enum EventPatterns {
  USER_REGISTERED = 'user.registered',
  USER_UPDATED = 'user.updated',

  BOOKING_CREATED = 'booking.created',
  BOOKING_CONFIRMED = 'booking.confirmed',
  BOOKING_CANCELLED = 'booking.cancelled',

  PAYMENT_COMPLETED = 'payment.completed',
  PAYMENT_FAILED = 'payment.failed',
  PAYMENT_REFUNDED = 'payment.refunded',

  FLIGHT_RESERVE_SEATS = 'flight.reserve-seats',
  FLIGHT_CONFIRM_SEATS = 'flight.confirm-seats',
  FLIGHT_RELEASE_SEATS = 'flight.release-seats',
}

export interface ActiveUserData {
  /**
   * The "subject" of the token. The value of this property is the user ID
   * that granted this token.
   **/
  sub: number;

  /**
   *  The subject's (user) email.
   **/
  email: string;

  /**
   *  The subject's (user) role.
   **/
  role?: Role;
}

export interface RefreshTokenPayload {
  /**
   * The "subject" of the token. The value of this property is the user ID
   * that granted this token.
   **/
  sub: number;

  /**
   *  The subject's (user) email.
   **/
  email: string;

  refreshTokenId: string;

  deviceId: string;
}

export interface AuthenticatedRequest extends Request {
  user: ActiveUserData;
}
