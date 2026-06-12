import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { EventPatterns } from '@app/common';
import { DataSource, FindOptionsWhere, MoreThanOrEqual, Repository } from 'typeorm';
import { createHash, randomUUID } from 'crypto';
import { Payment, PaymentStatus } from '../entities/payment.entity';
import { IdempotencyKey, IdempotencyKeyStatus } from '../entities/idempotency-key.entity';
import { LedgerDirection, LedgerEntry, LedgerEntryType } from '../entities/ledger-entry.entity';
import { PaymentAuditLog, AuditAction } from '../entities/payment-audit-log.entity';
import { PaymentGatewayFactory } from '../gateways/gateway.factory';
import { CreatePaymentIntentDto } from '../dto/create-payment-intent.dto';
import { ConfirmPaymentIntentDto } from '../dto/confirm-payment-intent.dto';
import { QueryLedgerEntriesDto } from '../dto/query-ledger-entries.dto';
import { Refund, RefundStatus } from '../entities/refund.entity';

type IdempotencyResolution<T> = {
  existingResponse?: T;
  record: IdempotencyKey;
};

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(IdempotencyKey)
    private readonly idempotencyRepository: Repository<IdempotencyKey>,
    @InjectRepository(LedgerEntry)
    private readonly ledgerRepository: Repository<LedgerEntry>,
    @InjectRepository(Refund)
    private readonly refundRepository: Repository<Refund>,
    @InjectRepository(PaymentAuditLog)
    private readonly auditLogRepository: Repository<PaymentAuditLog>,
    private readonly gatewayFactory: PaymentGatewayFactory,
    private readonly eventEmitter: EventEmitter2,
    private readonly amqpConnection: AmqpConnection,
  ) {}

  async createPaymentIntent(dto: CreatePaymentIntentDto, idempotencyKey?: string): Promise<Payment> {
    const safeKey = idempotencyKey || randomUUID();
    const requestHash = this.hashPayload(dto);
    const gateway = this.gatewayFactory.resolve(dto.paymentMethod, dto.gatewayOverride);
    const paymentMetadata = {
      ...(dto.metadata || {}),
      ...(dto.bookingReference ? { bookingReference: dto.bookingReference } : {}),
    };

    try {
      return await this.dataSource.transaction(async (manager) => {
        const resolution = await this.claimIdempotency<Payment>(manager, 'create_payment_intent', safeKey, requestHash);

        if (resolution.existingResponse) {
          await this.createAuditLog({
            entityType: 'payment',
            entityId: resolution.existingResponse.id,
            action: AuditAction.IDEMPOTENCY_REPLAYED,
            userId: dto.userId,
            changes: { scope: 'create_payment_intent', idempotencyKey: safeKey },
          });
          return resolution.existingResponse;
        }

        const gatewayIntent = await gateway.createPaymentIntent({
          bookingId: dto.bookingId,
          userId: dto.userId,
          amount: dto.amount,
          currency: dto.currency || 'USD',
          paymentMethod: dto.paymentMethod,
          metadata: paymentMetadata,
          gatewayOverride: dto.gatewayOverride,
        });

        const payment = manager.getRepository(Payment).create({
          bookingId: dto.bookingId,
          userId: dto.userId,
          amount: dto.amount,
          currency: (dto.currency || 'USD').toUpperCase(),
          paymentMethod: dto.paymentMethod,
          gateway: gateway.getGatewayName(),
          gatewayPaymentId: gatewayIntent.gatewayPaymentId,
          status: this.mapGatewayIntentStatus(gatewayIntent.status),
          clientSecret: gatewayIntent.clientSecret,
          correlationId: safeKey,
          metadata: {
            ...paymentMetadata,
            gatewayIntentId: gatewayIntent.id,
          },
        });

        const savedPayment = await manager.getRepository(Payment).save(payment);

        await this.completeIdempotency(manager, resolution.record, savedPayment, 'payment', savedPayment.id);

        await this.createAuditLog({
          entityType: 'payment',
          entityId: savedPayment.id,
          action: AuditAction.INTENT_CREATED,
          userId: dto.userId,
          changes: {
            bookingId: dto.bookingId,
            amount: dto.amount,
            currency: dto.currency || 'USD',
            gateway: savedPayment.gateway,
            idempotencyKey: safeKey,
          },
        });

        this.eventEmitter.emit('payment.intent.created', {
          paymentId: savedPayment.id,
          bookingId: savedPayment.bookingId,
          amount: savedPayment.amount,
          clientSecret: savedPayment.clientSecret,
        });

        return savedPayment;
      });
    } catch (error) {
      await this.markIdempotencyAsFailed('create_payment_intent', safeKey, error);
      this.logger.error(`Failed to create payment intent: ${error.message}`, error.stack);
      throw error;
    }
  }

  async confirmPaymentIntent(
    paymentId: string,
    dto: ConfirmPaymentIntentDto = {},
    idempotencyKey?: string,
  ): Promise<Payment> {
    const safeKey = idempotencyKey || randomUUID();
    const requestHash = this.hashPayload({ paymentId, ...dto });

    await this.createAuditLog({
      entityType: 'payment',
      entityId: paymentId,
      action: AuditAction.PAYMENT_CONFIRMATION_REQUESTED,
      changes: { idempotencyKey: safeKey },
    });

    try {
      const {
        payment,
        confirmationEvent,
      }: {
        payment: Payment;
        confirmationEvent?: {
          success: boolean;
          gatewayTransactionId?: string;
          errorMessage?: string;
        };
      } = await this.dataSource.transaction(async (manager) => {
        const scope = `confirm_payment:${paymentId}`;
        const resolution = await this.claimIdempotency<Payment>(manager, scope, safeKey, requestHash);

        if (resolution.existingResponse) {
          return { payment: resolution.existingResponse };
        }

        const payment = await manager.getRepository(Payment).findOne({ where: { id: paymentId } });
        if (!payment) {
          throw new NotFoundException(`Payment ${paymentId} not found`);
        }

        if (
          [PaymentStatus.CONFIRMED, PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUNDED].includes(payment.status)
        ) {
          await this.completeIdempotency(manager, resolution.record, payment, 'payment', payment.id);
          return { payment };
        }

        const gateway = this.gatewayFactory.getByName(payment.gateway);
        const result = await gateway.capturePayment(dto.gatewayPaymentId || payment.gatewayPaymentId);

        payment.status = result.success ? PaymentStatus.CONFIRMED : PaymentStatus.FAILED;
        payment.failureCode = result.failureCode || null;
        payment.failureReason = result.errorMessage || null;
        payment.confirmedAt = result.success ? new Date() : payment.confirmedAt;
        payment.metadata = {
          ...(payment.metadata || {}),
          lastConfirmationResult: {
            status: result.status,
            transactionId: result.transactionId,
          },
        };

        const savedPayment = await manager.getRepository(Payment).save(payment);

        if (result.success) {
          await this.createPaymentLedgerEntries(manager, savedPayment, result.transactionId);
        }

        await this.completeIdempotency(manager, resolution.record, savedPayment, 'payment', savedPayment.id);

        await this.createAuditLog({
          entityType: 'payment',
          entityId: savedPayment.id,
          action: result.success ? AuditAction.PAYMENT_CAPTURED : AuditAction.PAYMENT_FAILED,
          userId: savedPayment.userId,
          changes: {
            status: result.status,
            gatewayTransactionId: result.transactionId,
            failureReason: result.errorMessage,
          },
        });

        return {
          payment: savedPayment,
          confirmationEvent: {
            success: result.success,
            gatewayTransactionId: result.transactionId,
            errorMessage: result.errorMessage,
          },
        };
      });

      if (confirmationEvent) {
        this.eventEmitter.emit(confirmationEvent.success ? 'payment.succeeded' : 'payment.failed', {
          paymentId: payment.id,
          bookingId: payment.bookingId,
          bookingReference: this.getBookingReference(payment),
          amount: payment.amount,
          gatewayTransactionId: confirmationEvent.gatewayTransactionId,
          errorMessage: confirmationEvent.errorMessage,
        });

        if (confirmationEvent.success) {
          await this.publishPaymentCompletedEvent(payment, confirmationEvent.gatewayTransactionId);
        }
      }

      return payment;
    } catch (error) {
      await this.markIdempotencyAsFailed(`confirm_payment:${paymentId}`, safeKey, error);
      this.logger.error(`Failed to confirm payment ${paymentId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async confirmPaymentByGatewayId(gatewayPaymentId: string, idempotencyKey?: string): Promise<Payment> {
    const payment = await this.paymentRepository.findOne({ where: { gatewayPaymentId } });
    if (!payment) {
      throw new NotFoundException(`Payment for gateway reference ${gatewayPaymentId} not found`);
    }

    return this.confirmPaymentIntent(payment.id, { gatewayPaymentId }, idempotencyKey);
  }

  async markPaymentFailedByGatewayId(gatewayPaymentId: string, reason?: string): Promise<Payment> {
    const payment = await this.paymentRepository.findOne({ where: { gatewayPaymentId } });
    if (!payment) {
      throw new NotFoundException(`Payment for gateway reference ${gatewayPaymentId} not found`);
    }

    payment.status = PaymentStatus.FAILED;
    payment.failureReason = reason || 'Payment failed according to gateway webhook';
    const savedPayment = await this.paymentRepository.save(payment);

    await this.createAuditLog({
      entityType: 'payment',
      entityId: savedPayment.id,
      action: AuditAction.PAYMENT_FAILED,
      userId: savedPayment.userId,
      changes: { source: 'webhook', failureReason: reason },
    });

    return savedPayment;
  }

  async refreshRefundedStatus(paymentId: string): Promise<Payment> {
    const payment = await this.paymentRepository.findOne({ where: { id: paymentId } });
    if (!payment) {
      throw new NotFoundException(`Payment ${paymentId} not found`);
    }

    const row = await this.refundRepository
      .createQueryBuilder('refunds')
      .select('COALESCE(SUM(refunds.amount), 0)', 'total')
      .where('refunds.payment_id = :paymentId', { paymentId })
      .andWhere('refunds.status = :status', { status: RefundStatus.SUCCEEDED })
      .getRawOne<{ total: string }>();

    const refundedAmount = Number(row?.total || 0);
    if (refundedAmount <= 0) {
      return payment;
    }

    payment.status = refundedAmount >= payment.amount ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED;
    payment.refundedAt = refundedAmount >= payment.amount ? new Date() : null;
    return this.paymentRepository.save(payment);
  }

  private getBookingReference(payment: Payment): string | null {
    const bookingReference = payment.metadata?.bookingReference;

    return typeof bookingReference === 'string' && bookingReference.trim().length > 0 ? bookingReference : null;
  }

  private async publishPaymentCompletedEvent(payment: Payment, gatewayTransactionId?: string): Promise<void> {
    const bookingReference = this.getBookingReference(payment);

    if (!bookingReference) {
      this.logger.warn(`Skipping payment.completed publish for payment ${payment.id}: missing booking reference`);
      return;
    }

    const fallbackTransactionId =
      typeof payment.metadata?.lastConfirmationResult?.transactionId === 'string'
        ? payment.metadata.lastConfirmationResult.transactionId
        : undefined;

    await this.amqpConnection.publish('payment.events', EventPatterns.PAYMENT_COMPLETED, {
      paymentId: payment.id,
      bookingId: payment.bookingId,
      bookingReference,
      userId: payment.userId,
      amount: payment.amount,
      currency: payment.currency,
      gateway: payment.gateway,
      gatewayPaymentId: payment.gatewayPaymentId,
      gatewayTransactionId: gatewayTransactionId || fallbackTransactionId,
      status: payment.status,
      confirmedAt: payment.confirmedAt?.toISOString() || null,
    });
  }

  async refreshRefundedStatusByGatewayId(gatewayPaymentId: string): Promise<Payment> {
    const payment = await this.paymentRepository.findOne({ where: { gatewayPaymentId } });
    if (!payment) {
      throw new NotFoundException(`Payment for gateway reference ${gatewayPaymentId} not found`);
    }

    return this.refreshRefundedStatus(payment.id);
  }

  async getPaymentIntent(id: string): Promise<Payment> {
    const payment = await this.paymentRepository.findOne({ where: { id } });
    if (!payment) {
      throw new NotFoundException(`Payment ${id} not found`);
    }
    return payment;
  }

  async getPaymentIntentByBooking(bookingId: number): Promise<Payment> {
    const payment = await this.paymentRepository.findOne({
      where: { bookingId },
      order: { createdAt: 'DESC' },
    });
    if (!payment) {
      throw new NotFoundException(`Payment for booking ${bookingId} not found`);
    }
    return payment;
  }

  async getLedgerEntries(query: QueryLedgerEntriesDto): Promise<LedgerEntry[]> {
    const where: FindOptionsWhere<LedgerEntry> = {};

    if (query.bookingId) {
      where.bookingId = query.bookingId;
    }

    if (query.paymentId) {
      where.paymentId = query.paymentId;
    }

    if (query.entryType) {
      where.entryType = query.entryType as LedgerEntryType;
    }

    if (query.from) {
      where.occurredAt = MoreThanOrEqual(new Date(query.from));
    }

    const entries = await this.ledgerRepository.find({
      where,
      order: { occurredAt: 'DESC', createdAt: 'DESC' },
      take: query.limit || 50,
    });

    if (!query.to) {
      return entries;
    }

    const upperBound = new Date(query.to).getTime();
    return entries.filter((entry) => entry.occurredAt.getTime() <= upperBound);
  }

  private async claimIdempotency<T>(
    manager: DataSource['manager'],
    scope: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<IdempotencyResolution<T>> {
    const repository = manager.getRepository(IdempotencyKey);
    const existing = await repository.findOne({
      where: { scope, idempotencyKey },
    });

    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ConflictException(`Idempotency key ${idempotencyKey} was reused with a different payload`);
      }

      if (existing.status === IdempotencyKeyStatus.COMPLETED && existing.responseBody) {
        return {
          existingResponse: existing.responseBody as T,
          record: existing,
        };
      }

      if (existing.status === IdempotencyKeyStatus.PROCESSING) {
        throw new ConflictException(`Request with idempotency key ${idempotencyKey} is already processing`);
      }
    }

    const record =
      existing ||
      repository.create({
        scope,
        idempotencyKey,
        requestHash,
        status: IdempotencyKeyStatus.PROCESSING,
        lockedAt: new Date(),
        expiresAt: this.addHours(24),
      });

    const saved = await repository.save(record);
    return { record: saved };
  }

  private async completeIdempotency(
    manager: DataSource['manager'],
    record: IdempotencyKey,
    responseBody: unknown,
    resourceType: string,
    resourceId: string,
  ): Promise<void> {
    record.status = IdempotencyKeyStatus.COMPLETED;
    record.resourceType = resourceType;
    record.resourceId = resourceId;
    record.responseCode = 200;
    record.responseBody = responseBody as Record<string, any>;
    record.lastError = null;
    await manager.getRepository(IdempotencyKey).save(record);
  }

  private async markIdempotencyAsFailed(scope: string, key: string, error: Error): Promise<void> {
    const record = await this.idempotencyRepository.findOne({ where: { scope, idempotencyKey: key } });
    if (!record) {
      return;
    }

    record.status = IdempotencyKeyStatus.FAILED;
    record.lastError = error.message;
    record.responseCode = 500;
    await this.idempotencyRepository.save(record);
  }

  private async createPaymentLedgerEntries(manager: DataSource['manager'], payment: Payment, referenceId: string) {
    const existing = await manager.getRepository(LedgerEntry).count({
      where: { paymentId: payment.id, entryType: LedgerEntryType.PAYMENT },
    });

    if (existing > 0) {
      return;
    }

    const occurredAt = payment.confirmedAt || new Date();
    const entries = manager.getRepository(LedgerEntry).create([
      {
        paymentId: payment.id,
        bookingId: payment.bookingId,
        accountCode: 'asset:gateway_clearing',
        entryType: LedgerEntryType.PAYMENT,
        direction: LedgerDirection.DEBIT,
        amount: payment.amount,
        currency: payment.currency,
        referenceType: 'payment',
        referenceId,
        description: 'Customer payment captured',
        occurredAt,
        metadata: { gateway: payment.gateway },
      },
      {
        paymentId: payment.id,
        bookingId: payment.bookingId,
        accountCode: 'liability:customer_funds',
        entryType: LedgerEntryType.PAYMENT,
        direction: LedgerDirection.CREDIT,
        amount: payment.amount,
        currency: payment.currency,
        referenceType: 'payment',
        referenceId,
        description: 'Customer funds liability recorded',
        occurredAt,
        metadata: { gateway: payment.gateway },
      },
    ]);

    await manager.getRepository(LedgerEntry).save(entries);
    await this.createAuditLog({
      entityType: 'payment',
      entityId: payment.id,
      action: AuditAction.LEDGER_ENTRY_CREATED,
      userId: payment.userId,
      changes: { entryType: LedgerEntryType.PAYMENT, count: entries.length },
    });
  }

  private mapGatewayIntentStatus(status: string): PaymentStatus {
    if (status === 'succeeded') {
      return PaymentStatus.CONFIRMED;
    }

    if (status.startsWith('requires_')) {
      return PaymentStatus.REQUIRES_ACTION;
    }

    if (status === 'processing') {
      return PaymentStatus.PROCESSING;
    }

    return PaymentStatus.PENDING;
  }

  private hashPayload(payload: unknown): string {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  private addHours(hours: number): Date {
    return new Date(Date.now() + hours * 60 * 60 * 1000);
  }

  private async createAuditLog(data: {
    entityType: string;
    entityId: string;
    action: AuditAction;
    userId?: number;
    ipAddress?: string;
    userAgent?: string;
    changes?: Record<string, any>;
  }): Promise<void> {
    try {
      const auditLog = this.auditLogRepository.create(data);
      await this.auditLogRepository.save(auditLog);
    } catch (error) {
      this.logger.error(`Failed to create audit log: ${error.message}`, error.stack);
    }
  }
}
