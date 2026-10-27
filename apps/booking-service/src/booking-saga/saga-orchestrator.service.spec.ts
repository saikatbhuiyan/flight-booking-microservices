jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid') }));

import { EventPatterns } from '@app/common';
import { SagaStatus } from '../entities/saga-state.entity';
import { BookingSagaOrchestrator } from './saga-orchestrator.service';

describe('BookingSagaOrchestrator.cancelBooking', () => {
  const manager = { save: jest.fn(), update: jest.fn() };
  const outboxService = { storeEvent: jest.fn() };
  const seatLockService = { releaseSeats: jest.fn() };
  const sagaStateRepository = { findOne: jest.fn() };
  const bookingRepository = { findOne: jest.fn() };
  const dataSource = { transaction: jest.fn((cb: (m: typeof manager) => Promise<void>) => cb(manager)) };

  const service = new BookingSagaOrchestrator(
    bookingRepository as never,
    sagaStateRepository as never,
    seatLockService as never,
    outboxService as never,
    dataSource as never,
  );

  beforeEach(() => jest.clearAllMocks());

  const saga = (status: SagaStatus) => ({
    sagaId: 's1',
    bookingId: 'BKG-1',
    currentStep: 3,
    status,
    payload: { userId: 42, flightId: 7, seats: 2, seatClass: 'ECONOMY' },
  });

  it('publishes booking.cancelled with the booking owner through the outbox, in the compensation transaction', async () => {
    sagaStateRepository.findOne.mockResolvedValue(saga(SagaStatus.BOOKING_CONFIRMED));

    await service.cancelBooking('BKG-1', 'User requested cancellation');

    expect(outboxService.storeEvent).toHaveBeenCalledWith(
      'BOOKING',
      'BKG-1',
      EventPatterns.BOOKING_CANCELLED,
      { bookingId: 'BKG-1', userId: 42, reason: 'User requested cancellation' },
      manager,
    );
  });

  it('does not publish again for an already compensated saga', async () => {
    sagaStateRepository.findOne.mockResolvedValue(saga(SagaStatus.COMPENSATED));

    await service.cancelBooking('BKG-1', 'again');

    expect(outboxService.storeEvent).not.toHaveBeenCalled();
  });
});
