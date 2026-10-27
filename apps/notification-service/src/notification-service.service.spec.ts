jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid') }));

import { NotificationService } from './notification-service.service';

describe('NotificationService', () => {
  let keys: Set<string>;
  let sender: { send: jest.Mock };
  let service: NotificationService;

  beforeEach(() => {
    keys = new Set();
    const redis = {
      set: jest.fn((key: string) => Promise.resolve(keys.has(key) ? null : (keys.add(key), 'OK'))),
      del: jest.fn((key: string) => Promise.resolve(Number(keys.delete(key)))),
    };
    sender = { send: jest.fn().mockResolvedValue(undefined) };
    service = new NotificationService({ getClient: () => redis } as never, sender);
  });

  it('notifies the booking owner once per event, even when the event is redelivered', async () => {
    const event = { bookingId: 'BKG-1', userId: 42, _metadata: { eventId: 'evt-1' } };

    await service.bookingConfirmed(event);
    await service.bookingConfirmed(event);

    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(sender.send).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 42, subject: 'Booking BKG-1 confirmed' }),
    );
  });

  it('includes the cancellation reason', async () => {
    await service.bookingCancelled({ bookingId: 'BKG-1', userId: 42, reason: 'Flight cancelled' });

    expect(sender.send).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'Your booking BKG-1 was cancelled: Flight cancelled' }),
    );
  });

  it('deduplicates payment failures per payment and formats the amount', async () => {
    const event = {
      paymentId: 'p1',
      bookingId: 10,
      bookingReference: 'BKG-1',
      userId: 42,
      amount: 12550,
      currency: 'USD',
    };

    await service.paymentFailed(event);
    await service.paymentFailed(event);

    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(sender.send.mock.calls[0][0].body).toContain('125.50 USD');
  });

  it('releases the claim when delivery fails so a dead-letter replay can retry', async () => {
    const event = { bookingId: 'BKG-1', userId: 42, _metadata: { eventId: 'evt-2' } };
    sender.send.mockRejectedValueOnce(new Error('provider down'));

    await expect(service.bookingConfirmed(event)).rejects.toThrow('provider down');
    await service.bookingConfirmed(event);

    expect(sender.send).toHaveBeenCalledTimes(2);
  });

  it('skips events without a recipient instead of dead-lettering them', async () => {
    await expect(service.bookingConfirmed({ bookingId: 'BKG-1', userId: undefined as never })).resolves.toBeUndefined();
    expect(sender.send).not.toHaveBeenCalled();
  });
});
