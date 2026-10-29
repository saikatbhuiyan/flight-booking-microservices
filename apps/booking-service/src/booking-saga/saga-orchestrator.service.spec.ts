jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid') }));

import { ConflictException } from '@nestjs/common';
import { EventPatterns } from '@app/common';
import { SagaStatus } from '../entities/saga-state.entity';
import { BookingSagaOrchestrator } from './saga-orchestrator.service';

describe('BookingSagaOrchestrator compensation', () => {
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

  it('cancels a booking whose seats flight rejected, without releasing seats flight never took', async () => {
    sagaStateRepository.findOne.mockResolvedValue(saga(SagaStatus.FLIGHT_RESERVED));

    await service.handleSeatReservationRejected('BKG-1', 'Not enough seats');

    const published = outboxService.storeEvent.mock.calls.map((call) => call[2]);
    expect(published).toEqual([EventPatterns.BOOKING_CANCELLED]);
    expect(manager.update).toHaveBeenCalledWith(
      expect.anything(),
      { bookingReference: 'BKG-1' },
      expect.objectContaining({ cancellationReason: expect.stringContaining('Not enough seats') }),
    );
    expect(seatLockService.releaseSeats).toHaveBeenCalledWith(7, 'BKG-1');
  });

  it('still releases flight seats when a reserved booking is cancelled by the user', async () => {
    sagaStateRepository.findOne.mockResolvedValue(saga(SagaStatus.FLIGHT_RESERVED));

    await service.cancelBooking('BKG-1', 'User requested cancellation');

    const published = outboxService.storeEvent.mock.calls.map((call) => call[2]);
    expect(published).toEqual([EventPatterns.FLIGHT_RELEASE_SEATS, EventPatterns.BOOKING_CANCELLED]);
  });

  it('refuses to complete a cancelled booking', async () => {
    sagaStateRepository.findOne.mockResolvedValue(saga(SagaStatus.COMPENSATED));

    await expect(service.completeBooking('BKG-1', 'txn-1')).rejects.toThrow(ConflictException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('surfaces a failed compensation instead of reporting the booking as cancelled', async () => {
    sagaStateRepository.findOne.mockResolvedValue(saga(SagaStatus.FLIGHT_RESERVED));
    dataSource.transaction.mockRejectedValueOnce(new Error('db down'));

    await expect(service.cancelBooking('BKG-1', 'User requested cancellation')).rejects.toThrow('db down');
  });
});
