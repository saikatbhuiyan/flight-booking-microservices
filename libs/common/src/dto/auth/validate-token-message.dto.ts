import { IsEmail, IsInt, IsPositive } from 'class-validator';

/** auth.validate: the verified access-token claims the gateway forwards (other claims are stripped). */
export class ValidateTokenMessageDto {
  @IsInt()
  @IsPositive()
  id: number;

  @IsEmail()
  email: string;
}
