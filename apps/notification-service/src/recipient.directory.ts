import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { catchError, firstValueFrom, throwError, timeout } from 'rxjs';
import { MessagePatterns, UserContact, createHttpExceptionFromRpcError } from '@app/common';

export const AUTH_CLIENT = 'AUTH_SERVICE';
const LOOKUP_TIMEOUT_MS = 5000;

/** Resolves who to contact for a user from auth-service, which owns user data. */
@Injectable()
export class RecipientDirectory {
  constructor(@Inject(AUTH_CLIENT) private readonly authClient: ClientProxy) {}

  getContact(userId: number): Promise<UserContact> {
    return firstValueFrom(
      this.authClient.send<UserContact>(MessagePatterns.USER_FIND_BY_ID, { id: userId }).pipe(
        timeout(LOOKUP_TIMEOUT_MS),
        // RPC errors arrive as plain objects; make them real exceptions so logs and dead-letter reasons are readable.
        catchError((error) => throwError(() => createHttpExceptionFromRpcError(error))),
      ),
    );
  }
}
