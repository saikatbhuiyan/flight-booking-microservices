jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid') }));

import { EventPatterns } from '@app/common';
import { PaymentStatus } from '../entities/payment.entity';
import { PaymentService } from './payment.service';

describe('PaymentService.markPaymentFailedByGatewayId', () => {
  it('publishes payment.failed with the payment owner so the customer can be notified', async () => {
    const payment = {
      id: 'p1',
      bookingId: 10,
      userId: 42,
      amount: 5000,
      currency: 'USD',
      status: PaymentStatus.PENDING,
      metadata: { bookingReference: 'BKG-1' },
    };
    const paymentRepository = {
      findOne: jest.fn().mockResolvedValue(payment),
      save: jest.fn((p: unknown) => Promise.resolve(p)),
    };
    const auditLogRepository = { create: jest.fn((d: unknown) => d), save: jest.fn() };
    const amqpConnection = { publish: jest.fn() };
    const service = new PaymentService(
      {} as never,
      paymentRepository as never,
      {} as never,
      {} as never,
      {} as never,
      auditLogRepository as never,
      {} as never,
      { emit: jest.fn() } as never,
      amqpConnection as never,
    );

    await service.markPaymentFailedByGatewayId('pi_123', 'card_declined');

    expect(amqpConnection.publish).toHaveBeenCalledWith('payment.events', EventPatterns.PAYMENT_FAILED, {
      paymentId: 'p1',
      bookingId: 10,
      bookingReference: 'BKG-1',
      userId: 42,
      amount: 5000,
      currency: 'USD',
      failureReason: 'card_declined',
    });
  });
});
