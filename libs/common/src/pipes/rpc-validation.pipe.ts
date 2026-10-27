import { ValidationPipe } from '@nestjs/common';

/**
 * Validates and transforms DTO-class @Payload()s on RabbitMQ handlers. Apply it per controller with
 * @UsePipes(RpcValidationPipe): app-level pipes never reach RMQ handlers (same reason as CommonRpcExceptionFilter).
 *
 * Unknown properties are stripped rather than rejected, so callers that add context fields keep working while
 * privileged fields (e.g. a smuggled `role`) never reach services. Payloads typed as inline object types,
 * intersections or unions have no runtime class and are not validated.
 */
export const RpcValidationPipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});
