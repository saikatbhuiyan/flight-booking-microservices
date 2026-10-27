jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid') }));

import { NotFoundException } from '@nestjs/common';
import { of } from 'rxjs';
import { MessagePatterns as MP, Role } from '@app/common';
import { PaymentController } from './payment.controller';

describe('PaymentController (gateway)', () => {
  const PAYMENT_ID = '7d3c2a4e-1111-4b6f-9c55-2b7f3a9e0c11';
  const payment = { id: PAYMENT_ID, bookingId: 10, userId: 42, status: 'pending' };
  let send: jest.Mock;
  let controller: PaymentController;

  beforeEach(() => {
    send = jest.fn((pattern: MP) => {
      if (pattern === MP.PAYMENT_CONFIRM_INTENT) return of({ ...payment, status: 'succeeded' });
      if (pattern === MP.PAYMENT_GET_REFUNDS) return of([{ id: 'r1' }]);
      return of(payment);
    });
    controller = new PaymentController({ send } as never);
  });

  it('returns a payment to its owner', async () => {
    await expect(controller.getPayment(PAYMENT_ID, { id: 42, role: Role.USER })).resolves.toMatchObject({
      data: payment,
    });
  });

  it('returns 404 to other users so payment ids cannot be probed', async () => {
    await expect(controller.getPayment(PAYMENT_ID, { id: 7, role: Role.USER })).rejects.toThrow(NotFoundException);
  });

  it('lets admins read any payment', async () => {
    await expect(controller.getByBooking(10, { id: 1, role: Role.ADMIN })).resolves.toMatchObject({ data: payment });
  });

  it('checks ownership before confirming and never confirms for a non-owner', async () => {
    await expect(controller.confirm(PAYMENT_ID, {}, { id: 7, role: Role.USER }, 'idem-1')).rejects.toThrow(
      NotFoundException,
    );
    expect(send).not.toHaveBeenCalledWith(MP.PAYMENT_CONFIRM_INTENT, expect.anything());

    await controller.confirm(PAYMENT_ID, {}, { id: 42, role: Role.USER }, 'idem-1');
    expect(send).toHaveBeenCalledWith(MP.PAYMENT_CONFIRM_INTENT, { id: PAYMENT_ID, dto: {}, idempotencyKey: 'idem-1' });
  });

  it('checks booking ownership before listing refunds', async () => {
    await expect(controller.getRefundsByBooking(10, { id: 7, role: Role.USER })).rejects.toThrow(NotFoundException);
    expect(send).not.toHaveBeenCalledWith(MP.PAYMENT_GET_REFUNDS, expect.anything());
  });
});
