import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CreateRefundDto } from '@app/common';
import { DataSource, Repository } from 'typeorm';
import { createHash, randomUUID } from 'crypto';
import { Refund, RefundStatus } from '../entities/refund.entity';
import { Payment, PaymentStatus } from '../entities/payment.entity';
import { IdempotencyKey, IdempotencyKeyStatus } from '../entities/idempotency-key.entity';
import { LedgerDirection, LedgerEntry, LedgerEntryType } from '../entities/ledger-entry.entity';
import { PaymentAuditLog, AuditAction } from '../entities/payment-audit-log.entity';
import { PaymentGatewayFactory } from '../gateways/gateway.factory';

@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Refund)
    private readonly refundRepository: Repository<Refund>,
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(IdempotencyKey)
    private readonly idempotencyRepository: Repository<IdempotencyKey>,
    @InjectRepository(LedgerEntry)
    private readonly ledgerRepository: Repository<LedgerEntry>,
    @InjectRepository(PaymentAuditLog)
    private readonly auditLogRepository: Repository<PaymentAuditLog>,
    private readonly gatewayFactory: PaymentGatewayFactory,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async createRefund(dto: CreateRefundDto, idempotencyKey?: string): Promise<Refund> {
    const safeKey = idempotencyKey || randomUUID();
    const scope = `refund:${dto.paymentId}`;
    const requestHash = createHash('sha256').update(JSON.stringify(dto)).digest('hex');

    try {
      return await this.dataSource.transaction(async (manager) => {
        const idempotencyRepo = manager.getRepository(IdempotencyKey);
        const existingKey = await idempotencyRepo.findOne({
          where: { scope, idempotencyKey: safeKey },
        });

        if (existingKey) {
          if (existingKey.requestHash !== requestHash) {
            throw new ConflictException(`Idempotency key ${safeKey} was reused with a different refund request`);
          }

          if (existingKey.status === IdempotencyKeyStatus.COMPLETED && existingKey.responseBody) {
            return existingKey.responseBody as Refund;
          }

          if (existingKey.status === IdempotencyKeyStatus.PROCESSING) {
            throw new ConflictException(`Refund request with idempotency key ${safeKey} is already processing`);
          }
        }

        const keyRecord =
          existingKey ||
          idempotencyRepo.create({
            scope,
            idempotencyKey: safeKey,
            requestHash,
            status: IdempotencyKeyStatus.PROCESSING,
            lockedAt: new Date(),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          });

        await idempotencyRepo.save(keyRecord);

        const payment = await manager.getRepository(Payment).findOne({ where: { id: dto.paymentId } });
        if (!payment) {
          throw new NotFoundException(`Payment ${dto.paymentId} not found`);
        }

        if (![PaymentStatus.CONFIRMED, PaymentStatus.PARTIALLY_REFUNDED].includes(payment.status)) {
          throw new BadRequestException(`Payment ${payment.id} is not in a refundable state`);
        }

        const totals = await manager
          .getRepository(Refund)
          .createQueryBuilder('refunds')
          .select('COALESCE(SUM(refunds.amount), 0)', 'total')
          .where('refunds.payment_id = :paymentId', { paymentId: payment.id })
          .andWhere('refunds.status = :status', { status: RefundStatus.SUCCEEDED })
          .getRawOne<{ total: string }>();

        const alreadyRefunded = Number(totals?.total || 0);
        const refundableAmount = payment.amount - alreadyRefunded;

        if (dto.amount > refundableAmount) {
          throw new BadRequestException(
            `Refund amount (${dto.amount}) exceeds refundable balance (${refundableAmount})`,
          );
        }

        const gateway = this.gatewayFactory.getByName(payment.gateway);
        const gatewayResult = await gateway.refundPayment({
          transactionId: payment.gatewayPaymentId,
          amount: dto.amount,
          reason: dto.reason,
        });

        const refund = manager.getRepository(Refund).create({
          paymentId: payment.id,
          bookingId: dto.bookingId,
          amount: dto.amount,
          reason: dto.reason,
          idempotencyKey: safeKey,
          status: gatewayResult.success ? RefundStatus.SUCCEEDED : RefundStatus.FAILED,
          gatewayRefundId: gatewayResult.refundId || null,
          failureReason: gatewayResult.errorMessage || null,
          processedAt: gatewayResult.success ? new Date() : null,
          metadata: gatewayResult.rawResponse || null,
        });

        const savedRefund = await manager.getRepository(Refund).save(refund);

        if (gatewayResult.success) {
          const totalRefunded = alreadyRefunded + dto.amount;
          payment.status = totalRefunded >= payment.amount ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED;
          payment.refundedAt = totalRefunded >= payment.amount ? new Date() : null;
          await manager.getRepository(Payment).save(payment);
          await this.createRefundLedgerEntries(manager, payment, savedRefund);
        }

        keyRecord.status = IdempotencyKeyStatus.COMPLETED;
        keyRecord.resourceType = 'refund';
        keyRecord.resourceId = savedRefund.id;
        keyRecord.responseCode = gatewayResult.success ? 200 : 422;
        keyRecord.responseBody = savedRefund as unknown as Record<string, any>;
        keyRecord.lastError = gatewayResult.errorMessage || null;
        await idempotencyRepo.save(keyRecord);

        await this.createAuditLog({
          entityType: 'refund',
          entityId: savedRefund.id,
          action: gatewayResult.success ? AuditAction.REFUND_PROCESSED : AuditAction.REFUND_CREATED,
          userId: payment.userId,
          changes: {
            paymentId: payment.id,
            amount: dto.amount,
            reason: dto.reason,
            idempotencyKey: safeKey,
          },
        });

        if (gatewayResult.success) {
          this.eventEmitter.emit('payment.refunded', {
            refundId: savedRefund.id,
            paymentId: payment.id,
            bookingId: dto.bookingId,
            amount: dto.amount,
          });
        }

        return savedRefund;
      });
    } catch (error) {
      await this.markIdempotencyFailed(scope, safeKey, error);
      this.logger.error(`Failed to create refund for payment ${dto.paymentId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getRefundsByBooking(bookingId: number): Promise<Refund[]> {
    return this.refundRepository.find({
      where: { bookingId },
      order: { createdAt: 'DESC' },
    });
  }

  private async createRefundLedgerEntries(manager: DataSource['manager'], payment: Payment, refund: Refund) {
    const existing = await manager.getRepository(LedgerEntry).count({
      where: { refundId: refund.id, entryType: LedgerEntryType.REFUND },
    });

    if (existing > 0) {
      return;
    }

    const entries = manager.getRepository(LedgerEntry).create([
      {
        paymentId: payment.id,
        refundId: refund.id,
        bookingId: refund.bookingId,
        accountCode: 'liability:customer_funds',
        entryType: LedgerEntryType.REFUND,
        direction: LedgerDirection.DEBIT,
        amount: refund.amount,
        currency: payment.currency,
        referenceType: 'refund',
        referenceId: refund.gatewayRefundId || refund.id,
        description: 'Customer liability reduced for refund',
        occurredAt: refund.processedAt || new Date(),
        metadata: { gateway: payment.gateway },
      },
      {
        paymentId: payment.id,
        refundId: refund.id,
        bookingId: refund.bookingId,
        accountCode: 'asset:gateway_clearing',
        entryType: LedgerEntryType.REFUND,
        direction: LedgerDirection.CREDIT,
        amount: refund.amount,
        currency: payment.currency,
        referenceType: 'refund',
        referenceId: refund.gatewayRefundId || refund.id,
        description: 'Cash movement recorded for refund',
        occurredAt: refund.processedAt || new Date(),
        metadata: { gateway: payment.gateway },
      },
    ]);

    await manager.getRepository(LedgerEntry).save(entries);
    await this.createAuditLog({
      entityType: 'refund',
      entityId: refund.id,
      action: AuditAction.LEDGER_ENTRY_CREATED,
      userId: payment.userId,
      changes: { entryType: LedgerEntryType.REFUND, count: entries.length },
    });
  }

  private async markIdempotencyFailed(scope: string, idempotencyKey: string, error: Error): Promise<void> {
    const record = await this.idempotencyRepository.findOne({
      where: { scope, idempotencyKey },
    });

    if (!record) {
      return;
    }

    record.status = IdempotencyKeyStatus.FAILED;
    record.lastError = error.message;
    record.responseCode = 500;
    await this.idempotencyRepository.save(record);
  }

  private async createAuditLog(data: {
    entityType: string;
    entityId: string;
    action: AuditAction;
    userId?: number;
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
