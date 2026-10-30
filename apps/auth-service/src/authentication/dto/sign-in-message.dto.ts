import { IsOptional, IsString } from 'class-validator';
import { SignInDto } from '@app/common';

/** auth.login payload: the public SignInDto plus the client IP the gateway observed, recorded in the auth audit. */
export class SignInMessageDto extends SignInDto {
  @IsOptional()
  @IsString()
  ip?: string;
}
